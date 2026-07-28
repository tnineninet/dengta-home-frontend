import { useEffect, useMemo, useState } from "react";

export const DENGTA_THEME_STORAGE_KEY = "dengta.ui-theme.v1";

export const THEME_PRESETS = [
  {
    id: "ivory",
    label: "象牙纸张",
    accent: "#a96854",
    card: "#fffdf8",
    background: "#eee9df",
    ink: "#24211f",
  },
  {
    id: "moon-sand",
    label: "月沙",
    accent: "#c6768f",
    card: "#fbf4f2",
    background: "#d9c6c7",
    ink: "#352e31",
  },
  {
    id: "milk-orange",
    label: "奶油甜橙",
    accent: "#dd8a2e",
    card: "#fff9ed",
    background: "#ecd8bd",
    ink: "#382e25",
  },
  {
    id: "mist-mountain",
    label: "雾山",
    accent: "#709078",
    card: "#f5faf6",
    background: "#b9c8bf",
    ink: "#25302a",
  },
  {
    id: "fog-blue",
    label: "雾蓝",
    accent: "#4f78d3",
    card: "#f3f8ff",
    background: "#bfd0e4",
    ink: "#202a3a",
  },
  {
    id: "ink",
    label: "墨白",
    accent: "#242628",
    card: "#fbfbfa",
    background: "#d8d8d4",
    ink: "#171819",
  },
];

export const DEFAULT_THEME_PREFERENCES = {
  preset: "ivory",
  accent: "#a96854",
  card: "#fffdf8",
  cardOpacity: 0.82,
  appearance: "auto",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const APPEARANCE_MODES = new Set(["auto", "day", "night"]);

function safeColor(value, fallback) {
  return typeof value === "string" && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : fallback;
}

function boundedOpacity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0.56 && parsed <= 0.96
    ? parsed
    : DEFAULT_THEME_PREFERENCES.cardOpacity;
}

export function normalizeThemePreferences(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const preset =
    THEME_PRESETS.find((item) => item.id === source.preset) ||
    THEME_PRESETS[0];
  return {
    preset: preset.id,
    accent: safeColor(source.accent, preset.accent),
    card: safeColor(source.card, preset.card),
    cardOpacity: boundedOpacity(source.cardOpacity),
    appearance: APPEARANCE_MODES.has(source.appearance)
      ? source.appearance
      : DEFAULT_THEME_PREFERENCES.appearance,
  };
}

export function readThemePreferences(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(DENGTA_THEME_STORAGE_KEY);
    return stored
      ? normalizeThemePreferences(JSON.parse(stored))
      : DEFAULT_THEME_PREFERENCES;
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function writeThemePreferences(
  preferences,
  storage = globalThis.localStorage,
) {
  const normalized = normalizeThemePreferences(preferences);
  try {
    storage?.setItem(DENGTA_THEME_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // A private WebView can reject storage; the in-memory theme still works.
  }
  return normalized;
}

function hexToRgbChannels(value) {
  return hexToRgb(value).join(" ");
}

function hexToRgb(value) {
  const normalized = safeColor(value, "#ffffff").slice(1);
  return [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16),
  );
}

function mixRgbChannels(parts) {
  return [0, 1, 2]
    .map((channel) =>
      Math.round(
        parts.reduce(
          (total, part) => total + part.rgb[channel] * part.weight,
          0,
        ),
      ),
    )
    .join(" ");
}

function chinaTimeParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function stablePatternIndex(value, count) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % count;
}

export function getCelestialSnapshot(
  date = new Date(),
  appearance = "auto",
) {
  const parts = chinaTimeParts(date);
  const hour = Number(parts.hour) + Number(parts.minute) / 60;
  const phase =
    hour >= 5 && hour < 8
      ? "dawn"
      : hour >= 8 && hour < 17
        ? "day"
        : hour >= 17 && hour < 20
          ? "dusk"
          : "night";
  const resolvedAppearance =
    appearance === "auto"
      ? phase === "night"
        ? "night"
        : "day"
      : appearance;
  const patterns = ["cat", "grid", "diamond", "botanical"];
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const pattern =
    patterns[stablePatternIndex(`${dateKey}:${phase}`, patterns.length)];
  const isSun = phase !== "night";
  const daylightProgress = Math.min(1, Math.max(0, (hour - 5) / 15));
  const moonHour = hour < 5 ? hour + 24 : hour;
  const moonProgress = Math.min(1, Math.max(0, (moonHour - 20) / 9));
  const progress = isSun ? daylightProgress : moonProgress;
  const arc = 4 * progress * (1 - progress);

  return {
    dateKey,
    hour,
    phase,
    pattern,
    resolvedAppearance,
    isSun,
    progress,
    arc,
    moonPeak: phase === "night" && (hour >= 22 || hour < 2),
  };
}

