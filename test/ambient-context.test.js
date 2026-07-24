import assert from "node:assert/strict";
import {
  AMBIENT_LOCATION_CACHE_KEY,
  buildAmbientContext,
  describeGeolocationError,
  formatShanghaiClock,
  normalizeCoordinates,
  normalizeWeather,
  readCachedCoordinates,
  storeCachedCoordinates,
} from "../src/ambient-context.js";
import {
  STICKER_CATALOG,
  findStickersByMood,
  getStickerAssetPath,
  getStickerById,
  isStickerId,
  selectStickerByMood,
} from "../src/sticker-catalog.js";

const clock = formatShanghaiClock("2026-07-23T11:05:00Z");
assert.equal(clock.time, "19:05");
assert.match(clock.date, /7月23日/);
assert.equal(clock.dateTime, "2026-07-23T19:05:00+08:00");

assert.deepEqual(normalizeCoordinates({ latitude: 31.230416, longitude: 121.473701 }), {
  latitude: 31.23,
  longitude: 121.47,
});
assert.equal(normalizeCoordinates({ latitude: 100, longitude: 0 }), null);

const values = new Map();
const storage = {
  getItem(key) {
    return values.get(key) || null;
  },
  setItem(key, value) {
    values.set(key, value);
  },
  removeItem(key) {
    values.delete(key);
  },
};

assert.equal(
  storeCachedCoordinates(
    { latitude: 31.230416, longitude: 121.473701, accuracy: 18.4 },
    storage,
    1_000,
  ),
  true,
);
assert.equal(readCachedCoordinates(storage, 2_000, 10_000).state, "fresh");
assert.deepEqual(
  readCachedCoordinates(storage, 2_000, 10_000).coordinates,
  { latitude: 31.23, longitude: 121.47, accuracy: 18 },
);
assert.equal(readCachedCoordinates(storage, 12_000, 10_000).state, "expired");
assert.equal(values.has(AMBIENT_LOCATION_CACHE_KEY), false);

values.set(AMBIENT_LOCATION_CACHE_KEY, "{bad-json");
assert.equal(readCachedCoordinates(storage).state, "invalid");
assert.equal(values.has(AMBIENT_LOCATION_CACHE_KEY), false);

assert.equal(describeGeolocationError({ code: 1 }).state, "denied");
assert.equal(describeGeolocationError({ code: 3 }).state, "timeout");
assert.equal(describeGeolocationError({ code: 2 }).state, "unavailable");

const weather = normalizeWeather({
  current: {
    temperature_2m: 27.34,
    weather_code: 2,
    wind_speed_10m: 8.45,
    time: "2026-07-23T19:00",
  },
});
assert.deepEqual(weather, {
  temperatureC: 27.3,
  description: "局部多云",
  weatherCode: 2,
  windSpeedKmh: 8.5,
  updatedAt: "2026-07-23T19:00",
});
assert.equal(normalizeWeather({ current: {} }), null);

const context = buildAmbientContext({
  clock,
  weather,
  locationEnabled: true,
});
assert.deepEqual(context.weather, {
  temperatureC: 27.3,
  description: "局部多云",
  weatherCode: 2,
  windSpeedKmh: 8.5,
  updatedAt: "2026-07-23T19:00",
});
assert.equal("latitude" in context, false);
assert.equal(JSON.stringify(context).includes("121.47"), false);

assert.deepEqual(
  STICKER_CATALOG.map((item) => item.id),
  [
    "bear-sleepy",
    "bear-hug",
    "bear-miss-you",
    "bear-cheer",
    "bear-shy",
    "bear-goodnight",
  ],
);
assert.equal(isStickerId("bear-hug"), true);
assert.equal(isStickerId("../bear-hug"), false);
assert.equal(getStickerById("missing"), null);
assert.equal(getStickerAssetPath("../../secrets"), null);
assert.equal(
  getStickerAssetPath("bear-goodnight"),
  "/assets/stickers/bear-goodnight.jpg",
);
assert.equal(selectStickerByMood(["night", "sleepy"]).id, "bear-sleepy");
assert.deepEqual(
  findStickersByMood(["love", "hug"], { limit: 2 }).map((item) => item.id),
  ["bear-hug", "bear-miss-you"],
);
assert.deepEqual(findStickersByMood(["../../../etc/passwd"]), []);

console.log("frontend ambient context and sticker catalog tests passed");
