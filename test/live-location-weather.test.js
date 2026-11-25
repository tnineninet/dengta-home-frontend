import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

import {
  buildAmbientContext,
  formatLocalClock,
  isValidTimeZone,
  normalizeCoordinates,
  normalizeWeather,
} from "../src/ambient-context.js";
import {
  estimateApproximateLocationByIp,
  fetchOpenMeteoWeather,
  reverseGeocodeCity,
  searchCitiesByName,
} from "../src/live-location-weather.js";
import { getSolarSchedule } from "../src/solar-cycle.js";
import { getCelestialSnapshot } from "../src/dengta-theme.js";
import { solarSkyMinute } from "../src/sun-glass-sky.js";
import { createDefaultCompanionStatus } from "../src/companion-status.js";

test("dynamic timezone clock & solar schedule adapt accurately across world timezones", () => {
  assert.equal(isValidTimeZone("Asia/Tokyo"), true);
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("Invalid/Zone_999"), false);

  const utcMoment = new Date("2026-07-23T12:00:00Z");
  const shanghai = formatLocalClock(utcMoment, "Asia/Shanghai");
  const tokyo = formatLocalClock(utcMoment, "Asia/Tokyo");
  const london = formatLocalClock(utcMoment, "Europe/London");
  assert.equal(shanghai.time, "20:00");
  assert.equal(tokyo.time, "21:00");
  assert.equal(tokyo.utcOffsetMinutes, 540);
  assert.equal(london.time, "13:00"); // BST (+01:00)

  // Tokyo solar noon (~11:45 JST) vs New York solar noon (~12:55 EDT)
  const tokyoCoords = { latitude: 35.68, longitude: 139.69, timeZone: "Asia/Tokyo" };
  const tokyoSchedule = getSolarSchedule(utcMoment, tokyoCoords, 0, "Asia/Tokyo");
  assert.equal(tokyoSchedule.timeZone, "Asia/Tokyo");
  assert.equal(tokyoSchedule.utcOffsetMinutes, 540);
  const tokyoSnap = getCelestialSnapshot(new Date("2026-07-23T03:00:00Z"), "auto", tokyoCoords, "Asia/Tokyo");
  assert.equal(tokyoSnap.timeZone, "Asia/Tokyo");
  assert.equal(tokyoSnap.timeLabel, "12:00");
  assert.equal(tokyoSnap.phase, "day");
  assert.equal(tokyoSnap.utcOffsetMinutes, 540);
  const tokyoSkyMin = solarSkyMinute(tokyoSnap.minute, tokyoSnap);
  assert.ok(tokyoSkyMin > 750 && tokyoSkyMin < 870, `Tokyo noon solarSkyMinute should be near 810, got ${tokyoSkyMin}`);

  const nyCoords = { latitude: 40.71, longitude: -74.01, timeZone: "America/New_York" };
  // 2026-07-23T03:00:00Z is 23:00 EDT in New York -> night!
  const nySnap = getCelestialSnapshot(new Date("2026-07-23T03:00:00Z"), "auto", nyCoords, "America/New_York");
  assert.equal(nySnap.timeZone, "America/New_York");
  assert.equal(nySnap.timeLabel, "23:00");
  assert.equal(nySnap.phase, "night");
  assert.equal(nySnap.resolvedAppearance, "night");
});

test("live weather, reverse geocode, city search & IP estimate normalize safely without leaking GPS", async () => {
  const weather = await fetchOpenMeteoWeather({
    latitude: 35.6895,
    longitude: 139.6917,
    fetchImpl: async (url) => {
      assert.match(url, /timezone=auto/);
      assert.match(url, /latitude=35\.69/);
      assert.match(url, /longitude=139\.69/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          timezone: "Asia/Tokyo",
          utc_offset_seconds: 32400,
          current: {
            temperature_2m: 24.4,
            apparent_temperature: 25.1,
            relative_humidity_2m: 62,
            weather_code: 61,
            wind_speed_10m: 12.2,
            time: "2026-07-23T21:00",
          },
          daily: {
            temperature_2m_min: [19.5],
            temperature_2m_max: [27.8],
          },
        }),
      };
    },
  });
  assert.equal(weather.temperatureC, 24.4);
  assert.equal(weather.description, "小雨");
  assert.equal(weather.timeZone, "Asia/Tokyo");
  assert.equal(weather.utcOffsetSeconds, 32400);
  assert.equal(weather.humidityPercent, 62);
  assert.equal(weather.dailyLowC, 19.5);
  assert.equal(weather.dailyHighC, 27.8);

  const city = await reverseGeocodeCity({
    latitude: 31.2304,
    longitude: 121.4737,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ city: "上海市", locality: "黄浦区" }),
    }),
  });
  assert.equal(city, "上海市 · 黄浦区");

  const searchHits = await searchCitiesByName("东京", {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        results: [
          { name: "东京", admin1: "东京都", country: "日本", latitude: 35.6895, longitude: 139.6917, timezone: "Asia/Tokyo" },
        ],
      }),
    }),
  });
  assert.equal(searchHits.length, 1);
  assert.equal(searchHits[0].label, "东京");
  assert.equal(searchHits[0].timeZone, "Asia/Tokyo");
  assert.equal(searchHits[0].latitude, 35.69);

  const ipLoc = await estimateApproximateLocationByIp({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        success: true,
        city: "Guangzhou",
        latitude: 23.1291,
        longitude: 113.2644,
        timezone: { id: "Asia/Shanghai" },
      }),
    }),
  });
  assert.equal(ipLoc.label, "Guangzhou");
  assert.equal(ipLoc.timeZone, "Asia/Shanghai");
  assert.equal(ipLoc.latitude, 23.13);

  const ctx = buildAmbientContext({
    clock: formatLocalClock("2026-07-23T12:00:00Z", "Asia/Tokyo"),
    weather,
    locationEnabled: true,
    timeZone: "Asia/Tokyo",
    locationLabel: "东京",
  });
  assert.equal(ctx.timeZone, "Asia/Tokyo");
  assert.equal(ctx.locationLabel, "东京");
  assert.equal(ctx.localTime, "21:00");
  assert.equal("latitude" in ctx, false);
  assert.equal(JSON.stringify(ctx).includes("139.69"), false);

  // Confirm normalizeCoordinates keeps clean shape without optional fields
  assert.deepEqual(normalizeCoordinates({ latitude: 31.23, longitude: 121.47 }), {
    latitude: 31.23,
    longitude: 121.47,
  });
  assert.equal(normalizeWeather({ temperatureC: 18, timezone: "Europe/London" }).timeZone, "Europe/London");
});

