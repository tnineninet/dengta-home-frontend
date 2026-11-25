import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Globe2,
  LocateFixed,
  MapPin,
  MoonStar,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  SunMedium,
} from "lucide-react";
import { weatherModeFromAmbient } from "./sun-glass-sky";
import { useGlassScrubber } from "./use-glass-scrubber";
import { QUICK_CITY_PRESETS, searchCitiesByName } from "./live-location-weather";

const TIME_PRESETS = [
  { minute: 480, label: "清晨 08:00", Icon: SunMedium },
  { minute: 1080, label: "红霞 18:00", Icon: Sparkles },
  { minute: 1120, label: "蓝调 18:40", Icon: MoonStar },
  { minute: 1320, label: "银河 22:00", Icon: MoonStar },
];

const WEATHER_PRESETS = [
  { id: "cloudy", label: "微云", Icon: CloudSun },
  { id: "rain", label: "雨幕", Icon: CloudRain },
  { id: "storm", label: "晴雷", Icon: CloudLightning },
  { id: "clear", label: "晴空", Icon: Sun },
];

const BACKGROUND_QUICK_OPTIONS = [
  { id: "lumen", label: "流光天幕", tip: "视频同款无闪屏60fps纯天空" },
  { id: "auto", label: "实时海岸", tip: "实时海浪视频与云雨气象" },
  { id: "legacy", label: "经典海岸", tip: "旧版静态渐变海岸背景" },
];

const RULER_TICK_COUNT = 49;
const RULER_TICKS = Array.from({ length: RULER_TICK_COUNT }, (_, index) => index);

// Locked 60fps cadence (16ms) for zero-jank smooth sky scrubbing
const SCRUB_COMMIT_INTERVAL_MS = 16;

