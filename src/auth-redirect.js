export const PUBLIC_AUTH_REDIRECT_URL =
  "https://dengta-home-backend-rkmq.onrender.com/web/";

const BUILD_PUBLIC_AUTH_REDIRECT_URL =
  import.meta.env?.VITE_PUBLIC_AUTH_REDIRECT_URL;
const BUILD_APP_BASE_URL = import.meta.env?.BASE_URL;
const OFFICIAL_WEB_HOSTS = new Set([
  "dengta-home.vercel.app",
  "dengta-home-backend-rkmq.onrender.com",
  "dengta-home-backend.onrender.com",
]);

function cleanHttpUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    return new URL(text).toString();
  } catch {
    return undefined;
  }
}

function currentAppUrl(location, baseUrl) {
  const origin = cleanHttpUrl(location?.origin);
  if (!origin) return undefined;

  const rawBase = String(baseUrl || "").trim();
  const absoluteBase = cleanHttpUrl(rawBase);
  if (absoluteBase) return absoluteBase;

  let pathname =
    rawBase && !["/", "./"].includes(rawBase)
      ? rawBase
      : String(location?.pathname || "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;

  const callback = new URL(pathname, origin);
  callback.search = "";
  callback.hash = "";
  if (!callback.pathname.endsWith("/")) callback.pathname += "/";
  return callback.toString();
}

export function resolveEmailRedirectUrl({
  nativePlatform = false,
  location = globalThis.location,
  configuredUrl = BUILD_PUBLIC_AUTH_REDIRECT_URL,
  baseUrl = BUILD_APP_BASE_URL,
  officialUrl = PUBLIC_AUTH_REDIRECT_URL,
} = {}) {
  const configured = cleanHttpUrl(configuredUrl);
  if (configured) return configured;

  const official = cleanHttpUrl(officialUrl);
  if (nativePlatform) return official;

  const origin = cleanHttpUrl(location?.origin);
  if (!origin) return official;
  const current = new URL(origin);
  if (OFFICIAL_WEB_HOSTS.has(current.hostname)) return official;

  return currentAppUrl(location, baseUrl) || official;
}
