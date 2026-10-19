import test from "node:test";
import assert from "node:assert/strict";
import { coarseMapCenter, coarseMapViewport, displayMapArea, mountSurpriseMap, publicAuthorLabel, selectedPublicMapPoint, SURPRISE_MAP_TILES } from "../src/surprise-map-display.js";
import { wgs84ToGcj02 } from "../src/map-tile-sources.js";

test("public author labels stay pseudonymous, bounded and explicit about AI drafting", () => {
  assert.equal(publicAuthorLabel({ author_alias: "晚风的旅人", source: "human" }), "晚风的旅人");
  assert.equal(publicAuthorLabel({ author_alias: "晚风的旅人", source: "ai" }), "晚风的旅人（AI 代笔）");
  assert.equal(publicAuthorLabel({}), "一位路过的旅人");
  assert.equal(publicAuthorLabel({ author_alias: "   ", source: "ai" }), "一位路过的旅人（AI 代笔）");
  assert.equal(publicAuthorLabel({ author_alias: "x".repeat(100) }).length, 40);
});

const letter = { id: "letter-fixture", title: '<img onerror="fixture">', body: "PRIVATE_BODY_FIXTURE", area: { latitude: 31.23456, longitude: 121.45678, radius_m: 300 } };
function fakeLibrary() {
  const calls = [], circles = [], pins = [], handlers = {}, layers = new Set(), mapHandlers = {};
  const mapListeners = new Map(); let center = { lat: 25, lng: 105 };
  let bounds = { west: 121.456789, south: 31.234567, east: 121.487654, north: 31.256789 };
  const map = { setView: (...args) => { calls.push(["view", ...args]); return map; }, fitBounds: (...args) => calls.push(["fit", ...args]),
    invalidateSize: options => calls.push(["resize", options]), hasLayer: layer => layers.has(layer), removeLayer: layer => layers.delete(layer),
    remove: () => calls.push(["remove"]), attributionControl: { setPrefix: value => calls.push(["prefix", value]) },
    getBounds: () => ({ getWest: () => bounds.west, getSouth: () => bounds.south, getEast: () => bounds.east, getNorth: () => bounds.north }),
    getCenter: () => center,
    on: (event, callback) => { const listeners = mapListeners.get(event) || new Set(); listeners.add(callback); mapListeners.set(event, listeners); mapHandlers[event] = (...args) => { for (const listener of listeners) listener(...args); }; },
    off: (event, callback) => { const listeners = mapListeners.get(event); listeners?.delete(callback); if (!listeners?.size) { mapListeners.delete(event); delete mapHandlers[event]; } } };
  const tile = { on: (name, callback) => { handlers[name] = callback; }, addTo: () => { layers.add(tile); handlers.loading?.(); return tile; }, off: () => calls.push(["off"]) };
  const group = { addTo: () => group, clearLayers: () => { circles.splice(0); pins.splice(0); }, getBounds: () => circles.map(circle => [circle.point, circle.options.radius]) };
  const library = { map: (_host, options) => { calls.push(["map", options]); return map; }, tileLayer: (url, options) => { calls.push(["tiles", url, options]); return tile; }, featureGroup: () => group,
    control: { zoom: options => ({ addTo: () => calls.push(["zoom", options]) }) },
    icon: options => options, marker: (point, options) => { const events = {}; const pin = { on: (event, callback) => { events[event] = callback; }, addTo: () => { pins.push({ point, options, events }); return pin; } }; return pin; },
    circle: (point, options) => { const events = {}, attributes = {}, listeners = {}; const circle = {
      on: (name, callback) => { events[name] = callback; }, getElement: () => ({ setAttribute: (key, value) => { attributes[key] = value; }, addEventListener: (key, value) => { listeners[key] = value; } }),
      addTo: () => { circles.push({ point, options, attributes, listeners, events }); events.add?.(); return circle; },
      getBounds: () => [point, options.radius],
    }; return circle; } };
  return { calls, circles, pins, handlers, layers, library, mapHandlers, setBounds: next => { bounds = next; }, setCenter: value => { center = value; } };
}
const fakeDocument = () => { const events = new Map(); return { hidden: false, events, addEventListener: (key, value) => events.set(key,value), removeEventListener: key => events.delete(key) }; };