export function applyThemePreferences(preferences, snapshot, root) {
  if (!root) return;
  const normalized = normalizeThemePreferences(preferences);
  const preset =
    THEME_PRESETS.find((item) => item.id === normalized.preset) ||
    THEME_PRESETS[0];
  const isNight = snapshot.resolvedAppearance === "night";
  const isGoldenHour = ["dawn", "dusk"].includes(snapshot.phase);
  const accentRgb = hexToRgbChannels(normalized.accent);
  const cardSource = hexToRgb(normalized.card);
  const presetBackground = hexToRgb(preset.background);
  const cardSourceRgb = cardSource.join(" ");
  const cardRgb = isNight
    ? mixRgbChannels([
        { rgb: cardSource, weight: 0.14 },
        { rgb: [22, 26, 32], weight: 0.86 },
      ])
    : mixRgbChannels([
        { rgb: cardSource, weight: 0.16 },
        { rgb: presetBackground, weight: 0.28 },
        { rgb: [255, 255, 255], weight: 0.56 },
      ]);
  const resolvedBackground = isNight ? "#171a20" : preset.background;
  const backgroundRgb = hexToRgbChannels(resolvedBackground);
  const resolvedInk = isNight ? "#eef0f0" : preset.ink;
  const inkRgb = hexToRgbChannels(resolvedInk);
  root.dataset.dengtaTheme = normalized.preset;
  root.dataset.dengtaAppearance = snapshot.resolvedAppearance;
  root.dataset.dengtaPhase = snapshot.phase;
  root.style.setProperty("--theme-accent", normalized.accent);
  root.style.setProperty("--theme-accent-rgb", accentRgb);
  root.style.setProperty("--theme-card-source-rgb", cardSourceRgb);
  root.style.setProperty("--theme-card-rgb", cardRgb);
  root.style.setProperty(
    "--theme-card-opacity",
    String(normalized.cardOpacity),
  );
  root.style.setProperty("--theme-background", resolvedBackground);
  root.style.setProperty("--theme-background-rgb", backgroundRgb);
  root.style.setProperty("--theme-ink", resolvedInk);
  root.style.setProperty("--theme-ink-rgb", inkRgb);
  root.style.setProperty("--theme-wallpaper-tint-rgb", accentRgb);
  root.style.setProperty(
    "--theme-wallpaper-tint-opacity",
    String(isNight ? 0.38 : isGoldenHour ? 0.26 : 0.18),
  );
  root.style.setProperty(
    "--theme-wallpaper-veil-opacity",
    String(isNight ? 0.52 : isGoldenHour ? 0.34 : 0.24),
  );
  root.style.setProperty(
    "--theme-glass-highlight",
    `rgb(${cardRgb} / ${isNight ? 0.2 : 0.72})`,
  );
  root.style.setProperty(
    "--theme-glass-shadow",
    isNight ? "rgb(5 9 16 / 0.3)" : `rgb(${inkRgb} / 0.11)`,
  );
  root.style.setProperty(
    "--theme-glass-border",
    `rgb(${cardRgb} / ${isNight ? 0.24 : 0.78})`,
  );
}

export function useDengTaTheme() {
  const [preferences, setPreferences] = useState(readThemePreferences);
  const [clock, setClock] = useState(() => new Date());
  const snapshot = useMemo(
    () => getCelestialSnapshot(clock, preferences.appearance),
    [clock, preferences.appearance],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const normalized = writeThemePreferences(preferences);
    applyThemePreferences(normalized, snapshot, document.documentElement);
  }, [preferences, snapshot]);

  function updateTheme(patch) {
    setPreferences((current) =>
      normalizeThemePreferences({
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      }),
    );
  }

  return { preferences, snapshot, updateTheme };
}
