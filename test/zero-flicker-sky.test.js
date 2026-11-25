import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeThemePreferences } from "../src/dengta-theme.js";
import { getSunGlassSky } from "../src/sun-glass-sky.js";

test("zero-flicker sky engine removes dawn/dusk canvas teardown and software ctx.filter blur", () => {
  const backdrop = fs.readFileSync(new URL("../src/CelestialBackdrop.jsx", import.meta.url), "utf8");
  const deck = fs.readFileSync(new URL("../src/SunGlassTimeDeck.jsx", import.meta.url), "utf8");
  const coast = fs.readFileSync(new URL("../src/CoastVideoBackdrop.jsx", import.meta.url), "utf8");
  const theme = fs.readFileSync(new URL("../src/dengta-theme.js", import.meta.url), "utf8");
  const lumenCss = fs.readFileSync(new URL("../src/lumen-sky.css", import.meta.url), "utf8");

  const backdropCode = backdrop.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(backdropCode, /const\s+starsVisible\s*=/, "starsVisible must not live in effect dependencies or blank canvases at dawn/dusk");
  assert.doesNotMatch(backdropCode, /\.filter\s*=\s*["'`]blur\(/, "2D canvas hot loop must not execute software Gaussian blur");
  assert.match(deck, /SCRUB_COMMIT_INTERVAL_MS\s*=\s*16/, "time scrubber must lock to 60fps cadence");
  assert.match(deck, /sun-glass-ruler-ticks/, "time deck must render the video-inspired precision tick-ruler");
  assert.match(coast, /preloadCoastPosters/, "coast backdrop must preload WebP posters to prevent blank decode flashes");
  assert.match(coast, /isTimeScrubbingNow/, "coast backdrop must defer decoder reload while actively scrubbing");
  assert.match(lumenCss, /\[data-time-scrubbing="true"\][\s\S]*?transition-duration:\s*0ms\s*!important/);
  assert.doesNotMatch(
    theme,
    /writeThemePreferences\([\s\S]*?applyThemePreferences\([\s\S]*?\[accountScope,\s*preferences,\s*snapshot\]/,
    "localStorage writes must not fire on every 16ms time-scrubbing snapshot frame",
  );
});

test("lumen background mode is accepted by theme normalization and stays continuous across midnight", () => {
  assert.equal(normalizeThemePreferences({ background: "lumen" }).background, "lumen");
  assert.equal(normalizeThemePreferences({ background: "auto" }).background, "auto");
  assert.equal(normalizeThemePreferences({ background: "unknown" }).background, "auto");

  // Verify continuous sky across full 24h sweep without NaN or undefined stops
  for (let minute = 0; minute <= 1440; minute += 15) {
    const sky = getSunGlassSky(minute);
    assert.equal(sky.colors.length, 5);
    assert.ok(Number.isFinite(sky.sunX) && Number.isFinite(sky.sunY));
    assert.ok(sky.night >= 0 && sky.night <= 1);
  }
});