test("AmbientContextBadge controlRef manual city sync + CompanionStatus live weather pill", async () => {
  const descriptors = new Map(
    ["window", "document", "navigator", "localStorage", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
    ),
  );
  const define = (key, value) =>
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  define("IS_REACT_ACT_ENVIRONMENT", true);
  define("localStorage", storage);
  define("fetch", async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ configured: false, state: null }),
    text: async () => JSON.stringify({ configured: false, state: null }),
  }));
  define("navigator", { onLine: true, geolocation: { getCurrentPosition() {} } });
  define("window", {
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
  });
  define("document", { addEventListener() {}, removeEventListener() {} });

  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true, watch: null },
    plugins: [{
      name: "live-weather-portal-stub",
      enforce: "pre",
      transform(code, id) {
        const file = id.replaceAll("\\", "/");
        if (file.endsWith("/src/CompanionStatus.jsx")) {
          return code
            .replace('import { createPortal } from "react-dom";', "const createPortal = children => children;")
            .replace('import { apiRequest } from "./api";', "const apiRequest = async () => ({ configured: false, state: null });");
        }
      },
    }],
  });

  let badgeTree;
  let statusTree;
  try {
    const { default: Badge } = await vite.ssrLoadModule("/src/AmbientContextBadge.jsx");
    const { default: CompanionStatus } = await vite.ssrLoadModule("/src/CompanionStatus.jsx");
    const controlRef = { current: null };
    let latestLive = null;
    let syncedCount = 0;

    await act(async () => {
      badgeTree = TestRenderer.create(
        React.createElement(Badge, {
          accountScope: "test-user",
          controlRef,
          onStatusChange: (live) => { latestLive = live; },
          onLocationSynced: () => { syncedCount += 1; },
          onLoadWeather: async ({ latitude, longitude }) => ({
            temperatureC: 19.2,
            weatherCode: 61,
            timeZone: "Asia/Tokyo",
            locationLabel: latitude > 35 ? "东京" : "上海",
            windSpeedKmh: 9.4,
            updatedAt: "2026-07-23T21:00",
          }),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    assert.ok(controlRef.current?.applyManualLocation);
    await act(async () => {
      controlRef.current.applyManualLocation({
        latitude: 35.68,
        longitude: 139.69,
        label: "东京",
        timeZone: "Asia/Tokyo",
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    assert.equal(syncedCount, 1);
    assert.equal(latestLive.locationEnabled, true);
    assert.equal(latestLive.locationLabel, "东京");
    assert.equal(latestLive.timeZone, "Asia/Tokyo");
    assert.equal(latestLive.weather.temperatureC, 19.2);
    assert.equal(latestLive.weather.description, "小雨");

    let syncClicked = 0;
    await act(async () => {
      statusTree = TestRenderer.create(
        React.createElement(CompanionStatus, {
          status: createDefaultCompanionStatus(),
          aiName: "小灯",
          onChange: () => {},
          ambientLive: latestLive,
          celestialSnapshot: { timeZone: "Asia/Tokyo", sunriseLabel: "04:40", sunsetLabel: "18:52", timeLabel: "21:00" },
          onSyncLocation: () => { syncClicked += 1; },
          onSelectLocation: () => {},
        }),
      );
    });
    const flatten = (node) =>
      typeof node === "string" || typeof node === "number"
        ? String(node)
        : Array.isArray(node)
          ? node.map(flatten).join("")
          : (node?.children || []).map(flatten).join("");
    const renderedText = flatten(statusTree.toJSON());
    assert.match(renderedText, /东京/);
    assert.match(renderedText, /小雨/);
    assert.match(renderedText, /19°C/);
    assert.match(renderedText, /日出 04:40/);
    assert.equal(syncClicked, 0);
  } finally {
    if (badgeTree) await act(async () => badgeTree.unmount());
    if (statusTree) await act(async () => statusTree.unmount());
    await vite.close();
    for (const [key, desc] of descriptors) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  }
});
