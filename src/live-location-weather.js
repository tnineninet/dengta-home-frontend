// Live Location, Geocoding & Open-Meteo Weather Client for DengTa
// Keyless, CORS-enabled, privacy-preserving (only coarse 2-decimal coordinates leave the device).

import { isValidTimeZone, normalizeCoordinates, normalizeWeather } from "./ambient-context.js";

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const BIGDATACLOUD_REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const IPWHO_URL = "https://ipwho.is/?fields=success,city,region,country,latitude,longitude,timezone";

const TRADITIONAL_PLACE_CHAR_MAP = Object.freeze({
  區: "区",
  縣: "县",
  臺: "台",
  灣: "湾",
  門: "门",
  陽: "阳",
  東: "东",
  廣: "广",
  蘇: "苏",
  寧: "宁",
  華: "华",
  慶: "庆",
  漢: "汉",
  長: "长",
  寶: "宝",
  龍: "龙",
  鳳: "凤",
  黃: "黄",
  國: "国",
  嶺: "岭",
  島: "岛",
  鎮: "镇",
  鄉: "乡",
  開: "开",
  關: "关",
  雲: "云",
  電: "电",
  樂: "乐",
  興: "兴",
  義: "义",
  豐: "丰",
  衛: "卫",
  溫: "温",
  濟: "济",
  瀋: "沈",
  鄭: "郑",
  閩: "闽",
  陝: "陕",
  蘭: "兰",
  銀: "银",
  烏: "乌",
  魯: "鲁",
  齊: "齐",
  薩: "萨",
  澳門: "澳门",
});

export function normalizeSimplifiedPlaceName(value) {
  return String(value || "").replace(
    /[區縣臺灣門陽東廣蘇寧華慶漢長寶龍鳳黃國嶺島鎮鄉開關雲電樂興義豐衛溫濟瀋鄭閩陝蘭銀烏魯齊薩]/g,
    (ch) => TRADITIONAL_PLACE_CHAR_MAP[ch] || ch,
  );
}

