import assert from "node:assert/strict";
import test from "node:test";
import {
  applyThemePreferences,
  DEFAULT_THEME_PREFERENCES,
  getCelestialSnapshot,
  normalizeThemePreferences,
} from "../src/dengta-theme.js";
import fs from "node:fs";

test("theme preferences reject invalid colours, opacity and modes", () => {
  assert.deepEqual(
    normalizeThemePreferences({
      preset: "missing",
      accent: "rainbow",
      card: "#fff",
      cardOpacity: 4,
      appearance: "system",
    }),
    DEFAULT_THEME_PREFERENCES,
  );
});

test("the China-time light cycle resolves deterministic phases and shadows", () => {
  const dawn = getCelestialSnapshot(
    new Date("2026-07-27T22:30:00.000Z"),
    "auto",
  );
  const night = getCelestialSnapshot(
    new Date("2026-07-27T15:30:00.000Z"),
    "auto",
  );
  const repeated = getCelestialSnapshot(
    new Date("2026-07-27T15:30:00.000Z"),
    "auto",
  );

  assert.equal(dawn.phase, "dawn");
  assert.equal(dawn.resolvedAppearance, "day");
  assert.equal(night.phase, "night");
  assert.equal(night.resolvedAppearance, "night");
  assert.equal(night.pattern, repeated.pattern);
});

test("theme colours reach the wallpaper and shared optical-glass material", () => {
  const values = new Map();
  const root = {
    dataset: {},
    style: {
      setProperty(name, value) {
        values.set(name, value);
      },
    },
  };
  applyThemePreferences(
    {
      ...DEFAULT_THEME_PREFERENCES,
      accent: "#345678",
      card: "#abcdef",
    },
    getCelestialSnapshot(new Date("2026-07-28T04:00:00.000Z"), "day"),
    root,
  );

  assert.equal(values.get("--theme-accent-rgb"), "52 86 120");
  assert.equal(values.get("--theme-card-source-rgb"), "171 205 239");
  assert.equal(
    values.get("--theme-card-rgb"),
    "237 241 243",
    "high-chroma custom card colours must be softened into optical glass",
  );
  assert.equal(values.get("--theme-wallpaper-tint-rgb"), "52 86 120");
  assert.ok(values.has("--theme-glass-highlight"));
  assert.ok(values.has("--theme-glass-shadow"));

  const styles = fs.readFileSync(
    new URL("../src/native-feel.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.message-list\s*\{[\s\S]*?--theme-wallpaper-tint-rgb[\s\S]*?background-blend-mode:/,
    "the bear wallpaper itself must be colour-mapped by the selected theme",
  );
  assert.match(
    styles,
    /\.message-row\.assistant \.message-bubble[\s\S]*?--theme-card-rgb/,
    "assistant glass must use the same live card colour as Theme Studio",
  );
});
