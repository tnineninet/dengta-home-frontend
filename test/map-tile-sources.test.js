import test from "node:test";
import assert from "node:assert/strict";
import { TILE_SOURCE_PRESETS, gcj02ToWgs84, normalizeTileSource, readTileSourcePreference, resolvedTileUrl, saveTileSourcePreference, wgs84ToGcj02 } from "../src/map-tile-sources.js";

test("tile presets keep coordinates and keys explicit", () => {
  const amap = normalizeTileSource({ id: "amap" });
  assert.equal(amap.crs, "gcj02");
  assert.equal(amap.usable, true);
  assert.match(amap.template, /autonavi\.com/);
  assert.match(amap.attribution, /高德/);
  const osm = normalizeTileSource({ id: "osm" });
  assert.equal(osm.crs, "wgs84");
  assert.equal(osm.usable, true);
  assert.match(osm.template, /openstreetmap/);
  assert.equal(normalizeTileSource({ id: "maptiler" }).usable, false, "MapTiler needs a key");
  assert.equal(normalizeTileSource({ id: "maptiler", key: "fixture-key" }).usable, true);
  assert.match(resolvedTileUrl({ id: "maptiler", key: "fixture-key" }), /key=fixture-key/);
  assert.equal(normalizeTileSource({ id: "custom" }).usable, false, "custom source needs a template");
  assert.equal(normalizeTileSource({ id: "custom", template: "https://tiles.example.test/{z}/{x}/{y}.png" }).usable, true);
  assert.equal(TILE_SOURCE_PRESETS.osm.id, "osm");
});

test("GCJ-02 projection round-trips inside China and leaves foreign coordinates untouched", () => {
  const projected = wgs84ToGcj02(39.9087, 116.3975);
  assert.ok(projected.latitude > 39.9087 && projected.longitude > 116.3975);
  const restored = gcj02ToWgs84(projected.latitude, projected.longitude);
  assert.ok(Math.abs(restored.latitude - 39.9087) < 1e-5);
  assert.ok(Math.abs(restored.longitude - 116.3975) < 1e-5);
  assert.deepEqual(wgs84ToGcj02(51.5074, -0.1278), { latitude: 51.5074, longitude: -0.1278 });
  assert.deepEqual(gcj02ToWgs84(40.7128, -74.006), { latitude: 40.7128, longitude: -74.006 });
});

test("tile preference falls back safely and stores only source data", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  assert.equal(readTileSourcePreference(storage, "scope-a").id, "osm");
  values.set("dengta_surprise_map_tiles_v1:scope-a", "{not json");
  assert.equal(readTileSourcePreference(storage, "scope-a").id, "osm");
  const saved = saveTileSourcePreference(storage, "scope-a", { id: "amap" });
  assert.equal(saved.id, "amap");
  assert.equal(readTileSourcePreference(storage, "scope-a").id, "amap");
  const raw = JSON.parse(values.get("dengta_surprise_map_tiles_v1:scope-a"));
  assert.deepEqual(Object.keys(raw).sort(), ["attribution", "id", "key", "template"]);
  assert.equal(values.has("dengta_surprise_map_tiles_v1:scope-b"), false);
});

test("native Chinese clients default to the key-free Amap basemap", () => {
  const priorCapacitor = Object.getOwnPropertyDescriptor(globalThis, "Capacitor");
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
  try {
    Object.defineProperty(globalThis, "Capacitor", { configurable: true, value: { isNativePlatform: () => true } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "zh-CN", languages: ["zh-CN"] } });
    assert.equal(readTileSourcePreference(storage, "native-zh").id, "amap");
  } finally {
    if (priorCapacitor) Object.defineProperty(globalThis, "Capacitor", priorCapacitor); else delete globalThis.Capacitor;
    if (priorNavigator) Object.defineProperty(globalThis, "navigator", priorNavigator); else delete globalThis.navigator;
  }
});