test("map display rejects invalid receipts, clamps poles and coarsens GPS without mutating it", () => {
  const position = Object.freeze({ latitude: 31.23456789, longitude: 121.45678901, accuracy: 5, captured_at: "PRIVATE_TIME" });
  assert.deepEqual(coarseMapCenter(position), { latitude: 31.23, longitude: 121.46 });
  assert.deepEqual(coarseMapCenter({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
  assert.equal(displayMapArea({ latitude: 91, longitude: 0, radius_m: 300 }), null);
  assert.equal(displayMapArea({ latitude: 0, longitude: 0, radius_m: -1 }), null);
  assert.equal(displayMapArea({ latitude: 0, longitude: 0, radius_m: Infinity }), null);
  assert.equal(coarseMapCenter({ latitude: 0, longitude: 181 }), null);
  assert.equal(displayMapArea({ latitude: 90, longitude: 180, radius_m: 300 }).latitude, 85.0511);
});
test("lazy initialization draws bounded letter areas, no private body or exact GPS reaches the map library", async () => {
  const fixture = fakeLibrary(), selected = [], documentObject = fakeDocument();
  const runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject, onSelect: id => selected.push(id) });
  runtime.update({ items: [letter], position: { latitude: 31.23456789, longitude: 121.45678901 }, selectedId: null });
  await runtime.ready;
  assert.equal(fixture.calls.find(call => call[0] === "tiles")[1], SURPRISE_MAP_TILES);
  const options = fixture.calls.find(call => call[0] === "tiles")[2];
  assert.equal(options.keepBuffer, 0); assert.equal(options.updateWhenIdle, true); assert.match(options.attribution, /OpenStreetMap/);
  assert.equal(options.referrerPolicy, "strict-origin-when-cross-origin");
  assert.deepEqual(fixture.calls.filter(call => call[0] === "view").at(-1)[1], [31.23, 121.46]);
  assert.doesNotMatch(JSON.stringify(fixture.calls), /PRIVATE_BODY_FIXTURE|31\.23456789|121\.45678901/);
  const circle = fixture.circles[0]; assert.equal(circle.attributes.role, "button"); assert.equal(circle.attributes.tabindex, "0");
  assert.match(circle.attributes["aria-label"], /<img/); // Plain attribute text, never an HTML popup.
  circle.events.click(); circle.listeners.keydown({ key: "Enter", preventDefault() {} });
  const pin = fixture.pins[0]; assert.deepEqual(pin.point, [letter.area.latitude, letter.area.longitude]); assert.equal(pin.options.icon.iconUrl, "/assets/surprise-map/letter-pin.svg");
  pin.events.click(); assert.deepEqual(selected, [letter.id, letter.id, letter.id]); runtime.destroy();
});
test("Amap source draws letters in GCJ-02 and returns WGS84 coordinates from the picker", async () => {
  const amapLetter = { ...letter, area: { latitude: 39.9087, longitude: 116.3975, radius_m: 300 } };
  const fixture = fakeLibrary(), runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject: fakeDocument(), tileSource: { id: "amap" } });
  runtime.update({ items: [amapLetter], position: null, selectedId: null }); await runtime.ready;
  const tiles = fixture.calls.find(call => call[0] === "tiles");
  assert.match(tiles[1], /autonavi\.com/);
  assert.equal(tiles[2].subdomains, "1234");
  const projected = wgs84ToGcj02(39.9087, 116.3975);
  assert.deepEqual(fixture.circles[0].point, [projected.latitude, projected.longitude]);
  assert.notDeepEqual(fixture.circles[0].point, [39.9087, 116.3975]);
  runtime.destroy();

  const pickerFixture = fakeLibrary(), points = [];
  const pickerRuntime = mountSurpriseMap({}, { load: async () => pickerFixture.library, documentObject: fakeDocument(), picker: true, tileSource: { id: "amap" }, onPick: value => points.push(value) });
  pickerRuntime.update({ items: [], position: null, selectedId: null, pickerPoint: null }); await pickerRuntime.ready;
  pickerFixture.mapHandlers.click({ latlng: { lat: projected.latitude, lng: projected.longitude } });
  assert.ok(Math.abs(points[0].latitude - 39.9087) < 1e-5);
  assert.ok(Math.abs(points[0].longitude - 116.3975) < 1e-5);
  pickerRuntime.destroy();
});