function formatMinute(value) {
  const minute = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60,
  ).padStart(2, "0")}`;
}

export default function SunGlassTimeDeck({
  snapshot,
  previewMinute,
  onPreviewMinute,
  onNow,
  weather,
  weatherMode,
  onWeatherMode,
  glassLevel,
  onGlassLevel,
  backgroundMode = "auto",
  onBackgroundMode,
  ambientLive = null,
  onSyncLocation,
  onRefreshWeather,
  onEstimateLocationByIp,
  onSelectLocation,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState([]);
  const [citySearching, setCitySearching] = useState(false);
  const [cityError, setCityError] = useState("");
  const rootRef = useRef(null);
  const frameRef = useRef(0);
  const commitTimerRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const pendingMinuteRef = useRef(null);
  const fallbackMinute = Number.isFinite(Number(snapshot?.minute))
    ? Number(snapshot.minute)
    : 0;
  const externalMinute = Number.isFinite(previewMinute)
    ? previewMinute
    : fallbackMinute;
  const [scrubMinute, setScrubMinute] = useState(null);
  const displayedMinute = Number.isFinite(scrubMinute)
    ? scrubMinute
    : externalMinute;
  const scrubProgress = Math.max(0, Math.min(1, displayedMinute / 1439));
  const nearestTick = Math.round(scrubProgress * (RULER_TICK_COUNT - 1));
  const liveWeatherMode = weatherModeFromAmbient(weather) || "clear";
  const usesLiveWeather = !weatherMode;
  const displayedWeather = weatherMode || liveWeatherMode;
  const displayedWeatherLabel =
    WEATHER_PRESETS.find((preset) => preset.id === displayedWeather)?.label ||
    "晴空";
  const glassScrubber = useGlassScrubber(glassLevel, onGlassLevel);
  const liveLocationLabel = ambientLive?.locationLabel || "";
  const liveStatusState = ambientLive?.status?.state || "off";
  const isLocating = liveStatusState === "locating" || liveStatusState === "loading";
  const liveTempText = Number.isFinite(weather?.temperatureC)
    ? `${Math.round(weather.temperatureC)}°C`
    : "";

  async function handleCitySearch(event) {
    event?.preventDefault?.();
    const keyword = cityQuery.trim();
    if (!keyword) {
      setCityResults([]);
      setCityError("");
      return;
    }
    setCitySearching(true);
    setCityError("");
    try {
      const hits = await searchCitiesByName(keyword);
      setCityResults(hits);
      if (!hits.length) setCityError("未找到匹配城市，可尝试中文或英文地名");
    } catch (error) {
      setCityError(error?.message || "城市搜索失败，请稍后重试");
    } finally {
      setCitySearching(false);
    }
  }

  function chooseCity(item) {
    onSelectLocation?.({
      latitude: item.latitude,
      longitude: item.longitude,
      label: item.label,
      timeZone: item.timeZone,
    });
    setCityOpen(false);
    setCityQuery("");
    setCityResults([]);
    setCityError("");
  }

  useEffect(() => {
    if (!isOpen) return undefined;

    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    }

    function closeFromEscape(event) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [isOpen]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      delete document.documentElement.dataset.timeScrubbing;
    },
    [],
  );

  function flushPendingMinute() {
    commitTimerRef.current = 0;
    const pendingMinute = pendingMinuteRef.current;
    pendingMinuteRef.current = null;
    if (pendingMinute === null) return;
    lastCommitAtRef.current = performance.now();
    onPreviewMinute?.(pendingMinute);
  }

  function startScrubbing() {
    document.documentElement.dataset.timeScrubbing = "true";
    setIsScrubbing(true);
  }

  function scheduleMinute(value) {
    const nextMinute = Math.max(0, Math.min(1439, Number(value) || 0));
    setScrubMinute(nextMinute);
    pendingMinuteRef.current = nextMinute;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const elapsed = performance.now() - lastCommitAtRef.current;
      const wait = Math.max(0, SCRUB_COMMIT_INTERVAL_MS - elapsed);
      if (wait === 0) flushPendingMinute();
      else if (!commitTimerRef.current) {
        commitTimerRef.current = window.setTimeout(flushPendingMinute, wait);
      }
    });
  }

  function finishScrubbing() {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = 0;
    }
    const pendingMinute = pendingMinuteRef.current;
    pendingMinuteRef.current = null;
    if (pendingMinute !== null) onPreviewMinute?.(pendingMinute);
    delete document.documentElement.dataset.timeScrubbing;
    setIsScrubbing(false);
    setScrubMinute(null);
  }

  function selectMinute(value) {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    frameRef.current = 0;
    commitTimerRef.current = 0;
    pendingMinuteRef.current = null;
    setScrubMinute(null);
    onPreviewMinute?.(value);
  }

  return (
    <section
      ref={rootRef}
      className="sun-glass-time-deck sun-glass-panel"
      aria-label="时间光线控制器"
      data-time-scrubbing={isScrubbing ? "true" : "false"}
    >
      <div className="sun-glass-time-deck-top">
        <button
          type="button"
          className="sun-glass-button compact"
          data-dt-tip={
            liveLocationLabel
              ? `恢复到 ${liveLocationLabel} 当地实时时间与自然天光`
              : "恢复到当前实时当地时间与自然天光"
          }
          onClick={() => {
            onNow?.();
            setScrubMinute(null);
            setIsOpen(false);
          }}
        >
          <Clock3 aria-hidden="true" />
          <span>现在</span>
        </button>
        <strong>
          {formatMinute(displayedMinute)}
          {liveTempText ? <small className="sun-glass-live-temp"> {liveTempText}</small> : null}
        </strong>
        <button
          type="button"
          className="sun-glass-button compact"
          aria-label="天气与光线设置"
          aria-expanded={isOpen}
          data-dt-tip="同步当前位置、时间与天气，切换天幕模式与全局玻璃度"
          onClick={() => setIsOpen((current) => !current)}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span>
            {usesLiveWeather ? `实时${displayedWeatherLabel}` : displayedWeatherLabel}
            {" · 光线"}
          </span>
        </button>
      </div>

      <div className="sun-glass-time-scale" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <div
        className="sun-glass-ruler-wrap"
        style={{ "--scrub-progress": scrubProgress.toFixed(4) }}
        data-dt-tip="左右丝滑拖动刻度尺，60fps 无闪屏实时预览 24 小时天光"
      >
        <div className="sun-glass-ruler-ticks" aria-hidden="true">
          {RULER_TICKS.map((tick) => {
            const isMajor = tick % 6 === 0;
            const isNear = Math.abs(tick - nearestTick) <= 1;
            return (
              <span
                key={tick}
                className={`sun-glass-ruler-tick${isMajor ? " is-major" : ""}${isNear ? " is-near" : ""}`}
              />
            );
          })}
        </div>
        <span className="sun-glass-ruler-needle" aria-hidden="true" />
        <input
          className="sun-glass-time-slider"
          type="range"
          min="0"
          max="1439"
          step="1"
          value={Math.round(displayedMinute)}
          aria-label="一天中的时间"
          onPointerDown={startScrubbing}
          onPointerUp={finishScrubbing}
          onPointerCancel={finishScrubbing}
          onBlur={finishScrubbing}
          onChange={(event) => scheduleMinute(event.target.value)}
        />
      </div>

      {onBackgroundMode ? (
        <div className="sun-glass-bg-switcher" role="group" aria-label="背景天空风格">
          {BACKGROUND_QUICK_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={backgroundMode === option.id ? "is-active" : ""}
              aria-pressed={backgroundMode === option.id}
              data-dt-tip={option.tip}
              onClick={() => onBackgroundMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={`sun-glass-jelly-popover sun-glass-time-menu${
          isOpen ? " is-open" : ""
        }`}
      >
        <div className="sun-glass-time-presets">
          {TIME_PRESETS.map(({ minute, label, Icon }) => (
            <button
              type="button"
              key={minute}
              data-dt-tip={`一键跳转到 ${label} 天光`}
              onClick={() => selectMinute(minute)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="sun-glass-weather-options" aria-label="天气预览">
          <button
            type="button"
            className={usesLiveWeather ? "is-active" : ""}
            aria-pressed={usesLiveWeather}
            aria-label="跟随实时天气"
            data-dt-tip="恢复跟随当地实时气象"
            onClick={() => onWeatherMode?.(null)}
          >
            <LocateFixed aria-hidden="true" />
            <span>实时</span>
          </button>
          {WEATHER_PRESETS.map(({ id, label, Icon }) => (
            <button
              type="button"
              key={id}
              className={displayedWeather === id ? "is-active" : ""}
              aria-pressed={displayedWeather === id}
              aria-label={label}
              data-dt-tip={`预览「${label}」气象粒子特效`}
              onClick={() => onWeatherMode?.(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {(onSyncLocation || onSelectLocation) ? (
          <div className="sun-glass-location-box" aria-label="位置与实时天气同步">
            <div className="sun-glass-location-head">
              <span className="sun-glass-location-meta">
                <MapPin aria-hidden="true" />
                <strong>
                  {liveLocationLabel || (ambientLive?.locationEnabled ? "当前位置" : "未开启定位")}
                </strong>
                {weather ? (
                  <em>
                    {weather.description} {weather.temperatureC}°C
                  </em>
                ) : (
                  <em>{ambientLive?.status?.message || "定位后自动更新当地时间与天气"}</em>
                )}
              </span>
              <div className="sun-glass-location-btns">
                {onSyncLocation ? (
                  <button
                    type="button"
                    disabled={isLocating}
                    onClick={() => onSyncLocation()}
                    data-dt-tip="调用浏览器定位读取你所在位置并更新 DengTa 时间与天气"
                  >
                    <LocateFixed aria-hidden="true" />
                    <span>{isLocating ? "定位中" : "定位更新"}</span>
                  </button>
                ) : null}
                {onRefreshWeather && ambientLive?.locationEnabled ? (
                  <button
                    type="button"
                    disabled={isLocating}
                    aria-label="刷新当前位置天气"
                    onClick={() => onRefreshWeather()}
                  >
                    <RefreshCw aria-hidden="true" />
                  </button>
                ) : null}
                {onEstimateLocationByIp ? (
                  <button
                    type="button"
                    disabled={isLocating}
                    onClick={() => onEstimateLocationByIp()}
                    data-dt-tip="若桌面端无 GPS 权限，可按网络位置快速估算城市与时区"
                  >
                    <Globe2 aria-hidden="true" />
                    <span>网络估算</span>
                  </button>
                ) : null}
                {onSelectLocation ? (
                  <button
                    type="button"
                    onClick={() => setCityOpen((v) => !v)}
                    aria-expanded={cityOpen}
                  >
                    <Search aria-hidden="true" />
                    <span>选城市</span>
                  </button>
                ) : null}
              </div>
            </div>
            {snapshot?.sunriseLabel && snapshot?.sunsetLabel ? (
              <div className="sun-glass-location-sub">
                <span>时区 {snapshot.timeZone || "Asia/Shanghai"}</span>
                <span>日出 {snapshot.sunriseLabel} · 日落 {snapshot.sunsetLabel}</span>
              </div>
            ) : null}
            {cityOpen && onSelectLocation ? (
              <div className="sun-glass-city-picker">
                <form className="di-city-search-row" onSubmit={handleCitySearch}>
                  <input
                    type="text"
                    value={cityQuery}
                    onChange={(event) => setCityQuery(event.target.value)}
                    placeholder="输入城市名（如 上海、北京、Tokyo）"
                    aria-label="搜索城市更新时间和天气"
                  />
                  <button type="submit" disabled={citySearching}>
                    {citySearching ? "检索中" : "搜索"}
                  </button>
                </form>
                {cityError ? <small className="di-city-error">{cityError}</small> : null}
                {cityResults.length > 0 ? (
                  <div className="di-city-results">
                    {cityResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => chooseCity(item)}
                      >
                        <strong>{item.name}</strong>
                        <small>{item.detail || item.timeZone || ""}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="di-city-chips">
                    {QUICK_CITY_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => chooseCity(preset)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <label className="sun-glass-tuner">
          <span>
            <Droplets aria-hidden="true" />
            <span>玻璃度</span>
            <output>{Math.round(glassScrubber.value)}</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(glassScrubber.value)}
            aria-label="全局玻璃度"
            {...glassScrubber.inputProps}
          />
        </label>
      </div>
    </section>
  );
}
