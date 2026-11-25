import { Capacitor } from "@capacitor/core";

export function surpriseMapError(error, { operation = "write" } = {}) {
  const code = /^[a-z0-9_]{1,90}$/i.test(String(error?.code || "")) ? error.code : "surprise_map_request_failed";
  const help = {
    surprise_map_schema_required: "藏宝地图的数据结构尚未安装，现有聊天与记忆不受影响。",
    surprise_map_receipt_invalid: "服务器没有返回有效确认，草稿仍保留；请刷新核对后重试。",
    surprise_map_request_conflict: "上次留信请求已绑定另一份内容或地点，请先刷新核对结果，再重新开始。",
    surprise_map_location_required: "请点击定位，只使用本次位置来核对距离。",
    surprise_map_location_invalid: "定位结果不完整，请打开精确定位后重新尝试。",
    surprise_map_location_stale: "这次定位已过期，请重新定位。",
    surprise_map_accuracy_insufficient: "定位精度不足，请到开阔位置重试。",
    surprise_map_too_far: "还没到信件附近，走近一些后再点击领取。",
    surprise_map_out_of_range: "还没到信件附近，走近一些后再点击领取。",
    surprise_map_location_inaccurate: "定位精度不足，请到开阔位置重试。",
    surprise_map_draft_failed: "本次模型未返回完整信件，可以重试写信或自行填写。",
    surprise_map_publication_exists: "这封信已有公开版本，请先刷新查看，避免重复发布。",
    surprise_map_invalid_request: "请检查标题、正文、地点与坐标是否完整。",
    surprise_map_viewport_invalid: "地图查看范围无效，请缩放到附近区域后刷新；不会因此重新获取定位。",
    surprise_map_not_found: "这封信已撤回，或不属于当前空间，请刷新。",
    surprise_map_draft_unavailable: "当前模型暂时无法写信，请检查接口设置；也可以自己填写。",
    surprise_map_draft_invalid: "模型没有返回完整信件，可重试写信或自行填写。",
    surprise_map_publication_confirmation_required: "请先预览公开内容并确认，再发布。",
    location_permission_denied: "未获定位授权。可以继续浏览，或在系统设置中允许位置后再试。",
    location_disabled: "手机系统定位开关尚未打开，请打开 GPS/位置服务后再试。",
    location_unavailable: "暂时无法定位，请检查定位开关与网络。",
    location_timeout: "定位超时，请到开阔位置后重试。",
    settings_scope_changed: "空间已切换，本次操作已取消。",
    request_timeout: "等待确认超时，请先刷新核对结果，避免重复留信。",
  };
  if (operation === "read" && ["request_timeout", "request_failed", "network_error", "surprise_map_request_failed", "surprise_map_receipt_invalid"].includes(code)) {
    return `来信列表暂时未加载成功，请点击重新加载；已藏好的信与本页草稿不会改变。（${code}）`;
  }
  return `${help[code] || "本次操作未确认完成，请刷新核对；仍失败时可提供错误代码检查。"}（${code}）`;
}

export function validMapLocation(location) {
  return location && typeof location.latitude === "number" && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 &&
    typeof location.longitude === "number" && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180 &&
    typeof location.accuracy === "number" && Number.isFinite(location.accuracy) && location.accuracy >= 0;
}

function withLocationTimeout(promise, timeoutMs, code = "location_timeout") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Location timed out"), { code })), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * 统一读取当前手机 App（Capacitor Whereabouts 插件）或浏览器的定位权限状态。
 * 只读检查，绝不弹出权限框、也不触发定位。
 */
