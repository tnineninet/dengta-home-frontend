import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AMBIENT_WEATHER_REFRESH_CHECK_MS,
  ambientCacheStorage,
  buildAmbientContext,
  clearCachedCoordinates,
  clearCachedWeather,
  describeGeolocationError,
  formatLocalClock,
  normalizeWeather,
  normalizeCoordinates,
  readEnabledAmbientCache,
  readCachedCoordinates,
  readCachedWeather,
  resolveActiveTimeZone,
  resolveAmbientStartupAction,
  resolveAmbientSwipe,
  storeAmbientPreferences,
  storeCachedCoordinates,
  storeCachedWeather,
} from "./ambient-context";
import { estimateApproximateLocationByIp } from "./live-location-weather";

const OFF_STATE = Object.freeze({
  state: "off",
  message: "开启后才会申请定位权限",
});

function browserIsOnline() {
  return globalThis.navigator?.onLine !== false;
}

function readInitialAmbientState(accountScope = "") {
  return readEnabledAmbientCache(undefined, accountScope);
}

function AmbientContextBadge({
  onLoadWeather,
  onContextChange,
  onCoordinatesChange,
  onStatusChange,
  onLocationSynced,
  controlRef,
  celestialSnapshot,
  accountScope = "",
  className = "",
}) {
  const [initialState] = useState(() => readInitialAmbientState(accountScope));
  const cacheStorage = useMemo(() => ambientCacheStorage(undefined, accountScope), [accountScope]);
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(browserIsOnline);
  const [locationEnabled, setLocationEnabled] = useState(
    initialState.preferences.enabled,
  );
  const [weather, setWeather] = useState(initialState.weather.weather);
  const [coordinates, setCoordinates] = useState(
    initialState.coordinates.coordinates,
  );
  const [minimized, setMinimized] = useState(
    initialState.preferences.minimized,
  );
  const [side, setSide] = useState(initialState.preferences.side);
  const [status, setStatus] = useState(() => {
    if (initialState.preferences.permissionDenied) {
      return describeGeolocationError({ code: 1 });
    }
    if (initialState.weather.weather) {
      return {
        state: initialState.weather.state === "fresh" ? "ready" : "stale",
        message:
          initialState.weather.state === "fresh"
            ? "已恢复最近天气"
            : "先显示上次天气，正在等待刷新",
      };
    }
    return initialState.preferences.enabled
      ? { state: "loading", message: "正在恢复天气" }
      : OFF_STATE;
  });
  const operationRef = useRef(0);
  const lastContextRef = useRef("");
  const preferencesRef = useRef(initialState.preferences);
  const weatherRef = useRef(initialState.weather.weather);
  const gestureRef = useRef(null);

  const persistPreferences = useCallback((patch) => {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    storeAmbientPreferences(next, undefined, accountScope);
    return next;
  }, [accountScope]);

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

  const activeTimeZone = useMemo(
    () =>
      resolveActiveTimeZone(
        weather?.timeZone || coordinates?.timeZone || "",
      ),
    [coordinates?.timeZone, weather?.timeZone],
  );
  const activeLocationLabel = useMemo(
    () =>
      (locationEnabled
        ? weather?.locationLabel || coordinates?.label || ""
        : ""),
    [coordinates?.label, locationEnabled, weather?.locationLabel],
  );
  const clock = useMemo(
    () => formatLocalClock(now, activeTimeZone),
    [activeTimeZone, now],
  );
  const ambientContext = useMemo(
    () =>
      buildAmbientContext({
        clock,
        weather,
        locationEnabled,
        timeZone: activeTimeZone,
        locationLabel: activeLocationLabel,
      }),
    [activeLocationLabel, activeTimeZone, clock, locationEnabled, weather],
  );

  useEffect(() => {
    const serialized = JSON.stringify(ambientContext);
    if (serialized === lastContextRef.current) return;
    lastContextRef.current = serialized;
    onContextChange?.(ambientContext);
  }, [ambientContext, onContextChange]);

  useEffect(() => {
    onCoordinatesChange?.(locationEnabled ? coordinates : null);
  }, [coordinates, locationEnabled, onCoordinatesChange]);

  useEffect(() => {
    onStatusChange?.({
      status,
      online,
      locationEnabled,
      locationLabel: activeLocationLabel,
      timeZone: activeTimeZone,
      clock,
      coordinates: locationEnabled ? coordinates : null,
      weather: locationEnabled ? weather : null,
    });
  }, [
    activeLocationLabel,
    activeTimeZone,
    clock,
    coordinates,
    locationEnabled,
    onStatusChange,
    online,
    status,
    weather,
  ]);

  useEffect(
    () => () => {
      operationRef.current += 1;
    },
    [cacheStorage],
  );

  const loadWeather = useCallback(async (nextCoordinates, operation, { notifySynced = false } = {}) => {
    if (!browserIsOnline()) {
      if (operation === operationRef.current) {
        setStatus({
          state: "offline",
          message: weatherRef.current
            ? "当前没有网络，先保留上次天气。"
            : "当前没有网络，暂时无法更新天气。",
        });
      }
      return;
    }

    setStatus({
      state: "loading",
      message: weatherRef.current
        ? "正在后台刷新你身边的天气"
        : "正在读取你身边的天气",
    });
    try {
      if (typeof onLoadWeather !== "function") {
        throw new Error("天气服务尚未接入，请稍后再试。");
      }
      const result = await onLoadWeather({
        latitude: nextCoordinates.latitude,
        longitude: nextCoordinates.longitude,
      });
      if (operation !== operationRef.current) return;

      const mergedRaw = {
        ...result,
        ...(nextCoordinates.label && !result?.locationLabel && !result?.location_label && !result?.city
          ? { locationLabel: nextCoordinates.label }
          : {}),
        ...(nextCoordinates.timeZone && !result?.timeZone && !result?.timezone
          ? { timeZone: nextCoordinates.timeZone }
          : {}),
      };
      const normalized = normalizeWeather(mergedRaw);
      if (!normalized) {
        throw new Error("天气服务没有返回可用温度");
      }
      const enrichedCoords = normalizeCoordinates({
        ...nextCoordinates,
        ...(normalized.locationLabel ? { label: normalized.locationLabel } : {}),
        ...(normalized.timeZone ? { timeZone: normalized.timeZone } : {}),
      });
      if (enrichedCoords) {
        storeCachedCoordinates(enrichedCoords, cacheStorage);
        setCoordinates(enrichedCoords);
      }
      weatherRef.current = normalized;
      setWeather(normalized);
      storeCachedWeather(normalized, cacheStorage);
      setStatus({
        state: "ready",
        message: normalized.locationLabel
          ? `已同步 ${normalized.locationLabel} 天气与时间`
          : "天气与当地时间已更新",
      });
      if (notifySynced) {
        onLocationSynced?.({
          coordinates: enrichedCoords || nextCoordinates,
          weather: normalized,
        });
      }
    } catch (error) {
      if (operation !== operationRef.current) return;
      setStatus({
        state: browserIsOnline() ? "error" : "offline",
        message: browserIsOnline()
          ? error?.message || "天气服务暂时不可用，请稍后重试。"
          : "当前没有网络，暂时无法更新天气。",
      });
    }
  }, [onLoadWeather, onLocationSynced, cacheStorage]);

  const requestCurrentPosition = useCallback((operation, cacheState, { notifySynced = false } = {}) => {
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation?.getCurrentPosition) {
      setStatus({
        state: "unavailable",
        message: "这台设备暂不支持定位，可改用网络定位或城市搜索。",
      });
      return;
    }

    setStatus({
      state: "locating",
      message:
        cacheState === "expired"
          ? "位置缓存已过期，正在重新定位"
          : "正在获取位置，用于更新当地时间与天气",
    });
    geolocation.getCurrentPosition(
      (position) => {
        if (operation !== operationRef.current) return;
        const nextCoords = normalizeCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        if (!nextCoords) {
          setStatus({ state: "unavailable", message: "定位未返回有效坐标，请重试。" });
          return;
        }
        const previous = readCachedCoordinates(cacheStorage).coordinates;
        if (!previous || previous.latitude !== nextCoords.latitude || previous.longitude !== nextCoords.longitude) {
          clearCachedWeather(cacheStorage);
          weatherRef.current = null;
          setWeather(null);
        }
        storeCachedCoordinates(nextCoords, cacheStorage);
        setCoordinates(readCachedCoordinates(cacheStorage).coordinates);
        persistPreferences({ enabled: true, permissionDenied: false });
        setLocationEnabled(true);
        void loadWeather(nextCoords, operation, { notifySynced });
      },
      (error) => {
        if (operation !== operationRef.current) return;
        if (error?.code === 1) {
          persistPreferences({ enabled: false, permissionDenied: true });
          setLocationEnabled(false);
          setCoordinates(null);
          weatherRef.current = null;
          setWeather(null);
        }
        setStatus(describeGeolocationError(error));
      },
      {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  }, [loadWeather, persistPreferences, cacheStorage]);

  const resumeWeather = useCallback(() => {
    const preferences = preferencesRef.current;
    const cachedWeather = readCachedWeather(cacheStorage);
    const cachedCoordinates = readCachedCoordinates(cacheStorage);
    const action = resolveAmbientStartupAction({
      preferences,
      weatherState: cachedWeather.state,
      coordinateState: cachedCoordinates.state,
      online: browserIsOnline(),
      weatherServiceAvailable: typeof onLoadWeather === "function",
    });
    if (action === "idle" || action === "permission-blocked") {
      return;
    }
    if (action === "use-cache") {
      setStatus((current) =>
        current.state === "offline"
          ? { state: "ready", message: "天气缓存仍然有效" }
          : current,
      );
      return;
    }
    if (action === "service-unavailable") {
      setStatus({
        state: "error",
        message: "天气服务尚未接入，请稍后再试。",
      });
      return;
    }
    if (action === "offline") {
      setStatus({
        state: "offline",
        message: weatherRef.current
          ? "当前没有网络，先保留上次天气。"
          : "当前没有网络，联网后可以重试。",
      });
      return;
    }

    const operation = operationRef.current + 1;
    operationRef.current = operation;
    if (action === "load-weather") {
      void loadWeather(cachedCoordinates.coordinates, operation);
      return;
    }
    requestCurrentPosition(operation, cachedCoordinates.state);
  }, [
    cacheStorage,
    loadWeather,
    onLoadWeather,
    requestCurrentPosition,
  ]);

  useEffect(() => {
    const initialTimer = globalThis.setTimeout(resumeWeather, 0);
    const refreshTimer = globalThis.setInterval(
      resumeWeather,
      AMBIENT_WEATHER_REFRESH_CHECK_MS,
    );
    const refreshWhenOnline = () => resumeWeather();
    const refreshWhenVisible = () => {
      if (globalThis.document?.visibilityState === "visible") resumeWeather();
    };
    globalThis.addEventListener?.("online", refreshWhenOnline);
    globalThis.document?.addEventListener(
      "visibilitychange",
      refreshWhenVisible,
    );
    return () => {
      globalThis.clearTimeout(initialTimer);
      globalThis.clearInterval(refreshTimer);
      globalThis.removeEventListener?.("online", refreshWhenOnline);
      globalThis.document?.removeEventListener(
        "visibilitychange",
        refreshWhenVisible,
      );
    };
  }, [resumeWeather]);

  const enableWeather = useCallback(({ forceRelocate = false } = {}) => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setLocationEnabled(true);
    const permissionWasDenied = preferencesRef.current.permissionDenied;

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

    const cached = readCachedCoordinates(cacheStorage);
    if (!forceRelocate && cached.state === "fresh" && !permissionWasDenied) {
      persistPreferences({ enabled: true, permissionDenied: false });
      void loadWeather(cached.coordinates, operation, { notifySynced: true });
      return;
    }
    requestCurrentPosition(operation, cached.state, { notifySynced: true });
  }, [cacheStorage, loadWeather, onLoadWeather, persistPreferences, requestCurrentPosition]);

  const applyManualLocation = useCallback((location) => {
    const nextCoords = normalizeCoordinates(location);
    if (!nextCoords) return;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    clearCachedWeather(cacheStorage);
    weatherRef.current = null;
    setWeather(null);
    storeCachedCoordinates(nextCoords, cacheStorage);
    setCoordinates(nextCoords);
    persistPreferences({ enabled: true, permissionDenied: false });
    setLocationEnabled(true);
    void loadWeather(nextCoords, operation, { notifySynced: true });
  }, [cacheStorage, loadWeather, persistPreferences]);

  const estimateLocationByIp = useCallback(async () => {
    if (!browserIsOnline()) {
      setStatus({
        state: "offline",
        message: "当前没有网络，暂时无法估算位置。",
      });
      return;
    }
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setLocationEnabled(true);
    setStatus({
      state: "locating",
      message: "正在根据网络估算大致城市与时区…",
    });
    try {
      const estimated = await estimateApproximateLocationByIp();
      if (operation !== operationRef.current) return;
      clearCachedWeather(cacheStorage);
      weatherRef.current = null;
      setWeather(null);
      storeCachedCoordinates(estimated, cacheStorage);
      setCoordinates(estimated);
      persistPreferences({ enabled: true, permissionDenied: false });
      await loadWeather(estimated, operation, { notifySynced: true });
    } catch (error) {
      if (operation !== operationRef.current) return;
      setStatus({
        state: "unavailable",
        message: error?.message || "网络位置估算失败，可手动搜索城市。",
      });
    }
  }, [cacheStorage, loadWeather, persistPreferences]);

  const disableWeather = useCallback(() => {
    operationRef.current += 1;
    clearCachedCoordinates(cacheStorage);
    clearCachedWeather(cacheStorage);
    persistPreferences({ enabled: false, permissionDenied: false });
    setLocationEnabled(false);
    setCoordinates(null);
    weatherRef.current = null;
    setWeather(null);
    setStatus(OFF_STATE);
  }, [cacheStorage, persistPreferences]);

  useEffect(() => {
    if (!controlRef) return undefined;
    controlRef.current = {
      enableWeather: () => enableWeather({ forceRelocate: false }),
      relocate: () => enableWeather({ forceRelocate: true }),
      refreshWeather: () => {
        const cached = readCachedCoordinates(cacheStorage);
        if (cached.coordinates) {
          const operation = operationRef.current + 1;
          operationRef.current = operation;
          void loadWeather(cached.coordinates, operation, { notifySynced: true });
        } else {
          enableWeather({ forceRelocate: true });
        }
      },
      applyManualLocation,
      estimateLocationByIp,
      disableWeather,
    };
    return () => {
      if (controlRef.current) controlRef.current = null;
    };
  }, [
    applyManualLocation,
    cacheStorage,
    controlRef,
    disableWeather,
    enableWeather,
    estimateLocationByIp,
    loadWeather,
  ]);

  const statusCanRetry =
    ["denied", "timeout", "unavailable", "offline", "error"].includes(
      status.state,
    );

  function minimizeWidget(nextSide) {
    const normalizedSide = nextSide === "left" ? "left" : "right";
    setMinimized(true);
    setSide(normalizedSide);
    persistPreferences({ minimized: true, side: normalizedSide });
  }

  function restoreWidget() {
    setMinimized(false);
    persistPreferences({ minimized: false, side });
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target?.closest?.("button, input, select, textarea, a")) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerUp(event) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const result = resolveAmbientSwipe({
      ...gesture,
      endX: event.clientX,
      endY: event.clientY,
      side,
    });
    if (result) minimizeWidget(result.side);
  }

  function handlePointerCancel(event) {
    if (gestureRef.current?.pointerId === event.pointerId) {
      gestureRef.current = null;
    }
  }

  if (minimized) {
    const arrow = side === "left" ? "›" : "‹";
    return (
      <aside
        className={`ambient-context-badge is-minimized side-${side} ${className}`.trim()}
        aria-label="展开中国时间与本地天气"
        data-minimized="true"
        data-side={side}
        style={{
          width: 48,
          height: 48,
          minWidth: 48,
          minHeight: 48,
          alignSelf: side === "left" ? "flex-start" : "flex-end",
          gridTemplateColumns: "1fr",
          margin: side === "left" ? "6px auto 0 0" : "6px 0 0 auto",
          padding: 0,
          flex: "0 0 48px",
          position: "relative",
          zIndex: 9,
          overflow: "hidden",
          borderRadius: side === "left" ? "0 12px 12px 0" : "12px 0 0 12px",
        }}
      >
        <button
          type="button"
          aria-label="展开时间和天气"
          title="展开时间和天气"
          onClick={restoreWidget}
          style={{
            width: "100%",
            height: "100%",
            padding: 0,
            border: 0,
            color: "inherit",
            background: "transparent",
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          <span aria-hidden="true">{arrow}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`ambient-context-badge state-${status.state} side-${side} ${className}`.trim()}
      aria-label="中国时间与本地天气"
      data-online={online ? "true" : "false"}
      data-minimized="false"
      data-side={side}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
        flex: "0 0 auto",
        position: "relative",
        zIndex: 9,
        touchAction: "none",
      }}
    >
      <div className="ambient-context-time">
        <span className="ambient-context-kicker">
          {activeLocationLabel
            ? `${activeLocationLabel}时间`
            : activeTimeZone === "Asia/Shanghai"
              ? "中国时间"
              : "当地时间"}
        </span>
        <time dateTime={clock.dateTime}>{clock.time}</time>
        <span className="ambient-context-date">{clock.date}</span>
      </div>

      <div className="ambient-context-divider" aria-hidden="true" />

      <div className="ambient-context-weather">
        <div className="ambient-context-weather-copy">
          <span className="ambient-context-kicker">
            {activeLocationLabel || "你身边"}
          </span>
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
          {celestialSnapshot?.sunriseLabel &&
            celestialSnapshot?.sunsetLabel && (
              <span className="ambient-context-solar">
                日出 {celestialSnapshot.sunriseLabel} · 日落{" "}
                {celestialSnapshot.sunsetLabel}
              </span>
            )}
        </div>

        <div className="ambient-context-actions">
          <button
            type="button"
            className="ambient-context-minimize"
            aria-label={`最小化时间和天气到${side === "left" ? "左" : "右"}侧`}
            title="最小化时间和天气"
            onClick={() => minimizeWidget(side)}
          >
            <span aria-hidden="true">{side === "left" ? "←" : "→"}</span>
          </button>
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

export default memo(AmbientContextBadge);
