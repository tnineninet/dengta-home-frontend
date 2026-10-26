// 底图可通过构建环境变量替换为自建瓦片或合作方瓦片；默认仍是 OpenStreetMap 标准底图。
// 替换服务时必须同时替换署名，并遵守该服务的授权与容量限制。
const MAP_ENV = import.meta.env || {};
import { TILE_SOURCE_PRESETS, normalizeTileSource, projectForSource, resolvedTileUrl, unprojectForSource } from "./map-tile-sources.js";

export const SURPRISE_MAP_TILES = MAP_ENV.VITE_SURPRISE_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const SURPRISE_MAP_ATTRIBUTION = MAP_ENV.VITE_SURPRISE_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

// 公开地图上只展示随机化笔名与来源，不展示账号、伴侣或任何可追踪标识。
export function publicAuthorLabel(letter) {
  const alias = typeof letter?.author_alias === "string" ? letter.author_alias.trim().slice(0, 40) : "";
  const who = alias || "一位路过的旅人";
  return letter?.source === "ai" ? `${who}（AI 代笔）` : who;
}

export function displayMapArea(area) {
  if (typeof area?.latitude !== "number" || !Number.isFinite(area.latitude) || Math.abs(area.latitude) > 90 ||
      typeof area.longitude !== "number" || !Number.isFinite(area.longitude) || Math.abs(area.longitude) > 180 ||
      typeof area.radius_m !== "number" || !Number.isFinite(area.radius_m) || area.radius_m < 1 || area.radius_m > 50000) return null;
  return { latitude: Math.max(-85.0511, Math.min(85.0511, area.latitude)), longitude: area.longitude, radius_m: area.radius_m };
}

// The tile provider receives a coarse viewing region, never the GPS receipt or a letter body.
export function coarseMapCenter(position) {
  if (typeof position?.latitude !== "number" || !Number.isFinite(position.latitude) || Math.abs(position.latitude) > 90 ||
      typeof position.longitude !== "number" || !Number.isFinite(position.longitude) || Math.abs(position.longitude) > 180) return null;
  return { latitude: Math.max(-85.0511, Math.min(85.0511, Math.round(position.latitude * 100) / 100)),
    longitude: Math.round(position.longitude * 100) / 100 };
}

// A deliberately chosen public place is the claim anchor; only its public projection is blurred.
export function selectedPublicMapPoint(position) {
  if (typeof position?.latitude !== "number" || !Number.isFinite(position.latitude) || Math.abs(position.latitude) > 90 ||
      typeof position.longitude !== "number" || !Number.isFinite(position.longitude) || Math.abs(position.longitude) > 180) return null;
  return { latitude: Number(position.latitude.toFixed(6)), longitude: Number(position.longitude.toFixed(6)) };
}

export function coarseMapViewport(bounds) {
  const west = bounds?.getWest?.(), south = bounds?.getSouth?.(), east = bounds?.getEast?.(), north = bounds?.getNorth?.();
  if (![west, south, east, north].every(Number.isFinite) || south >= north) return null;
  const floor = value => Math.floor(value * 100) / 100, ceil = value => Math.ceil(value * 100) / 100;
  const latitudeSouth = Math.max(-90, floor(south)), latitudeNorth = Math.min(90, ceil(north));
  if (latitudeSouth >= latitudeNorth) return null;
  const span = east >= west ? east - west : east - west + 360;
  if (Math.abs(east - west) >= 360 || span >= 359.99) return `-180,${latitudeSouth},180,${latitudeNorth}`;
  const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
  const longitudeWest = floor(wrap(west)), longitudeEast = ceil(wrap(east));
  if (longitudeWest === longitudeEast) return null;
  return `${longitudeWest},${latitudeSouth},${longitudeEast},${latitudeNorth}`;
}

const loadLibrary = async () => {
  const [library] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
  return library.default || library;
};