export async function inspectLocationPermission({
  capacitor = Capacitor,
  navigatorObject = globalThis.navigator,
} = {}) {
  if (capacitor?.isPluginAvailable?.("Whereabouts")) {
    try {
      const res = await capacitor.Plugins.Whereabouts.checkPermissions();
      return {
        platform: "native",
        state: res?.granted === true ? "granted" : "prompt",
        fineGranted: typeof res?.fineGranted === "boolean" ? res.fineGranted : res?.granted === true,
        coarseGranted: typeof res?.coarseGranted === "boolean" ? res.coarseGranted : res?.granted === true,
        locationEnabled: res?.locationEnabled !== false,
        canOpenSettings: typeof capacitor.Plugins.Whereabouts.openLocationSettings === "function",
      };
    } catch {
      return { platform: "native", state: "prompt", fineGranted: false, coarseGranted: false, locationEnabled: true, canOpenSettings: false };
    }
  }
  if (!navigatorObject?.geolocation) {
    return { platform: "web", state: "unsupported", fineGranted: false, coarseGranted: false, locationEnabled: false, canOpenSettings: false };
  }
  try {
    if (typeof navigatorObject.permissions?.query === "function") {
      const status = await navigatorObject.permissions.query({ name: "geolocation" });
      const state = ["granted", "denied", "prompt"].includes(status?.state) ? status.state : "prompt";
      return { platform: "web", state, fineGranted: state === "granted", coarseGranted: state === "granted", locationEnabled: true, canOpenSettings: false };
    }
  } catch {
    // Safari / older WebView doesn't support permissions.query("geolocation")
  }
  return { platform: "web", state: "prompt", fineGranted: false, coarseGranted: false, locationEnabled: true, canOpenSettings: false };
}

