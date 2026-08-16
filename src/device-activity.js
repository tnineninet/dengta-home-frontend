import { Capacitor, registerPlugin } from "@capacitor/core";

export const DEVICE_ACTIVITY_WINDOW_MINUTES = 30;
export const DEVICE_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;

export const DeviceActivity = registerPlugin("DeviceActivity");

function boundedInteger(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function safeAppName(value) {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/\s+/g, " ").trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .slice(0, 40)
    .join("")
    .trim();
}

export function normalizeDeviceActivityState(value) {
  return Object.freeze({
    supported: value?.supported === true,
    enabled: value?.enabled === true,
    permissionGranted: value?.permissionGranted === true,
  });
}

export function normalizeDeviceActivitySummary(value) {
  const capturedTime = Date.parse(value?.capturedAt);
  if (!Number.isFinite(capturedTime)) return null;

  const windowMinutes = boundedInteger(value?.windowMinutes, 5, 120, 0);
  if (!windowMinutes || !Array.isArray(value?.apps)) return null;

  const apps = value.apps
    .slice(0, 6)
    .map((item) => {
      const name = safeAppName(item?.name);
      if (!name) return null;
      const launchCount = boundedInteger(item?.launchCount, 0, 100);
      const hasForegroundSeconds = Number.isFinite(
        Number(item?.foregroundSeconds),
      );
      const foregroundMinutes = hasForegroundSeconds
        ? Math.round(
            boundedInteger(
              item.foregroundSeconds,
              0,
              windowMinutes * 60,
            ) / 60,
          )
        : boundedInteger(item?.foregroundMinutes, 0, windowMinutes);
      return Object.freeze({
        name,
        launchCount,
        foregroundMinutes: Math.min(
          windowMinutes,
          Math.max(0, foregroundMinutes),
        ),
      });
    })
    .filter(Boolean);

  if (apps.length === 0) return null;
  return Object.freeze({
    capturedAt: new Date(capturedTime).toISOString(),
    windowMinutes,
    apps: Object.freeze(apps),
  });
}

export function normalizeCurrentApp(value) {
  const app = value?.currentApp;
  if (!app?.name) return null;
  return Object.freeze({
    name: safeAppName(app.name),
    packageName: safeAppName(app.packageName) || "",
    sinceSeconds: boundedInteger(app.sinceSeconds, 0, 300, 0),
  });
}

export async function readCurrentApp({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return null;
  try {
    return normalizeCurrentApp(await plugin.getCurrentApp());
  } catch {
    return null;
  }
}


export function normalizeNowPlaying(value) {
  const song = value?.nowPlaying;
  if (!song || !song.title) return null;
  return Object.freeze({
    title: String(song.title || "").slice(0, 120),
    artist: String(song.artist || "").slice(0, 120),
    album: String(song.album || "").slice(0, 120),
    packageName: String(song.packageName || "").slice(0, 80),
    isPlaying: song.isPlaying === true,
    durationSeconds: Number(song.duration) > 0 ? Math.round(Number(song.duration) / 1000) : 0,
    positionSeconds: Number(song.position) > 0 ? Math.round(Number(song.position) / 1000) : 0,
    cover: typeof song.cover === "string" && song.cover.startsWith("data:image") ? song.cover : "",
  });
}

export async function readNowPlaying({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return null;
  try {
    return normalizeNowPlaying(await plugin.getNowPlaying());
  } catch {
    return null;
  }
}


export async function controlNowPlaying(action, {
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return false;
  try {
    const result = await plugin.controlNowPlaying({ action: String(action || "toggle") });
    return result?.controlled === true;
  } catch {
    return false;
  }
}


export async function readNotificationAccessState({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return { granted: false };
  try {
    const result = await plugin.getNotificationAccessState();
    return { granted: result?.granted === true };
  } catch {
    return { granted: false };
  }
}

export async function openNotificationAccessSettings({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return false;
  try {
    await plugin.openNotificationAccessSettings();
    return true;
  } catch {
    return false;
  }
}

export function mergeCurrentAppContext(environmentContext, currentApp) {
  const source =
    environmentContext &&
    typeof environmentContext === "object" &&
    !Array.isArray(environmentContext)
      ? environmentContext
      : {};
  const next = { ...source };
  delete next.current_app;
  delete next.currentApp;
  return currentApp ? { ...next, currentApp } : next;
}

export function mergeDeviceActivityContext(environmentContext, summary) {
  const source =
    environmentContext &&
    typeof environmentContext === "object" &&
    !Array.isArray(environmentContext)
      ? environmentContext
      : {};
  const next = { ...source };
  delete next.device_activity;
  delete next.deviceActivity;

  const normalized = normalizeDeviceActivitySummary(summary);
  return normalized ? { ...next, deviceActivity: normalized } : next;
}

export function deviceActivityPluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("DeviceActivity")
  );
}

export async function readDeviceActivityState({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) {
    return normalizeDeviceActivityState({});
  }
  return normalizeDeviceActivityState(await plugin.getState());
}
