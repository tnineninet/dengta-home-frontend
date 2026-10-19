// 藏宝地图底图来源：OpenStreetMap / 高德 / MapTiler / 自定义（含自建与离线瓦片服务）。
// 坐标始终以 WGS84 存储与领取；高德底图使用 GCJ-02，只在绘制与选点时做投影转换。

const PI = Math.PI, EARTH_A = 6378245.0, EARTH_EE = 0.006693421622965943;

function outOfChina(latitude, longitude) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}
function transformLatitude(x, y) {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  value += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  value += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  value += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return value;
}
function transformLongitude(x, y) {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  value += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  value += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  value += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return value;
}

export function wgs84ToGcj02(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || outOfChina(latitude, longitude)) return { latitude, longitude };
  let deltaLatitude = transformLatitude(longitude - 105, latitude - 35);
  let deltaLongitude = transformLongitude(longitude - 105, latitude - 35);
  const radianLatitude = (latitude / 180) * PI;
  let magic = Math.sin(radianLatitude);
  magic = 1 - EARTH_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  deltaLatitude = (deltaLatitude * 180) / (((EARTH_A * (1 - EARTH_EE)) / (magic * sqrtMagic)) * PI);
  deltaLongitude = (deltaLongitude * 180) / ((EARTH_A / sqrtMagic) * Math.cos(radianLatitude) * PI);
  return { latitude: latitude + deltaLatitude, longitude: longitude + deltaLongitude };
}

export function gcj02ToWgs84(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || outOfChina(latitude, longitude)) return { latitude, longitude };
  let guessLatitude = latitude, guessLongitude = longitude;
  for (let index = 0; index < 4; index += 1) {
    const converted = wgs84ToGcj02(guessLatitude, guessLongitude);
    guessLatitude += latitude - converted.latitude;
    guessLongitude += longitude - converted.longitude;
  }
  return { latitude: guessLatitude, longitude: guessLongitude };
}

export const TILE_SOURCE_PRESETS = Object.freeze({
  osm: Object.freeze({ id: "osm", label: "OpenStreetMap", crs: "wgs84", subdomains: "abc",
    template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' }),
  amap: Object.freeze({ id: "amap", label: "高德地图", crs: "gcj02", subdomains: "1234",
    template: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    attribution: '&copy; <a href="https://www.amap.com/" target="_blank" rel="noopener noreferrer">高德地图</a>' }),
  maptiler: Object.freeze({ id: "maptiler", label: "MapTiler", crs: "wgs84", subdomains: "abc", requiresKey: true,
    template: "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}",
    attribution: '&copy; <a href="https://www.maptiler.com/" target="_blank" rel="noopener noreferrer">MapTiler</a> &copy; OpenStreetMap contributors' }),
  custom: Object.freeze({ id: "custom", label: "自定义 / 离线瓦片", crs: "wgs84", subdomains: "abc", requiresTemplate: true,
    template: "", attribution: "" }),
});

const TILE_TEMPLATE = /^https?:\/\/[^\s{}]+(?:\{[sxyz]\}[^\s]*)+$/i;

export function normalizeTileSource(input) {
  const candidate = input && typeof input === "object" ? input : {};
  const preset = TILE_SOURCE_PRESETS[candidate.id] || TILE_SOURCE_PRESETS.osm;
  const template = String(candidate.template || preset.template || "").trim().slice(0, 600);
  const attribution = String(candidate.attribution || preset.attribution || "").trim().slice(0, 400);
  const key = String(candidate.key || "").trim().slice(0, 200);
  const crs = preset.crs === "gcj02" ? "gcj02" : "wgs84";
  const usable = Boolean(template) && TILE_TEMPLATE.test(template) &&
    (!preset.requiresKey || Boolean(key));
  return Object.freeze({
    id: preset.id, label: preset.label, template, attribution, key, crs,
    subdomains: preset.subdomains || "abc",
    requiresKey: Boolean(preset.requiresKey), requiresTemplate: Boolean(preset.requiresTemplate),
    usable,
  });
}

export function resolvedTileUrl(source) {
  const normalized = normalizeTileSource(source);
  return normalized.key ? normalized.template.replaceAll("{key}", encodeURIComponent(normalized.key)) : normalized.template;
}

export function projectForSource(source, point) {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  return normalizeTileSource(source).crs === "gcj02"
    ? wgs84ToGcj02(point.latitude, point.longitude)
    : { latitude: point.latitude, longitude: point.longitude };
}

export function unprojectForSource(source, point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return normalizeTileSource(source).crs === "gcj02"
    ? gcj02ToWgs84(point.lat, point.lng)
    : { latitude: point.lat, longitude: point.lng };
}

export function readTileSourcePreference(storage, scopeKey) {
  try {
    const raw = storage?.getItem("dengta_surprise_map_tiles_v1:" + String(scopeKey || ""));
    const parsed = raw ? JSON.parse(raw) : null;
    const source = normalizeTileSource(parsed);
    return source.usable ? source : normalizeTileSource(TILE_SOURCE_PRESETS.osm);
  } catch {
    return normalizeTileSource(TILE_SOURCE_PRESETS.osm);
  }
}

export function saveTileSourcePreference(storage, scopeKey, source) {
  try {
    const normalized = normalizeTileSource(source);
    storage?.setItem("dengta_surprise_map_tiles_v1:" + String(scopeKey || ""), JSON.stringify({
      id: normalized.id, template: normalized.template, attribution: normalized.attribution, key: normalized.key,
    }));
    return normalized;
  } catch {
    return normalizeTileSource(source);
  }
}
