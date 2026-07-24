import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAmbientContext,
  clearCachedCoordinates,
  describeGeolocationError,
  formatShanghaiClock,
  normalizeWeather,
  readCachedCoordinates,
  storeCachedCoordinates,
} from "./ambient-context";

const OFF_STATE = Object.freeze({
  state: "off",
  message: "开启后才会申请定位权限",
});

function browserIsOnline() {
  return globalThis.navigator?.onLine !== false;
}

export default function AmbientContextBadge({
  onLoadWeather,
  onContextChange,
  className = "",
}) {
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(browserIsOnline);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [weather, setWeather] = useState(null);
  const [status, setStatus] = useState(OFF_STATE);
  const operationRef = useRef(0);
  const lastContextRef = useRef("");

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    const timer = globalThis.setInterval(updateClock, 30_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => {
      setOnline(false);
      if (locationEnabled) {
        setStatus({
          state: "offline",
          message: "当前没有网络，天气会在重试后更新。",
        });
      }
    };
    globalThis.addEventListener?.("online", handleOnline);
    globalThis.addEventListener?.("offline", handleOffline);
    return () => {
      globalThis.removeEventListener?.("online", handleOnline);
      globalThis.removeEventListener?.("offline", handleOffline);
    };
  }, [locationEnabled]);

  const clock = useMemo(() => formatShanghaiClock(now), [now]);
  const ambientContext = useMemo(
    () => buildAmbientContext({ clock, weather, locationEnabled }),
    [clock, locationEnabled, weather],
  );

  useEffect(() => {
    const serialized = JSON.stringify(ambientContext);
    if (serialized === lastContextRef.current) return;
    lastContextRef.current = serialized;
    onContextChange?.(ambientContext);
  }, [ambientContext, onContextChange]);

  useEffect(
    () => () => {
      operationRef.current += 1;
    },
    [],
  );

  async function loadWeather(coordinates, operation) {
    if (!browserIsOnline()) {
      if (operation === operationRef.current) {
        setStatus({
          state: "offline",
          message: "当前没有网络，暂时无法更新天气。",
        });
      }
      return;
    }

    setStatus({ state: "loading", message: "正在读取桃桃身边的天气" });
    try {
      const result = await onLoadWeather({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      });
      if (operation !== operationRef.current) return;

      const normalized = normalizeWeather(result);
      if (!normalized) {
        throw new Error("天气服务没有返回可用温度");
      }
      setWeather(normalized);
      setStatus({ state: "ready", message: "天气已更新" });
    } catch (error) {
      if (operation !== operationRef.current) return;
      setStatus({
        state: browserIsOnline() ? "error" : "offline",
        message: browserIsOnline()
          ? error?.message || "天气服务暂时不可用，请稍后重试。"
          : "当前没有网络，暂时无法更新天气。",
      });
    }
  }

  function requestCurrentPosition(operation, cacheState) {
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation?.getCurrentPosition) {
      setStatus({
        state: "unavailable",
        message: "这台设备暂不支持定位。",
      });
      return;
    }

    setStatus({
      state: "locating",
      message:
        cacheState === "expired"
          ? "位置缓存已过期，正在重新定位"
          : "正在获取位置，只用于查询附近天气",
    });
    geolocation.getCurrentPosition(
      (position) => {
        if (operation !== operationRef.current) return;
        const coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        storeCachedCoordinates(coordinates);
        void loadWeather(coordinates, operation);
      },
      (error) => {
        if (operation !== operationRef.current) return;
        setStatus(describeGeolocationError(error));
      },
      {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  }

  function enableWeather() {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setLocationEnabled(true);
    setWeather(null);

    if (typeof onLoadWeather !== "function") {
      setStatus({
        state: "error",
        message: "天气服务尚未接入，请稍后再试。",
      });
      return;
    }
    if (!browserIsOnline()) {
      setStatus({
        state: "offline",
        message: "当前没有网络，联网后可以重试。",
      });
      return;
    }

    const cached = readCachedCoordinates();
    if (cached.state === "fresh") {
      void loadWeather(cached.coordinates, operation);
      return;
    }
    requestCurrentPosition(operation, cached.state);
  }

  function disableWeather() {
    operationRef.current += 1;
    clearCachedCoordinates();
    setLocationEnabled(false);
    setWeather(null);
    setStatus(OFF_STATE);
  }

  const statusCanRetry =
    locationEnabled &&
    ["denied", "timeout", "unavailable", "offline", "error"].includes(
      status.state,
    );

  return (
    <aside
      className={`ambient-context-badge state-${status.state} ${className}`.trim()}
      aria-label="中国时间与本地天气"
      data-online={online ? "true" : "false"}
    >
      <div className="ambient-context-time">
        <span className="ambient-context-kicker">中国时间</span>
        <time dateTime={clock.dateTime}>{clock.time}</time>
        <span className="ambient-context-date">{clock.date}</span>
      </div>

      <div className="ambient-context-divider" aria-hidden="true" />

      <div className="ambient-context-weather">
        <div className="ambient-context-weather-copy">
          <span className="ambient-context-kicker">桃桃身边</span>
          {weather ? (
            <strong>
              {weather.description} {weather.temperatureC}°C
            </strong>
          ) : (
            <strong>
              {status.state === "off" ? "天气未开启" : "天气读取中"}
            </strong>
          )}
          <span
            className="ambient-context-status"
            role="status"
            aria-live="polite"
          >
            {status.message}
          </span>
        </div>

        <div className="ambient-context-actions">
          {statusCanRetry && (
            <button type="button" onClick={enableWeather}>
              重试
            </button>
          )}
          <button
            type="button"
            className="ambient-context-toggle"
            aria-pressed={locationEnabled}
            onClick={locationEnabled ? disableWeather : enableWeather}
            title={
              locationEnabled
                ? "关闭天气并清除本机位置缓存"
                : "开启天气后才会申请定位权限"
            }
          >
            {locationEnabled ? "关闭" : "开启"}
          </button>
        </div>
      </div>
    </aside>
  );
}
