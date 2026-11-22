import assert from "node:assert/strict";
import test from "node:test";
import { daylightAt } from "../src/daylight-sky.js";
import { SKY_PHASES } from "../src/daylight-phases.js";
import { normalizeThemePreferences } from "../src/dengta-theme.js";

test("all sampled clocks select their complete atlas tile without blending the next frame", () => {
  SKY_PHASES.forEach(([minute, top, bottom], index) => {
    const sky = daylightAt(minute);
    assert.equal(sky.previous, index);
    assert.equal(sky.mix, 0);
    assert.equal(sky.top, top);
    assert.equal(sky.bottom, bottom);
  });
});

test("intermediate minutes blend only adjacent frames and cross midnight without an index gap", () => {
  for (let minute = 0; minute < 1440; minute++) {
    const sky = daylightAt(minute);
    assert.equal(sky.next, (sky.previous + 1) % SKY_PHASES.length);
    assert.ok(sky.mix >= 0 && sky.mix < 1);
    assert.ok(sky.stars >= 0 && sky.stars <= 1);
  }
  assert.equal(daylightAt(742.5).mix, 0.5);
  assert.equal(daylightAt(1439).next, 0);
  assert.deepEqual(daylightAt(-1), daylightAt(1439));
  assert.deepEqual(daylightAt(1440), daylightAt(0));
  assert.deepEqual(daylightAt(NaN), daylightAt(720));
});

test("daylight stays free of star overlays and nighttime has stationary stars", () => {
  for (const minute of [375, 480, 780, 1050]) assert.equal(daylightAt(minute).stars, 0);
  for (const minute of [0, 60, 240, 1245, 1439]) assert.equal(daylightAt(minute).stars, 1);
});

test("background preferences migrate old coast variants without resetting day/night or custom colors", () => {
  for (const background of ["auto", "coast", "legacy", "legacy-day", "legacy-dusk", "legacy-night"]) {
    const actual = normalizeThemePreferences({ background, appearance: "night", accent: "#123456" });
    assert.equal(actual.background, background.startsWith("legacy-") ? "legacy" : background);
    assert.equal(actual.appearance, "night");
    assert.equal(actual.accent, "#123456");
  }
  assert.equal(normalizeThemePreferences({ background: "invalid" }).background, "auto");
});