export async function openDeviceLocationSettings({ capacitor = Capacitor } = {}) {
  if (capacitor?.isPluginAvailable?.("Whereabouts") && typeof capacitor.Plugins.Whereabouts.openLocationSettings === "function") {
    try {
      const res = await capacitor.Plugins.Whereabouts.openLocationSettings();
      return res?.opened === true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function locateForSurpriseMap({
  capacitor = Capacitor,
  geolocation = globalThis.navigator?.geolocation,
  now = () => Date.now(),
  fresh = false,
} = {}) {
  let location, capturedAt;
  if (capacitor?.isPluginAvailable?.("Whereabouts")) {
    const plugin = capacitor.Plugins.Whereabouts;
    const permission = await withLocationTimeout(plugin.requestPermissions(), 20_000, "location_permission_denied");
    if (permission?.granted !== true) throw Object.assign(new Error("Location not granted"), { code: "location_permission_denied" });
    const callArgs = fresh ? { fresh: true } : undefined;
    location = await withLocationTimeout(
      callArgs ? plugin.getLocation(callArgs) : plugin.getLocation(),
      15_000,
      "location_timeout",
    );
    if (location?.error === "location_disabled") {
      throw Object.assign(new Error("Location service disabled"), { code: "location_disabled" });
    }
    capturedAt = typeof location?.timestamp === "number" ? location.timestamp : Date.parse(location?.timestamp || "");
  } else {
    if (!geolocation) throw Object.assign(new Error("Geolocation unavailable"), { code: "location_unavailable" });
    const result = await new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve,
      error => reject(Object.assign(new Error("Geolocation failed"), { code: ({ 1: "location_permission_denied", 2: "location_unavailable", 3: "location_timeout" })[error?.code] || "location_unavailable" })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
    location = result.coords;
    capturedAt = result.timestamp;
  }
  if (!Number.isFinite(capturedAt) || now() - capturedAt > 120000 || capturedAt - now() > 30000) throw Object.assign(new Error("Stale location receipt"), { code: "surprise_map_location_stale" });
  const position = { latitude: location?.latitude, longitude: location?.longitude, accuracy: location?.accuracy, captured_at: new Date(capturedAt).toISOString() };
  if (!validMapLocation(position)) throw Object.assign(new Error("Incomplete geolocation receipt"), { code: "surprise_map_location_invalid" });
  return position;
}

/**
 * 仅在用户主动开启「边走边探」时订阅实时定位更新，支持 Android 原生 Whereabouts watch 与 Web watchPosition。
 * 返回同步/异步安全的清理函数，关闭开关或离开页面时立即停止定位省电。
 */
export async function startSurpriseMapWatch({
  capacitor = Capacitor,
  geolocation = globalThis.navigator?.geolocation,
  onPosition,
  onError,
  now = () => Date.now(),
} = {}) {
  const emitValid = (coords, rawTimestamp) => {
    const ts = typeof rawTimestamp === "number" ? rawTimestamp : Date.parse(rawTimestamp || "") || now();
    const pos = {
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      accuracy: typeof coords?.accuracy === "number" ? coords.accuracy : 30,
      captured_at: new Date(ts).toISOString(),
    };
    if (validMapLocation(pos)) onPosition?.(pos);
  };

  if (capacitor?.isPluginAvailable?.("Whereabouts") && typeof capacitor.Plugins.Whereabouts.startExplorationWatch === "function") {
    const plugin = capacitor.Plugins.Whereabouts;
    const permission = await withLocationTimeout(plugin.requestPermissions(), 20_000, "location_permission_denied");
    if (permission?.granted !== true) throw Object.assign(new Error("Location not granted"), { code: "location_permission_denied" });
    const listenerHandle = await plugin.addListener?.("explorationLocation", (payload) => {
      emitValid(payload, payload?.timestamp);
    });
    const started = await plugin.startExplorationWatch();
    if (!started?.watching) {
      await listenerHandle?.remove?.();
      throw Object.assign(new Error("Watch failed"), { code: started?.error || "location_unavailable" });
    }
    return async () => {
      try { await listenerHandle?.remove?.(); } catch { /* ignore */ }
      try { await plugin.stopExplorationWatch?.(); } catch { /* ignore */ }
    };
  }

  if (!geolocation || typeof geolocation.watchPosition !== "function") {
    throw Object.assign(new Error("Geolocation watch unavailable"), { code: "location_unavailable" });
  }
  const watchId = geolocation.watchPosition(
    (result) => emitValid(result?.coords, result?.timestamp),
    (err) => {
      const code = ({ 1: "location_permission_denied", 2: "location_unavailable", 3: "location_timeout" })[err?.code] || "location_unavailable";
      onError?.(Object.assign(new Error("Geolocation watch error"), { code }));
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
  );
  return () => {
    try { geolocation.clearWatch?.(watchId); } catch { /* ignore */ }
  };
}

// Geodesy helpers (Haversine + Forward Azimuth bearing, MIT reference: chrisveness/geodesy)
const COMPASS_LABELS = ["正北", "东北", "正东", "东南", "正南", "西南", "正西", "西北"];

export function haversineMeters(from, to) {
  if (!from || !to) return null;
  if (![from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const dLat = (to.latitude - from.latitude) * rad;
  const dLng = (to.longitude - from.longitude) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function compassBearing(from, to) {
  if (!from || !to) return null;
  if (![from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const lat1 = from.latitude * rad;
  const lat2 = to.latitude * rad;
  const dLng = (to.longitude - from.longitude) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const idx = Math.round(deg / 45) % 8;
  return { degrees: Math.round(deg), label: COMPASS_LABELS[idx] };
}

export function computeExplorationMetrics(letter, position) {
  if (!position || !letter?.area) return null;
  const meters = haversineMeters(position, letter.area);
  if (!Number.isFinite(meters)) return null;
  const bearing = compassBearing(position, letter.area);
  const radius = Math.max(100, Number(letter.area.radius_m) || 300);
  const inArea = meters <= radius;
  let warmth = "far";
  let warmthLabel = "远方来信";
  if (inArea) {
    warmth = "hot";
    warmthLabel = "已在范围内 · 可尝试拆信";
  } else if (meters <= Math.max(600, radius * 2)) {
    warmth = "warm";
    warmthLabel = "热信号 · 很近了";
  } else if (meters <= 2500) {
    warmth = "near";
    warmthLabel = "散步可达";
  }
  // Progress 0..100 (100% when inside area, smoothly scales down to 10% at 5km+)
  const progress = inArea ? 100 : Math.max(8, Math.min(96, Math.round((1 - Math.min(meters, 5000) / 5000) * 100)));
  const approxDistance = meters < 1000
    ? `模糊中心约 ${Math.round(meters / 50) * 50 || 50} 米`
    : `模糊中心约 ${(meters / 1000).toFixed(1)} 公里`;
  return {
    meters,
    approxDistance,
    bearing,
    inArea,
    warmth,
    warmthLabel,
    progress,
  };
}

export function mapRadarPoint(area, center) {
  if (!area || !Number.isFinite(area.latitude) || !Number.isFinite(area.longitude)) return null;
  const dx = (area.longitude - (center?.longitude ?? 0)) * Math.cos((center?.latitude ?? 0) * Math.PI / 180);
  const dy = area.latitude - (center?.latitude ?? 0);
  const distance = Math.hypot(dx, dy);
  const scale = distance > 0.02 ? 0.02 / distance : 1;
  return { x: 50 + dx * scale * 1900, y: 50 - dy * scale * 1900 };
}