test("closing before a delayed library load cannot create a map or request tiles", async () => {
  const fixture = fakeLibrary(), statuses = []; let resolve;
  const pending = new Promise(done => { resolve = done; });
  const runtime = mountSurpriseMap({}, { load: () => pending, onStatus: value => statuses.push(value) });
  runtime.destroy(); resolve(fixture.library); await runtime.ready;
  assert.equal(fixture.calls.length, 0); assert.deepEqual(statuses, []);
});
test("the loading deadline also covers a stalled map module download", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = fakeLibrary(), statuses = []; let resolve;
  const pending = new Promise(done => { resolve = done; });
  const runtime = mountSurpriseMap({}, { load: () => pending, onStatus: value => statuses.push(value) });
  await Promise.resolve(); context.mock.timers.tick(18000);
  assert.equal(statuses.at(-1), "timeout"); runtime.destroy(); resolve(fixture.library); await runtime.ready;
  assert.equal(fixture.calls.length, 0);
});
test("map resources pause offscreen and in the background, then detach on unmount", async () => {
  const fixture = fakeLibrary(), documentObject = fakeDocument(), callbacks = {}, disconnected = [];
  class Resize { constructor(callback) { callbacks.resize = callback; } observe() {} disconnect() { disconnected.push("resize"); } }
  class Intersection { constructor(callback) { callbacks.intersection = callback; } observe() {} disconnect() { disconnected.push("intersection"); } }
  const runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject, ResizeObserverClass: Resize, IntersectionObserverClass: Intersection });
  await runtime.ready; assert.equal(fixture.layers.size, 1);
  callbacks.intersection([{ isIntersecting: false }]); assert.equal(fixture.layers.size, 0);
  callbacks.intersection([{ isIntersecting: true }]); assert.equal(fixture.layers.size, 1);
  documentObject.hidden = true; documentObject.events.get("visibilitychange")(); assert.equal(fixture.layers.size, 0);
  documentObject.hidden = false; documentObject.events.get("visibilitychange")(); assert.equal(fixture.layers.size, 1);
  callbacks.resize(); assert.ok(fixture.calls.some(call => call[0] === "resize"));
  runtime.destroy(); runtime.destroy(); assert.equal(documentObject.events.size, 0);
  assert.deepEqual(disconnected.sort(), ["intersection", "resize"]); assert.equal(fixture.calls.filter(call => call[0] === "remove").length, 1);
});
test("tile failures are reported without exposing a raw provider error", async () => {
  const fixture = fakeLibrary(), statuses = [];
  const runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject: fakeDocument(), onStatus: value => statuses.push(value) });
  await runtime.ready; fixture.handlers.tileerror({ message: "PRIVATE_PROVIDER_ERROR" }); assert.equal(statuses.at(-1), "unavailable");
  fixture.handlers.load(); assert.equal(statuses.at(-1), "unavailable");
  fixture.handlers.loading(); fixture.handlers.load(); assert.equal(statuses.at(-1), "ready");
  runtime.destroy(); fixture.handlers.load(); assert.equal(statuses.at(-1), "ready");
  const failed = mountSurpriseMap({}, { load: async () => { throw Error("PRIVATE_PROVIDER_ERROR"); }, onStatus: value => statuses.push(value) });
  await failed.ready; assert.equal(statuses.at(-1), "failed"); failed.destroy();
});
test("selecting a letter focuses only its blurred area; viewing all does not request location", async () => {
  const fixture = fakeLibrary(), runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject: fakeDocument() });
  runtime.update({ items: [letter], position: null, selectedId: letter.id }); await runtime.ready;
  assert.deepEqual(fixture.calls.filter(call => call[0] === "fit").at(-1)[1], [[letter.area.latitude, letter.area.longitude], letter.area.radius_m]);
  runtime.fit(); assert.deepEqual(fixture.calls.filter(call => call[0] === "fit").at(-1)[1], [[[letter.area.latitude, letter.area.longitude], letter.area.radius_m]]); runtime.destroy();
});

