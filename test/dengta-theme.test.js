import assert from "node:assert/strict";
import test from "node:test";
import {
  applyThemePreferences,
  DEFAULT_THEME_PREFERENCES,
  getCelestialSnapshot,
  normalizeThemePreferences,
} from "../src/dengta-theme.js";
import fs from "node:fs";
import {
  formatSolarTime,
  getSolarSchedule,
} from "../src/solar-cycle.js";

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
  assert.equal(night.lightSource, "fallback");
  assert.match(night.sunrise, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(night.sunset, /^\d{4}-\d{2}-\d{2}T/);
});

test("location drives the local astronomical sunrise and sunset", () => {
  const date = new Date("2026-07-28T04:00:00.000Z");
  const schedule = getSolarSchedule(date, {
    latitude: 31.23,
    longitude: 121.47,
  });
  const snapshot = getCelestialSnapshot(date, "auto", {
    latitude: 31.23,
    longitude: 121.47,
  });

  assert.equal(schedule.source, "location");
  assert.ok(schedule.sunrise < schedule.sunset);
  assert.equal(snapshot.lightSource, "location");
  assert.equal(snapshot.sunriseLabel, formatSolarTime(schedule.sunrise));
  assert.ok(snapshot.progress >= 0 && snapshot.progress <= 1);
});

test("theme colours reach the sky and shared optical-glass material", () => {
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
  assert.equal(values.get("--sun-light-intensity"), "1.00");
  assert.equal(values.get("--moon-light-intensity"), "0.86");

  const styles = fs.readFileSync(
    new URL("../src/native-feel.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.message-list\s*\{[\s\S]*?--theme-background-rgb[\s\S]*?background-blend-mode:/,
    "the transparent chat wash must share the live theme background",
  );
  assert.doesNotMatch(
    styles,
    /xiaodeng-taotao-chat-wallpaper/,
    "the retired generated wallpaper must not remain in the chat cascade",
  );
  assert.match(
    styles,
    /\.message-row\.assistant \.message-bubble[\s\S]*?--theme-card-rgb/,
    "assistant glass must use the same live card colour as Theme Studio",
  );
});

test("night mode exposes readable semantic text and control tokens", () => {
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
    DEFAULT_THEME_PREFERENCES,
    getCelestialSnapshot(new Date("2026-07-28T15:30:00.000Z"), "night"),
    root,
  );

  assert.equal(root.dataset.dengtaAppearance, "night");
  assert.match(values.get("--theme-muted"), /rgb\(/);
  assert.match(values.get("--theme-ink-soft"), /rgb\(/);
  assert.match(values.get("--theme-control-border"), /rgb\(/);
  assert.match(values.get("--theme-control-background"), /rgb\(/);

  const styles = fs.readFileSync(
    new URL("../src/native-feel.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /:root\[data-dengta-appearance="night"\][\s\S]*?--muted:\s*var\(--theme-muted\)/,
  );
  assert.match(
    styles,
    /:root\[data-dengta-appearance="night"\][\s\S]*?creative-invitation-card[\s\S]*?--theme-control-border/,
  );
  assert.doesNotMatch(
    styles,
    /data-dengta-appearance="night"[^{}]*\{[^}]*filter:\s*invert/i,
    "night mode must not invert images and glass highlights",
  );
});
