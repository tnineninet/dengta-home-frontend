const INVITE_ORIGINS = new Set(["https://dengtahome.com", "https://www.dengtahome.com"]);
const CALLBACK_FIELDS = new Set(["access_token", "refresh_token", "type", "expires_in", "expires_at", "token_type"]);
const CALLBACK_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export function markNativePlatform(capacitor, documentObject = globalThis.document) {
  const platform = capacitor.isNativePlatform() ? capacitor.getPlatform() : "web";
  documentObject.documentElement.dataset.nativePlatform = platform;
  return platform;
}

/** Validate before initializing auth. Never include a callback value in errors. */
export function parseNativeAuthCallback(rawUrl) {
  try {
    if (typeof rawUrl !== "string" || rawUrl.length > 32_768) return null;
    const url = new URL(rawUrl);
    if (url.protocol !== "dengta:" || url.hostname !== "auth" ||
        !["", "/"].includes(url.pathname) || url.username || url.password || url.port || url.search) return null;
    const params = new URLSearchParams(url.hash.slice(1));
    const seen = new Set();
    for (const [key, value] of params) {
      if (seen.has(key) || !CALLBACK_FIELDS.has(key) || !value || /\s/.test(value)) return null;
      seen.add(key);
    }
    const accessToken = params.get("access_token"), refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return null;
    const type = params.get("type");
    if (type && !CALLBACK_TYPES.has(type)) return null;
    for (const key of ["expires_in", "expires_at"]) {
      if (params.has(key) && !/^\d{1,12}$/.test(params.get(key))) return null;
    }
    if (params.has("token_type") && params.get("token_type") !== "bearer") return null;
    return { accessToken, refreshToken, recovery: type === "recovery" };
  } catch {
    return null;
  }
}

export function classifyNativeAppUrl(rawUrl) {
  if (parseNativeAuthCallback(rawUrl)) return "auth";
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password || url.port) return null;
    if (url.protocol === "dengta:" && url.hostname === "room" && /^\/join\/?$/.test(url.pathname)) return "room";
    if (INVITE_ORIGINS.has(url.origin) && /^\/room\/join\/?$/.test(url.pathname)) return "room";
  } catch { /* Unsupported input does not mutate runtime state. */ }
  return null;
}

/** Subscribe before cold-start lookup, dedupe overlap, release late listeners. */
export function installNativeDeepLinks({ app, onAuthUrl, onRoomUrl, dedupeMs = 3_000 } = {}) {
  let disposed = false, listener;
  let queue = Promise.resolve();
  const recent = new Map();
  async function dispatch(value) {
    if (disposed || typeof value !== "string") return;
    const kind = classifyNativeAppUrl(value);
    if (!kind || recent.has(value)) return;
    const entry = {};
    recent.set(value, entry);
    if (recent.size > 32) {
      const oldest = recent.keys().next().value;
      clearTimeout(recent.get(oldest).timer);
      recent.delete(oldest);
    }
    const run = queue.then(() => {
      if (disposed) return;
      return kind === "auth" ? onAuthUrl?.(value) : onRoomUrl?.(value);
    });
    queue = run.catch(() => {});
    try {
      const result = await run;
      if (result?.ok === false) { recent.delete(value); return; }
    } catch {
      recent.delete(value);
      return;
    }
    if (!disposed && recent.get(value) === entry) {
      entry.timer = setTimeout(() => recent.delete(value), dedupeMs);
      entry.timer?.unref?.();
    }
  }
  void (async () => {
    try {
      const handle = await app.addListener("appUrlOpen", ({ url } = {}) => { void dispatch(url); });
      if (disposed) { await handle.remove(); return; }
      listener = handle;
    } catch { /* Still try the cold launch URL. */ }
    if (disposed) return;
    try { await dispatch((await app.getLaunchUrl())?.url); } catch { /* Ordinary icon launch. */ }
  })();
  return () => {
    disposed = true;
    for (const entry of recent.values()) clearTimeout(entry.timer);
    recent.clear();
    if (listener) void Promise.resolve().then(() => listener.remove()).catch(() => {});
  };
}