test("viewport is rounded outward, includes date line and world views, rejects invalid bounds", () => {
  const bounds = (west, south, east, north) => ({ getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north });
  assert.equal(coarseMapViewport(bounds(121.456789, 31.234567, 121.487654, 31.256789)), "121.45,31.23,121.49,31.26");
  assert.equal(coarseMapViewport(bounds(179.985, 9.001, 180.015, 10.999)), "179.98,9,-179.98,11");
  assert.equal(coarseMapViewport(bounds(179.999, 9.001, -179.999, 10.999)), "179.99,9,-179.99,11");
  assert.equal(coarseMapViewport(bounds(-200, -100, 200, 100)), "-180,-90,180,90");
  assert.equal(coarseMapViewport(bounds(NaN, 1, 3, 2)), null);
  assert.equal(coarseMapViewport(bounds(1, 2, 3, 2)), null);
});

test("public view movement debounces coarsened bounds, deduplicates same view and cancels after disposal", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = fakeLibrary(), seen = [];
  const runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject: fakeDocument(), onViewport: value => seen.push(value) });
  await runtime.ready;
  context.mock.timers.tick(350);
  assert.deepEqual(seen, ["121.45,31.23,121.49,31.26"]);
  fixture.mapHandlers.moveend(); fixture.mapHandlers.moveend(); context.mock.timers.tick(350); assert.equal(seen.length, 1);
  fixture.setBounds({ west: 121.5, south: 31.3, east: 121.6, north: 31.4 });
  fixture.mapHandlers.moveend(); context.mock.timers.tick(200); assert.equal(seen.length, 1);
  fixture.mapHandlers.moveend(); context.mock.timers.tick(350); assert.equal(seen.length, 2);
  assert.doesNotMatch(seen.join(""), /121\.456789|31\.234567/);
  fixture.setBounds({ west: 122, south: 32, east: 122.1, north: 32.1 }); fixture.mapHandlers.moveend(); runtime.destroy();
  context.mock.timers.tick(350); assert.equal(seen.length, 2); assert.equal(fixture.mapHandlers.moveend, undefined);
});

test("public point picker stays neutral and preserves the deliberately chosen public anchor rather than moving it by rounding", async () => {
  const fixture = fakeLibrary(), points = [];
  const runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject: fakeDocument(), picker: true, onPick: value => points.push(value) });
  runtime.update({ items: [], position: null, selectedId: null, pickerPoint: null }); await runtime.ready;
  assert.equal(points.length, 0); assert.equal(fixture.pins.length, 0);
  assert.deepEqual(fixture.calls.filter(call => call[0] === "view").map(call => call[1]), [[25, 105]]);
  fixture.mapHandlers.moveend(); assert.equal(points.length, 0);
  fixture.setCenter({ lat: 31.234567, lng: 121.456789 }); fixture.mapHandlers.dragstart(); fixture.mapHandlers.moveend();
  assert.deepEqual(points, [{ latitude: 31.234567, longitude: 121.456789 }]);
  fixture.mapHandlers.click({ latlng: { lat: 30.123456, lng: 181.234567 } });
  assert.deepEqual(points.at(-1), { latitude: 30.123456, longitude: -178.765433 });
  runtime.update({ items: [], position: null, selectedId: null, pickerPoint: points[0] });
  assert.deepEqual(fixture.pins[0].point, [31.234567, 121.456789]);
  assert.deepEqual(selectedPublicMapPoint({ latitude: 24.44321749, longitude: 118.07643149 }), { latitude: 24.443217, longitude: 118.076431 });
  assert.equal(selectedPublicMapPoint({ latitude: 91, longitude: 118 }), null);
  const click = fixture.mapHandlers.click; runtime.destroy(); click({ latlng: { lat: 1, lng: 2 } }); assert.equal(points.length, 2);
  assert.equal(fixture.mapHandlers.dragstart, undefined); assert.equal(fixture.mapHandlers.click, undefined);
});
