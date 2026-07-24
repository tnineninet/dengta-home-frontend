export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
export const AMBIENT_LOCATION_CACHE_KEY =
  "dengta_home_ambient_location_v1";
export const AMBIENT_LOCATION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const WEATHER_CODE_LABELS = Object.freeze({
  0: "晴朗",
  1: "大部晴朗",
  2: "局部多云",
  3: "阴天",
  45: "有雾",
  48: "雾凇",
  51: "轻微毛毛雨",
  53: "毛毛雨",
  55: "较强毛毛雨",
  56: "轻微冻毛毛雨",
  57: "冻毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "轻微冻雨",
  67: "冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "米雪",
  80: "小阵雨",
  81: "阵雨",
  82: "强阵雨",
  85: "小阵雪",
  86: "强阵雪",
  95: "雷雨",
  96: "雷雨伴小冰雹",
  99: "雷雨伴冰雹",
});

function getStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

export function normalizeCoordinates(value) {
  const latitude = finiteCoordinate(value?.latitude, -90, 90);
  const longitude = finiteCoordinate(value?.longitude, -180, 180);
  if (latitude === null || longitude === null) return null;

  const accuracy = Number(value?.accuracy);
  return {
    // Roughly kilometre-level coordinates are enough for weather and keep the
    // device's precise position out of storage and network requests.
    latitude: Number(latitude.toFixed(2)),
    longitude: Number(longitude.toFixed(2)),
    ...(Number.isFinite(accuracy) && accuracy >= 0
      ? { accuracy: Math.round(accuracy) }
      : {}),
  };
}

export function storeCachedCoordinates(
  value,
  storage,
  storedAt = Date.now(),
) {
  const coordinates = normalizeCoordinates(value);
  const target = getStorage(storage);
  if (!coordinates || !target) return false;

  try {
    target.setItem(
      AMBIENT_LOCATION_CACHE_KEY,
      JSON.stringify({ ...coordinates, storedAt }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearCachedCoordinates(storage) {
  try {
    getStorage(storage)?.removeItem(AMBIENT_LOCATION_CACHE_KEY);
  } catch {
    // Storage restrictions must not break the rest of the chat interface.
  }
}

export function readCachedCoordinates(
  storage,
  now = Date.now(),
  maxAge = AMBIENT_LOCATION_CACHE_TTL_MS,
) {
  const target = getStorage(storage);
  if (!target) return { state: "missing", coordinates: null };

  try {
    const raw = target.getItem(AMBIENT_LOCATION_CACHE_KEY);
    if (!raw) return { state: "missing", coordinates: null };

    const parsed = JSON.parse(raw);
    const coordinates = normalizeCoordinates(parsed);
    const storedAt = Number(parsed?.storedAt);
    if (!coordinates || !Number.isFinite(storedAt)) {
      clearCachedCoordinates(target);
      return { state: "invalid", coordinates: null };
    }

    if (now - storedAt > maxAge || storedAt > now + 60_000) {
      clearCachedCoordinates(target);
      return { state: "expired", coordinates: null };
    }

    return {
      state: "fresh",
      coordinates,
      ageMs: Math.max(0, now - storedAt),
    };
  } catch {
    clearCachedCoordinates(target);
    return { state: "invalid", coordinates: null };
  }
}

export function formatShanghaiClock(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { time: "--:--", date: "时间暂不可用", dateTime: "" };
  }

  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const dateLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";

  return {
    time,
    date: dateLabel,
    dateTime: `${part("year")}-${part("month")}-${part("day")}T${part(
      "hour",
    )}:${part("minute")}:00+08:00`,
  };
}

export function describeWeatherCode(value) {
  const code = Number(value);
  return WEATHER_CODE_LABELS[code] || "天气变化中";
}

export function normalizeWeather(value) {
  const current = value?.current || value?.current_weather || {};
  const temperature = Number(
    value?.temperatureC ??
      value?.temperature_c ??
      value?.temperature ??
      current?.temperature_2m ??
      current?.temperature,
  );
  if (!Number.isFinite(temperature)) return null;

  const weatherCode =
    value?.weatherCode ??
    value?.weather_code ??
    value?.code ??
    current?.weather_code ??
    current?.weathercode;
  const windSpeed = Number(
    value?.windSpeedKmh ??
      value?.wind_speed_kmh ??
      value?.wind_speed ??
      current?.wind_speed_10m ??
      current?.windspeed,
  );

  return Object.freeze({
    temperatureC: Math.round(temperature * 10) / 10,
    description: String(
      value?.description ||
        value?.condition ||
        value?.weatherLabel ||
        value?.label ||
        describeWeatherCode(weatherCode),
    ).slice(0, 40),
    ...(Number.isFinite(Number(weatherCode))
      ? { weatherCode: Number(weatherCode) }
      : {}),
    ...(Number.isFinite(windSpeed)
      ? { windSpeedKmh: Math.round(windSpeed * 10) / 10 }
      : {}),
    updatedAt: String(
      value?.updatedAt ||
        value?.updated_at ||
        value?.observed_at ||
        current?.time ||
        "",
    ).slice(0, 40),
  });
}

export function describeGeolocationError(error) {
  if (error?.code === 1) {
    return {
      state: "denied",
      message: "定位权限未开启。可以在系统设置中允许后再重试。",
    };
  }
  if (error?.code === 3) {
    return {
      state: "timeout",
      message: "定位等待超时，请到开阔处或稍后重试。",
    };
  }
  return {
    state: "unavailable",
    message: "暂时无法取得位置，请检查系统定位服务。",
  };
}

export function buildAmbientContext({ clock, weather, locationEnabled }) {
  return Object.freeze({
    timeZone: SHANGHAI_TIME_ZONE,
    localTime: clock.time,
    localDate: clock.date,
    locationEnabled: Boolean(locationEnabled),
    weather: weather
      ? Object.freeze({
          temperatureC: weather.temperatureC,
          description: weather.description,
          ...(Number.isFinite(weather.weatherCode)
            ? { weatherCode: weather.weatherCode }
            : {}),
          ...(Number.isFinite(weather.windSpeedKmh)
            ? { windSpeedKmh: weather.windSpeedKmh }
            : {}),
          ...(weather.updatedAt ? { updatedAt: weather.updatedAt } : {}),
        })
      : null,
  });
}