export function mountSurpriseMap(container, { load = loadLibrary, onStatus = () => {}, onSelect = () => {}, onViewport = () => {}, picker = false, onPick = () => {},
  tileSource = null, tiles = true, documentObject = globalThis.document, ResizeObserverClass = globalThis.ResizeObserver,
  IntersectionObserverClass = globalThis.IntersectionObserver } = {}) {
  const selectedSource = normalizeTileSource(tileSource);
  const source = selectedSource.usable ? selectedSource : normalizeTileSource(TILE_SOURCE_PRESETS.osm);
  const displayArea = area => {
    const valid = displayMapArea(area); if (!valid) return null;
    const projected = projectForSource(source, valid);
    return projected ? { ...valid, latitude: projected.latitude, longitude: projected.longitude } : null;
  };
  const projectPoint = point => projectForSource(source, point);
  const unprojectPoint = point => unprojectForSource(source, point);
  let disposed = false, library, map, layer, markers, envelopeIcon, selectedEnvelopeIcon, resizeObserver, intersectionObserver, timer, viewportTimer, lastViewport = "", pickIntent = false, suppressViewportUntil = 0;
  let state = { items: [], position: null, selectedId: null }, visible = true, tileErrors = 0, centered = false, lastFocus = "";
  const status = value => { if (!disposed) onStatus(value); };
  const stopTimer = () => { clearTimeout(timer); timer = null; };
  const MAP_TILE_TIMEOUT_MS = 12000;
  const startTimer = () => { stopTimer(); timer = setTimeout(() => status("timeout"), MAP_TILE_TIMEOUT_MS); };
  function choosePublicPoint(point) {
    if (disposed || !picker || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return;
    const unprojected = unprojectPoint(point);
    if (!unprojected) return;
    const longitude = ((unprojected.longitude + 180) % 360 + 360) % 360 - 180;
    const selected = selectedPublicMapPoint({ latitude: unprojected.latitude, longitude });
    if (selected) onPick(selected);
  }
  function beginPick() { pickIntent = true; }
  function keyboardPick(event) { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-", "="].includes(event.key)) beginPick(); }
  function finishPick() { if (pickIntent) { pickIntent = false; choosePublicPoint(map?.getCenter?.()); } }
  function clickPick(event) { choosePublicPoint(event?.latlng); }
  function viewportBounds() {
    const bounds = map?.getBounds?.();
    if (!bounds) return null;
    if (source.crs !== "gcj02") return bounds;
    const southWest = unprojectPoint({ lat: bounds.getSouth(), lng: bounds.getWest() });
    const northEast = unprojectPoint({ lat: bounds.getNorth(), lng: bounds.getEast() });
    if (!southWest || !northEast) return null;
    return { getWest: () => southWest.longitude, getSouth: () => southWest.latitude, getEast: () => northEast.longitude, getNorth: () => northEast.latitude };
  }
  function publishViewport() {
    clearTimeout(viewportTimer);
    viewportTimer = setTimeout(() => {
      if (disposed || !visible || documentObject?.hidden) return;
      if (Date.now() < suppressViewportUntil) return;
      const bounds = coarseMapViewport(viewportBounds());
      if (bounds && bounds !== lastViewport) { lastViewport = bounds; onViewport(bounds); }
    }, 350);
  }
  function visibility() {
    if (!map || disposed) return;
    if (!layer) return;
    if (!visible || documentObject?.hidden) { stopTimer(); clearTimeout(viewportTimer); if (map.hasLayer(layer)) map.removeLayer(layer); }
    else if (!map.hasLayer(layer)) { status("loading"); layer.addTo(map); publishViewport(); }
  }
  function draw() {
    if (!map || disposed) return;
    markers.clearLayers();
    if (picker) {
      const point = selectedPublicMapPoint(state.pickerPoint), projected = projectPoint(point);
      if (projected) library.marker([projected.latitude, projected.longitude], { icon: selectedEnvelopeIcon, keyboard: false, alt: "", title: "待确认的公共落点" }).addTo(markers);
      return;
    }
    const points = []; let focusedCircle;
    for (const item of state.items) {
      const area = displayArea(item?.area); if (!area) continue;
      const point = [area.latitude, area.longitude]; points.push(point);
      const circle = library.circle(point, { radius: area.radius_m, color: item.id === state.selectedId ? "#9a526f" : "#b69254",
        fillColor: item.id === state.selectedId ? "#cf86a4" : "#d7b66d", fillOpacity: 0.22, weight: 2 });
      circle.on("click", () => { if (!disposed) onSelect(item.id); });
      circle.on("add", () => {
        const element = circle.getElement?.(); if (!element) return;
        element.setAttribute("role", "button"); element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", `查看信件范围：${String(item.title || "沿途来信")}`);
        element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disposed) onSelect(item.id); } });
      });
      circle.addTo(markers);
      const pin = library.marker(point, { icon: item.id === state.selectedId ? selectedEnvelopeIcon : envelopeIcon,
        keyboard: false, alt: "", title: `查看来信：${String(item.title || "沿途来信")}`, zIndexOffset: 500 });
      pin.on("click", () => { if (!disposed) onSelect(item.id); });
      pin.addTo(markers);
      if (item.id === state.selectedId) focusedCircle = circle;
    }
    const selected = state.items.find(item => item.id === state.selectedId);
    const coarse = coarseMapCenter(state.position), projectedCoarse = projectPoint(coarse);
    if (projectedCoarse && typeof library.circleMarker === "function") {
      library.circleMarker([projectedCoarse.latitude, projectedCoarse.longitude], { radius: 6, color: "#f6dfae", weight: 2, fillColor: "#f6dfae", fillOpacity: 0.9 })
        .bindTooltip?.("你在这附近", { direction: "top", opacity: 0.9 }).addTo(markers);
    }
    const focus = displayArea(selected?.area);
    const focusKey = focus ? `letter:${selected.id}` : projectedCoarse ? `near:${projectedCoarse.latitude}:${projectedCoarse.longitude}` : "";
    if (focusKey && focusKey !== lastFocus) {
      if (focusedCircle) map.fitBounds(focusedCircle.getBounds(), { padding: [30, 30], maxZoom: 14, animate: false });
      else if (projectedCoarse) map.setView([projectedCoarse.latitude, projectedCoarse.longitude], 12, { animate: false });
      centered = true;
    } else if (!centered && points.length) { map.fitBounds(markers.getBounds(), { padding: [30, 30], maxZoom: 14, animate: false }); centered = true; }
    lastFocus = focusKey;
  }
  if (tiles) startTimer();
  const ready = Promise.resolve().then(load).then(value => {
    if (disposed || !container) return;
    library = value;
    envelopeIcon = library.icon({ iconUrl: "/assets/surprise-map/letter-pin.svg", iconSize: [34, 34], iconAnchor: [17, 17], className: "surprise-map-letter-pin" });
    selectedEnvelopeIcon = library.icon({ iconUrl: "/assets/surprise-map/letter-pin.svg", iconSize: [34, 34], iconAnchor: [17, 17], className: "surprise-map-letter-pin is-selected" });
    map = library.map(container, { zoomControl: false, scrollWheelZoom: false, minZoom: 2, maxZoom: 16,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, worldCopyJump: true });
    map.setView([25, 105], 4, { animate: false });
    library.control.zoom({ zoomInTitle: "放大地图", zoomOutTitle: "缩小地图" }).addTo(map);
    map.attributionControl?.setPrefix(false);
    if (tiles) {
      layer = library.tileLayer(resolvedTileUrl(source), { attribution: source.attribution || undefined, subdomains: source.subdomains || "abc",
        maxZoom: 16, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 0, referrerPolicy: "strict-origin-when-cross-origin" });
      layer.on("loading", () => { tileErrors = 0; status("loading"); startTimer(); });
      layer.on("tileerror", () => { tileErrors++; status("unavailable"); });
      layer.on("load", () => { stopTimer(); status(tileErrors ? "unavailable" : "ready"); });
    } else if (!picker) {
      stopTimer();
      status("ready");
    }
    markers = library.featureGroup().addTo(map);
    documentObject?.addEventListener("visibilitychange", visibility);
    if (ResizeObserverClass) { resizeObserver = new ResizeObserverClass(() => { if (!disposed) { suppressViewportUntil = Date.now() + 1000; map.invalidateSize({ animate: false, pan: false }); } }); resizeObserver.observe(container); }
    if (IntersectionObserverClass) { intersectionObserver = new IntersectionObserverClass(entries => { visible = entries.some(entry => entry.isIntersecting); visibility(); }); intersectionObserver.observe(container); }
    draw(); visibility();
    map.on?.("moveend", publishViewport);
    if (picker) {
      map.on("dragstart", beginPick); map.on("zoomstart", beginPick); map.on("moveend", finishPick); map.on("click", clickPick);
      map.getContainer?.()?.addEventListener("keydown", keyboardPick, true);
    }
    publishViewport();
  }).catch(() => { stopTimer(); status("failed"); });
  return {
    ready,
    update(next) { if (disposed) return; state = next; draw(); },
    fit() {
      if (!map || disposed) return;
      const points = state.items.map(item => displayArea(item?.area)).filter(Boolean).map(area => [area.latitude, area.longitude]);
      if (points.length) map.fitBounds(markers.getBounds(), { padding: [30, 30], maxZoom: 14, animate: false });
    },
    destroy() {
      if (disposed) return;
      disposed = true; stopTimer(); clearTimeout(viewportTimer); resizeObserver?.disconnect(); intersectionObserver?.disconnect();
      documentObject?.removeEventListener("visibilitychange", visibility);
      if (picker) { map?.off?.("dragstart", beginPick); map?.off?.("zoomstart", beginPick); map?.off?.("moveend", finishPick); map?.off?.("click", clickPick); map?.getContainer?.()?.removeEventListener("keydown", keyboardPick, true); }
      map?.off?.("moveend", publishViewport); layer?.off(); markers?.clearLayers(); map?.remove();
    },
  };
}
