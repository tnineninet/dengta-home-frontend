import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compassBearing,
  computeExplorationMetrics,
  haversineMeters,
  inspectLocationPermission,
  startSurpriseMapWatch,
} from "../src/surprise-map.js";
import { TILE_SOURCE_PRESETS, normalizeTileSource } from "../src/map-tile-sources.js";
import { createPreviewSurpriseMapSession } from "../src/surprise-map-preview-store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

test("haversine + 8-way compass bearing + proximity warmth/progress metrics are accurate", () => {
  const origin = { latitude: 23.1291, longitude: 113.2644 };
  const northLetter = { area: { latitude: 23.1301, longitude: 113.2644, radius_m: 300 } };
  const dist = haversineMeters(origin, northLetter.area);
  assert.ok(dist > 95 && dist < 125);

  const bearing = compassBearing(origin, northLetter.area);
  assert.equal(bearing.label, "正北");
  assert.ok(bearing.degrees <= 5 || bearing.degrees >= 355);

  const hotMetrics = computeExplorationMetrics(northLetter, origin);
  assert.equal(hotMetrics.inArea, true);
  assert.equal(hotMetrics.warmth, "hot");
  assert.equal(hotMetrics.progress, 100);

  const farLetter = { area: { latitude: 23.165, longitude: 113.305, radius_m: 300 } };
  const farMetrics = computeExplorationMetrics(farLetter, origin);
  assert.equal(farMetrics.inArea, false);
  assert.equal(farMetrics.bearing.label, "东北");
  assert.ok(farMetrics.progress < 50);
});

test("inspectLocationPermission reports native fine/coarse/settings capability and web permissions cleanly", async () => {
  const nativeCap = {
    isPluginAvailable: (name) => name === "Whereabouts",
    Plugins: {
      Whereabouts: {
        checkPermissions: async () => ({ granted: true, fineGranted: false, coarseGranted: true, locationEnabled: true }),
        openLocationSettings: async () => ({ opened: true }),
      },
    },
  };
  const nativePerm = await inspectLocationPermission({ capacitor: nativeCap });
  assert.equal(nativePerm.platform, "native");
  assert.equal(nativePerm.state, "granted");
  assert.equal(nativePerm.coarseGranted, true);
  assert.equal(nativePerm.fineGranted, false);
  assert.equal(nativePerm.canOpenSettings, true);

  const webPerm = await inspectLocationPermission({
    capacitor: {},
    navigatorObject: {
      geolocation: {},
      permissions: { query: async () => ({ state: "denied" }) },
    },
  });
  assert.equal(webPerm.platform, "web");
  assert.equal(webPerm.state, "denied");
});

test("startSurpriseMapWatch streams native exploration updates and stops cleanly on cleanup", async () => {
  let listener = null;
  let stopped = false;
  let removed = false;
  const nativeCap = {
    isPluginAvailable: (name) => name === "Whereabouts",
    Plugins: {
      Whereabouts: {
        requestPermissions: async () => ({ granted: true }),
        addListener: async (_ev, cb) => { listener = cb; return { remove: async () => { removed = true; } }; },
        startExplorationWatch: async () => ({ watching: true }),
        stopExplorationWatch: async () => { stopped = true; return { watching: false }; },
      },
    },
  };
  const updates = [];
  const stop = await startSurpriseMapWatch({
    capacitor: nativeCap,
    onPosition: (pos) => updates.push(pos),
  });
  listener({ latitude: 23.1291, longitude: 113.2644, accuracy: 15, timestamp: Date.now() });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].accuracy, 15);
  await stop();
  assert.equal(removed, true);
  assert.equal(stopped, true);
});

test("Carto Voyager tile preset is usable keyless and preview sandbox supports claim + collect flow", async () => {
  const carto = normalizeTileSource(TILE_SOURCE_PRESETS.carto_voyager);
  assert.equal(carto.usable, true);
  assert.equal(carto.crs, "wgs84");

  const session = createPreviewSurpriseMapSession({ aiName: "小灯" });
  const list = await session.request("/api/v2/surprise-map/letters");
  assert.equal(list.ok, true);
  assert.equal(list.letters.length, 3);
  assert.equal(list.letters[0].body, undefined);

  const claimed = await session.request(`/api/v2/surprise-map/letters/${list.letters[0].id}/claim`, {
    method: "POST",
    body: { latitude: 23.1291, longitude: 113.2644, accuracy: 15, captured_at: new Date().toISOString() },
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.letter.claimed, true);
  assert.ok(claimed.letter.body.length > 10);

  const coll = await session.request("/api/v2/surprise-map/collection?offset=0&limit=40");
  assert.ok(coll.letters.some((c) => c.id === list.letters[0].id));
});

test("Android WhereaboutsPlugin supports Android 12+ fused/GPS/network, coarse+fine permissions, settings jump, and exploration watch", () => {
  const javaSrc = fs.readFileSync(
    path.join(root, "android", "app", "src", "main", "java", "home", "dengta", "app", "WhereaboutsPlugin.java"),
    "utf8",
  );
  assert.match(javaSrc, /FUSED_PROVIDER/);
  assert.match(javaSrc, /hasCoarseLocationPermission/);
  assert.match(javaSrc, /openLocationSettings/);
  assert.match(javaSrc, /startExplorationWatch/);
  assert.match(javaSrc, /stopExplorationWatch/);
  assert.match(javaSrc, /call\.getBoolean\("fresh", false\)/);
});