function sanitizePlaceText(value, maxLength = 32) {
  return normalizeSimplifiedPlaceName(String(value || ""))
    .replace(/[<>{}`\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    },
  };
}

export async function fetchOpenMeteoWeather({
  latitude,
  longitude,
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
  timeoutMs = 8_000,
} = {}) {
  const coords = normalizeCoordinates({ latitude, longitude });
  if (!coords) throw new Error("定位坐标无效，请重试。");

  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", coords.latitude.toFixed(2));
  url.searchParams.set("longitude", coords.longitude.toFixed(2));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "is_day",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "sunrise",
      "sunset",
    ].join(","),
  );
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const guard = withTimeout(signal, timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: guard.signal,
    });
    if (!response?.ok) {
      throw new Error(`天气服务暂时不可用（${response?.status || "network"}）。`);
    }
    const payload = await response.json();
    const normalized = normalizeWeather(payload);
    if (!normalized) {
      throw new Error("天气服务没有返回可用温度。");
    }
    return normalized;
  } finally {
    guard.cleanup();
  }
}

export async function reverseGeocodeCity({
  latitude,
  longitude,
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
  timeoutMs = 4_500,
} = {}) {
  const coords = normalizeCoordinates({ latitude, longitude });
  if (!coords) return "";

  const url = new URL(BIGDATACLOUD_REVERSE_URL);
  url.searchParams.set("latitude", coords.latitude.toFixed(2));
  url.searchParams.set("longitude", coords.longitude.toFixed(2));
  url.searchParams.set("localityLanguage", "zh-CN");

  const guard = withTimeout(signal, timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: guard.signal,
    });
    if (!response?.ok) return "";
    const data = await response.json();
    const city = sanitizePlaceText(data?.city || data?.principalSubdivision || "");
    const locality = sanitizePlaceText(data?.locality || "");
    if (city && locality && !city.includes(locality) && !locality.includes(city)) {
      return sanitizePlaceText(`${city} · ${locality}`, 32);
    }
    return city || locality || sanitizePlaceText(data?.countryName || "", 24);
  } catch {
    return "";
  } finally {
    guard.cleanup();
  }
}

export async function searchCitiesByName(
  query,
  {
    fetchImpl = (...args) => globalThis.fetch(...args),
    signal,
    count = 6,
    timeoutMs = 6_000,
  } = {},
) {
  const cleanQuery = sanitizePlaceText(query, 48);
  if (!cleanQuery) return [];

  const url = new URL(OPEN_METEO_GEOCODING_URL);
  url.searchParams.set("name", cleanQuery);
  url.searchParams.set("count", String(Math.max(1, Math.min(10, Number(count) || 6))));
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");

  const guard = withTimeout(signal, timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: guard.signal,
    });
    if (!response?.ok) throw new Error("城市检索服务暂时不可用。");
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results
      .map((item) => {
        const coords = normalizeCoordinates({
          latitude: item?.latitude,
          longitude: item?.longitude,
        });
        if (!coords) return null;
        const name = sanitizePlaceText(item?.name, 24);
        const admin1 = sanitizePlaceText(item?.admin1, 20);
        const country = sanitizePlaceText(item?.country, 20);
        const tz = isValidTimeZone(item?.timezone) ? item.timezone : "";
        const label = name || admin1 || country;
        const detail = [admin1, country]
          .filter((part) => part && part !== label)
          .join(" · ");
        return Object.freeze({
          id: `${coords.latitude},${coords.longitude},${label}`,
          name: label,
          detail,
          label,
          latitude: coords.latitude,
          longitude: coords.longitude,
          ...(tz ? { timeZone: tz } : {}),
        });
      })
      .filter(Boolean);
  } finally {
    guard.cleanup();
  }
}

export async function estimateApproximateLocationByIp({
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
  timeoutMs = 6_000,
} = {}) {
  const guard = withTimeout(signal, timeoutMs);
  try {
    const response = await fetchImpl(IPWHO_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: guard.signal,
    });
    if (!response?.ok) {
      throw new Error("网络位置估算暂时不可用，可以试试手动搜索城市。");
    }
    const data = await response.json();
    if (data?.success === false) {
      throw new Error("网络位置估算未返回结果，可以试试手动搜索城市。");
    }
    const tz = isValidTimeZone(data?.timezone?.id) ? data.timezone.id : "";
    const label = sanitizePlaceText(data?.city || data?.region || data?.country || "", 32);
    const coords = normalizeCoordinates({
      latitude: data?.latitude,
      longitude: data?.longitude,
      ...(label ? { label } : {}),
      ...(tz ? { timeZone: tz } : {}),
    });
    if (!coords) {
      throw new Error("网络位置估算坐标无效，可以试试手动搜索城市。");
    }
    return { ...coords, source: "ip" };
  } finally {
    guard.cleanup();
  }
}

export const QUICK_CITY_PRESETS = Object.freeze([
  { label: "北京", latitude: 39.9, longitude: 116.41, timeZone: "Asia/Shanghai" },
  { label: "上海", latitude: 31.23, longitude: 121.47, timeZone: "Asia/Shanghai" },
  { label: "广州", latitude: 23.13, longitude: 113.26, timeZone: "Asia/Shanghai" },
  { label: "深圳", latitude: 22.54, longitude: 114.06, timeZone: "Asia/Shanghai" },
  { label: "成都", latitude: 30.57, longitude: 104.07, timeZone: "Asia/Shanghai" },
  { label: "东京", latitude: 35.68, longitude: 139.69, timeZone: "Asia/Tokyo" },
  { label: "伦敦", latitude: 51.51, longitude: -0.13, timeZone: "Europe/London" },
  { label: "纽约", latitude: 40.71, longitude: -74.01, timeZone: "America/New_York" },
]);
