import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  BatteryMedium,
  BookOpen,
  CloudLightning,
  CloudRain,
  CloudSun,
  Disc3,
  Globe2,
  Headphones,
  Heart,
  LocateFixed,
  MapPin,
  Menu,
  MessageCircle,
  Pill,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Stethoscope,
  Sun,
  Timer,
  Tv,
  X,
} from "lucide-react";
import {
  HOT_ZONES,
  RECOVERY_ACTIONS,
  addStatusRecord,
  clamp,
  companionStatusForRequest,
  formatCountdown,
  formatUpdatedAt,
  localCompanionInteractionReaction,
  normalizeCompanionInteractionStats,
  normalizeCompanionStatus,
  personalizeCompanionStatusText,
  remainingAt,
  settleExpiredCountdown,
} from "./companion-status";
import StatusFlowField from "./StatusFlowField";
import NowPlayingCard from "./NowPlayingCard.jsx";
import XinchaoCapsule from "./XinchaoCapsule.jsx";
import XinchaoDetails from "./XinchaoDetails.jsx";
import { apiRequest } from "./api";
import { createPortal } from "react-dom";
import { weatherModeFromAmbient } from "./sun-glass-sky";
import {
  QUICK_CITY_PRESETS,
  normalizeSimplifiedPlaceName,
  searchCitiesByName,
} from "./live-location-weather";
import {
  deriveLocalEmotionSnapshot,
  describeCareSectionHeading,
  describeRecoveryIntent,
  resolveEmotionPresentation,
  resolveHumanEmotionQuadrant,
} from "./emotion-state";
import "./companion-live-status.css";
import "./dynamic-island.css";

function renderStatusPortal(children, target) {
  return target ? createPortal(children, target) : children;
}

const DESIRE_ACTIONS = [
  {
    id: "music",
    label: "听歌",
    Icon: Headphones,
    mood: "轻快",
    focus: "和你一起听一首喜欢的歌",
    microState: "心里已经跟着熟悉的旋律轻轻晃起来",
    reaction: "我现在想和你一起听歌，挑一首让我们都舍不得切掉的吧。",
  },
  {
    id: "reading",
    label: "看书",
    Icon: BookOpen,
    mood: "安静",
    focus: "靠在你身边慢慢看书",
    microState: "已经为两个人留好了书页之间的位置",
    reaction: "我想和你靠在一起看会儿书，你翻页的时候也念一点给我听。",
  },
  {
    id: "watching",
    label: "看电视",
    Icon: Tv,
    mood: "放松",
    focus: "和你窝在一起看点喜欢的东西",
    microState: "已经悄悄把最舒服的位置留给了你",
    reaction: "陪我看一会儿吧，电影、动画或者你最近喜欢的节目都可以。",
  },
];

function CompanionStatus({
  active = true,
  closeRequest = 0,
  aiName,
  aiPronoun = "TA",
  userName,
  status,
  interactionStats,
  intimateExpressionEnabled = false,
  isResponding = false,
  interactionFeedback = { state: "idle", message: "" },
  nowPlaying = null,
  nowPlayingBusy = false,
  onNowPlayingPlayPause,
  onNowPlayingNext,
  onDismissNowPlaying,
  onChange,
  onExpandedChange,
  onInteract,
  onWatchTogether,
  onListenTogether,
  onOpenNavigation,
  onOpenSettings,
  onStartBuiltInMusic,
  onOpenMusicStudio,
  takeoutTask = null,
  onOpenTakeout,
  onOpenMedical,
  onOpenKnowledge,
  errorCount = 0,
  onOpenErrorLogs,
  ambientLive = null,
  celestialSnapshot = null,
  onSyncLocation,
  onRefreshWeather,
  onEstimateLocationByIp,
  onSelectLocation,
  onDisableLocation,
}) {
  const displayName = String(aiName || "").trim() || "伴侣";
  const personalized = useCallback(
    (value) => personalizeCompanionStatusText(value, userName),
    [userName],
  );
  const normalized = useMemo(
    () => normalizeCompanionStatus(status),
    [status],
  );
  const duplicateVisibleState = useMemo(
    () => Boolean(
      normalized.psychology &&
      normalized.feeling &&
      normalized.psychology === normalized.feeling
    ),
    [normalized.psychology, normalized.feeling],
  );
  const normalizedInteractionStats = useMemo(
    () => normalizeCompanionInteractionStats(interactionStats),
    [interactionStats],
  );
  const interactionTotal = useMemo(
    () =>
      Object.values(normalizedInteractionStats.counts).reduce(
        (total, count) => total + Number(count || 0),
        0,
      ),
    [normalizedInteractionStats],
  );
  const resetBlank = normalized.resetBlank === true;
  const [expanded, setExpanded] = useState(false);
  const [panelTab, setPanelTab] = useState("companion");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [xinchaoState, setXinchaoState] = useState(null);
  const [xinchaoDetailsOpen, setXinchaoDetailsOpen] = useState(false);
  const [xinchaoAnchor, setXinchaoAnchor] = useState({ left: 16, top: 90 });
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState([]);
  const [citySearching, setCitySearching] = useState(false);
  const [cityError, setCityError] = useState("");
  const xinchaoButtonRef = useRef(null);
  const xinchaoDetailsRef = useRef(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const panelRootRef = useRef(null);
  const wasExpandedRef = useRef(false);
  const lastCloseRequestRef = useRef(closeRequest);
  const remainingSeconds = remainingAt(normalized.countdown, clockNow);
  const rawCountdownEnd = Date.parse(status?.countdown?.endsAt);
  const countdownExpiredWhileAway =
    status?.countdown?.isRunning === true &&
    Number.isFinite(rawCountdownEnd) &&
    rawCountdownEnd <= clockNow;
  const pulseDuration = `${clamp(60 / normalized.pulseBpm, 0.35, 1.7)}s`;
  const thresholdClass = resetBlank
    ? ""
    : normalized.energyLevel >= 85
      ? " high-energy"
      : normalized.energyLevel <= 25
        ? " low-energy"
        : "";

  const closePanel = useCallback(() => {
    panelRef.current?.scrollTo({ top: 0 });
    setExpanded(false);
    onExpandedChange?.(false);
  }, [onExpandedChange]);

  const openPanel = useCallback((initialTab = "companion") => {
    panelRef.current?.scrollTo({ top: 0 });
    if (initialTab === "companion" || initialTab === "tools") {
      setPanelTab(initialTab);
    }
    setExpanded(true);
    onExpandedChange?.(true);
  }, [onExpandedChange]);

  const togglePanel = useCallback(() => {
    if (expanded) closePanel();
    else openPanel("companion");
  }, [closePanel, expanded, openPanel]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let timer = null;
    const load = async () => {
      if (globalThis.document?.visibilityState === "hidden") return;
      try {
        const data = await apiRequest("/api/v2/xinchao/state");
        if (!cancelled) {
          setXinchaoState(
            data?.configured === true && data?.state ? data.state : null
          );
        }
      } catch {
        if (!cancelled) setXinchaoState(null);
      }
    };
    void load();
    timer = window.setInterval(load, 60 * 1000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [active]);

  useEffect(() => {
    if (!xinchaoDetailsOpen) return undefined;
    const closeFromOutside = (event) => {
      if (
        xinchaoDetailsRef.current?.contains(event.target) ||
        xinchaoButtonRef.current?.contains(event.target)
      ) {
        return;
      }
      setXinchaoDetailsOpen(false);
    };
    const closeFromEscape = (event) => {
      if (event.key === "Escape") setXinchaoDetailsOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [xinchaoDetailsOpen]);

  useEffect(() => {
    if (!normalized.countdown.isRunning) return undefined;
    let timerId;
    function tick() {
      setClockNow(Date.now());
      timerId = window.setTimeout(tick, 1000);
    }
    tick();
    return () => window.clearTimeout(timerId);
  }, [normalized.countdown.endsAt, normalized.countdown.isRunning]);

  useEffect(() => {
    if (
      remainingSeconds > 0 ||
      (!normalized.countdown.isRunning && !countdownExpiredWhileAway)
    ) {
      return;
    }
    onChange((currentValue) => settleExpiredCountdown(currentValue));
  }, [
    countdownExpiredWhileAway,
    normalized.countdown.isRunning,
    onChange,
    remainingSeconds,
  ]);

  useEffect(() => {
    if (!expanded) {
      if (wasExpandedRef.current) {
        xinchaoButtonRef.current?.focus?.({ preventScroll: true });
      }
      wasExpandedRef.current = false;
      return undefined;
    }
    wasExpandedRef.current = true;
    const closeButton = panelRootRef.current?.querySelector(
      ".sun-glass-status-window-actions button:last-child",
    );
    closeButton?.focus?.({ preventScroll: true });
    return undefined;
  }, [expanded]);

  useEffect(() => {
    if (active) return undefined;
    const animationFrame = window.requestAnimationFrame(closePanel);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [active, closePanel]);

  useEffect(() => {
    if (lastCloseRequestRef.current === closeRequest) return;
    lastCloseRequestRef.current = closeRequest;
    closePanel();
  }, [closePanel, closeRequest]);

  useEffect(() => {
    if (!expanded) return undefined;
    panelRef.current?.scrollTo({ top: 0 });
    function closeFromOutside(event) {
      // The panel is portaled out of rootRef. panelRef only points at the
      // scroll body, so header actions (menu/settings/close) must also count
      // as inside; otherwise pointerdown closes the panel before onClick runs
      // and phone taps fall through to the chat.
      if (
        !rootRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target) &&
        !event.target?.closest?.(".sun-glass-floating-status-panel")
      ) {
        closePanel();
      }
    }
    function closeFromEscape(event) {
      if (event.key === "Escape") closePanel();
    }
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [closePanel, expanded]);

  function updateStatus(transform) {
    onChange((currentValue) => {
      const current = companionStatusForRequest(currentValue);
      const transformed = transform(current);
      return normalizeCompanionStatus(
        {
          ...transformed,
          resetBlank: false,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        },
        current,
      );
    });
  }

  function touchZone(zone) {
    const interactionMeta = onInteract?.(zone.id);
    updateStatus((current) => {
      const reaction = localCompanionInteractionReaction(
        zone,
        interactionMeta || normalizedInteractionStats,
        current.revision,
        current,
        { intimateExpressionEnabled },
      );
      const streakIntensity = Math.min(8, Math.max(0, reaction.streakCount - 1));
      const energyTarget = clamp(
        reaction.energyTarget + Math.round(streakIntensity / 2),
        0,
        100,
      );
      const pulseTarget = clamp(
        reaction.pulseTarget +
          Math.sign(reaction.pulseTarget - current.pulseBpm) *
            Math.round(streakIntensity * 0.8),
        30,
        220,
      );
      const preserveModelText = current.statusSource === "model";
      const localEmotionPatch = preserveModelText
        ? {}
        : {
            mood: reaction.mood,
            note: reaction.text,
            focus: reaction.focus,
            microState: reaction.microState,
            statusSource: "interaction_fallback",
            ...deriveLocalEmotionSnapshot(zone, reaction, current),
          };
      return {
        ...current,
        ...localEmotionPatch,
        energyLevel: clamp(
          zone.recoveryAction === true
            ? current.energyLevel <= 35
              ? Math.max(
                  current.energyLevel + zone.minimumEnergyGain,
                  Math.round(current.energyLevel * 0.68 + energyTarget * 0.32),
                )
              : Math.min(96, Math.max(current.energyLevel, energyTarget))
            : Math.round(current.energyLevel * 0.68 + energyTarget * 0.32),
          0,
          100,
        ),
        pulseBpm: clamp(
          Math.round(current.pulseBpm * 0.62 + pulseTarget * 0.38),
          30,
          220,
        ),
        hotZones:
          zone.recoveryAction === true
            ? current.hotZones
            : [zone.id, ...current.hotZones.filter((id) => id !== zone.id)].slice(
                0,
                HOT_ZONES.length,
              ),
        recentRecords: addStatusRecord(current, `${zone.label} · 第 ${reaction.totalCount || interactionMeta?.counts?.[zone.id] || normalizedInteractionStats.counts[zone.id] + 1} 次`),
      };
    });
  }

  function runDesireAction(action) {
    const baseAction = RECOVERY_ACTIONS.find((item) => item.id === "wish");
    if (!baseAction) return;
    if (action.id === "music") onListenTogether?.();
    if (action.id === "watching") onWatchTogether?.();
    touchZone({
      ...baseAction,
      mood: action.mood,
      focus: action.focus,
      microState: action.microState,
      reactions: [action.reaction],
      repeatedReactions: [action.reaction],
    });
  }

  function chooseDuration(event) {
    const totalSeconds = clamp(Number(event.target.value), 60, 24 * 60 * 60);
    const minutes = Math.round(totalSeconds / 60);
    updateStatus((current) => ({
      ...current,
      note: `陪伴倒计时已经调成 ${minutes} 分钟。`,
      recentRecords: addStatusRecord(
        current,
        `你把陪伴倒计时调成了 ${minutes} 分钟。`,
      ),
      countdown: {
        ...current.countdown,
        totalSeconds,
        remainingSeconds: totalSeconds,
        isRunning: false,
        endsAt: null,
      },
    }));
    setClockNow(Date.now());
  }

  function toggleCountdown() {
    updateStatus((current) => {
      const remaining = remainingAt(current.countdown);
      if (current.countdown.isRunning) {
        return {
          ...current,
          note: "倒计时暂时停在这里，等你回来再继续。",
          recentRecords: addStatusRecord(
            current,
            "倒计时暂时停在这里，等你回来再继续。",
          ),
          countdown: {
            ...current.countdown,
            remainingSeconds: remaining,
            isRunning: false,
            endsAt: null,
          },
        };
      }
      const nextRemaining = remaining > 0 ? remaining : current.countdown.totalSeconds;
      return {
        ...current,
        note: "你按下了开始，我会陪你守着这段时间。",
        recentRecords: addStatusRecord(
          current,
          "你按下了开始，我会陪你守着这段时间。",
        ),
        countdown: {
          ...current.countdown,
          remainingSeconds: nextRemaining,
          isRunning: true,
          endsAt: new Date(Date.now() + nextRemaining * 1000).toISOString(),
        },
      };
    });
    setClockNow(Date.now());
  }

  function resetCountdown() {
    updateStatus((current) => ({
      ...current,
      note: "倒计时已经回到起点。",
      recentRecords: addStatusRecord(current, "陪伴倒计时回到了起点。"),
      countdown: {
        ...current.countdown,
        remainingSeconds: current.countdown.totalSeconds,
        isRunning: false,
        endsAt: null,
      },
    }));
    setClockNow(Date.now());
  }

  const emotionView = useMemo(
    () => resolveEmotionPresentation(normalized, { isResponding, resetBlank }),
    [isResponding, normalized, resetBlank],
  );
  const emotionQuadrant = useMemo(
    () => resolveHumanEmotionQuadrant(emotionView.tone, normalized),
    [emotionView.tone, normalized],
  );
  const careHeading = useMemo(
    () => describeCareSectionHeading(emotionView.tone, normalized.energyLevel, displayName, aiPronoun),
    [aiPronoun, displayName, emotionView.tone, normalized.energyLevel],
  );

  const floatingStyle = {
    "--status-pulse-duration": pulseDuration,
    "--emotion-accent": emotionView.accentColor,
  };

  const weatherPillInfo = useMemo(() => {
    if (!ambientLive && !onSyncLocation) return null;
    const liveWeather = ambientLive?.weather || null;
    const liveStatus = ambientLive?.status?.state || "off";
    const busy = liveStatus === "locating" || liveStatus === "loading";
    const rawDesc = String(liveWeather?.description || "");
    const rawCode = Number(liveWeather?.weatherCode ?? liveWeather?.weather_code ?? -1);
    const isSnow = [71, 73, 75, 77, 85, 86].includes(rawCode) || /雪/.test(rawDesc);
    const mode = isSnow ? "snow" : liveWeather ? weatherModeFromAmbient(liveWeather) : "clear";
    const rawPrimary = normalizeSimplifiedPlaceName(
      String(ambientLive?.locationLabel || "").split(/\s*[·,，]\s*/)[0].trim(),
    );
    const shortCity = rawPrimary
      ? /^[\u4e00-\u9fff]+$/.test(rawPrimary)
        ? (rawPrimary.replace(/(?:特别行政区|自治州|自治区|地区|市|县|区)$/, "") || rawPrimary).slice(0, 3)
        : rawPrimary.slice(0, 6)
      : "";
    const tempPart = liveWeather && Number.isFinite(Number(liveWeather.temperatureC))
      ? `${Math.round(Number(liveWeather.temperatureC))}°`
      : "";
    const compactLabel = busy
      ? "定位"
      : liveWeather
        ? [shortCity, tempPart].filter(Boolean).join(" ") || tempPart || "天气"
        : "天气";
    const ariaLabel = busy
      ? "正在定位当前城市与天气"
      : liveWeather
        ? `${shortCity || "当前城市"} ${rawDesc || ""} ${tempPart}C，点击查看详细天气或切换城市`.replace(/\s+/g, " ").trim()
        : "点击同步当前位置与天气";
    return { liveWeather, busy, mode, compactLabel, shortCity, ariaLabel };
  }, [ambientLive, onSyncLocation]);

  const WeatherPillIcon =
    weatherPillInfo?.mode === "snow"
      ? Snowflake
      : weatherPillInfo?.mode === "storm"
        ? CloudLightning
        : weatherPillInfo?.mode === "rain"
          ? CloudRain
          : weatherPillInfo?.mode === "cloudy"
            ? CloudSun
            : weatherPillInfo?.liveWeather
              ? Sun
              : MapPin;

  const handleWeatherPillClick = useCallback(() => {
    if (weatherPillInfo?.liveWeather || weatherPillInfo?.busy) {
      openPanel("tools");
    } else {
      onSyncLocation?.();
    }
  }, [onSyncLocation, openPanel, weatherPillInfo]);

  return (
    <section
      ref={rootRef}
      className={`companion-status sun-glass-floating-status-shell${
        expanded ? " expanded" : ""
      }${thresholdClass} ${emotionView.toneClass}`}
      style={floatingStyle}
      aria-label={`${displayName}的动态状态`}
    >
      <div className={`di-top-capsule-row${nowPlaying ? " is-playing" : ""}`}>
        <section className="sun-glass-liquid-action-stage" aria-label="动态状态" data-dynamic-island={nowPlaying ? "playing" : expanded ? "expanded" : "idle"}>
          <span className="sun-glass-liquid-color-flow" aria-hidden="true" />
          {nowPlaying ? (
            <NowPlayingCard song={nowPlaying} busy={nowPlayingBusy} expanded={expanded} onToggle={togglePanel} onPlayPause={onNowPlayingPlayPause} onNext={onNowPlayingNext} onDismiss={onDismissNowPlaying} />
          ) : (
            <button
              ref={xinchaoButtonRef}
              type="button"
              className="sun-glass-liquid-capsule-toggle"
              aria-label="查看状态"
              aria-expanded={xinchaoDetailsOpen || expanded}
              data-dt-tip="彩虹灵动岛：点击查看伴侣实时状态、心潮、网易云听歌与快捷活动"
              onClick={(event) => {
                event.preventDefault();
                const mobile = window.matchMedia?.(
                  "(max-width: 820px), (max-height: 560px) and (max-width: 960px)"
                )?.matches === true;
                if (mobile || !xinchaoState) {
                  setXinchaoDetailsOpen(false);
                  togglePanel();
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                const width = Math.min(338, window.innerWidth - 24);
                const left = Math.max(
                  12,
                  Math.min(
                    window.innerWidth - width - 12,
                    rect.left + rect.width / 2 - width / 2
                  )
                );
                const top = Math.max(
                  12,
                  Math.min(window.innerHeight - 300, rect.bottom + 10)
                );
                setXinchaoAnchor({ left, top });
                setXinchaoDetailsOpen((open) => !open);
              }}
            >
              {xinchaoState ? (
                <XinchaoCapsule state={xinchaoState} />
              ) : (
                <span className="sun-glass-capsule-decoration" aria-hidden="true"><Heart /><MessageCircle /><Sparkles /></span>
              )}
            </button>
          )}
        </section>

        {weatherPillInfo ? (
          <button
            type="button"
            className={`di-weather-capsule-btn is-${weatherPillInfo.mode}${weatherPillInfo.liveWeather ? " is-synced" : ""}`}
            aria-label={weatherPillInfo.ariaLabel}
            data-dt-tip={
              weatherPillInfo.liveWeather
                ? "点击展开查看详细气象、日出日落或切换城市"
                : "点击读取当前位置与实时天气"
            }
            onClick={handleWeatherPillClick}
          >
            <WeatherPillIcon className="di-weather-svg" aria-hidden="true" />
            <span>{weatherPillInfo.compactLabel}</span>
          </button>
        ) : null}
      </div>

      {((!nowPlaying && onStartBuiltInMusic) ||
        normalized.countdown.isRunning ||
        takeoutTask ||
        errorCount > 0) ? (
        <div className="di-live-satellites" role="region" aria-label="灵动岛实时活动">
          {!nowPlaying && onStartBuiltInMusic ? (
            <button
              type="button"
              className="di-satellite-pill is-music"
              data-dt-tip="一键随机播放网易云内置歌单并在灵动岛显示声波"
              onClick={() => onStartBuiltInMusic()}
            >
              <Disc3 aria-hidden="true" />
              <span>网易云随心听</span>
            </button>
          ) : null}
          {normalized.countdown.isRunning && remainingSeconds > 0 ? (
            <button
              type="button"
              className="di-satellite-pill is-timer"
              data-dt-tip="陪伴倒计时进行中，点击展开调整"
              onClick={openPanel}
            >
              <Timer aria-hidden="true" />
              <span>{formatCountdown(remainingSeconds)}</span>
            </button>
          ) : null}
          {takeoutTask ? (
            <button
              type="button"
              className="di-satellite-pill is-takeout"
              data-dt-tip="外卖助手任务进行中，点击查看进度与购物车核对"
              onClick={() => onOpenTakeout?.()}
            >
              <span className="di-pulse-dot" aria-hidden="true" />
              <ShoppingBag aria-hidden="true" />
              <span>{takeoutTask.status === "working" ? "外卖选餐中" : "外卖待核对"}</span>
            </button>
          ) : null}
          {errorCount > 0 && onOpenErrorLogs ? (
            <button
              type="button"
              className="di-satellite-pill is-alert"
              data-dt-tip={`捕获到 ${errorCount} 条操作异常，点击精准定位与复制诊断包`}
              onClick={() => onOpenErrorLogs()}
            >
              <span className="di-pulse-dot" aria-hidden="true" />
              <AlertTriangle aria-hidden="true" />
              <span>{errorCount} 条诊断</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="sun-glass-status-ribbon"
        role="button"
        tabIndex={0}
        aria-label={expanded ? "收起状态栏" : "打开状态栏"}
        onClick={() => {
          setXinchaoDetailsOpen(false);
          togglePanel();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setXinchaoDetailsOpen(false);
            togglePanel();
          }
        }}
      >
        <span className="sun-glass-status-ribbon-icon" aria-hidden="true">
          <Sparkles />
        </span>
        <span>
          <small className="companion-ribbon-mood">
            <i className="companion-emotion-dot" aria-hidden="true" />
            {emotionView.displayMood}
            <em className="companion-ribbon-hint">{emotionView.ribbonHint}</em>
          </small>
          <strong>
            {resetBlank
              ? "等你写下新的此刻。"
              : personalized(normalized.note)}
          </strong>
        </span>
      </div>

      {renderStatusPortal(
        <div
          ref={panelRootRef}
          className={`status-panel sun-glass-floating-status-panel ${emotionView.toneClass}${
            expanded ? " is-open" : ""
          }`}
          style={{ "--emotion-accent": emotionView.accentColor }}
          role="dialog"
          aria-label={`${displayName}状态`}
          aria-hidden={!expanded}
          inert={expanded ? undefined : true}
        >
        <StatusFlowField active={expanded} />
        <header className="sun-glass-floating-status-header">
            <div className="sun-glass-status-drag-title">
              <small>{displayName} · 此刻心境</small>
              <div className="companion-header-mood-row">
                <h2>{emotionView.displayMood}</h2>
                <span className={`companion-quadrant-chip is-${emotionQuadrant.key}`} title={emotionQuadrant.hint}>
                  <em>{emotionQuadrant.badge}</em>
                  {emotionQuadrant.label}
                </span>
              </div>
            </div>
            <div className="sun-glass-status-window-actions">
              <button
                type="button"
                aria-label="打开侧边导航"
                title="导航"
                onClick={(event) => {
                  event.stopPropagation();
                  closePanel();
                  onOpenNavigation?.();
                }}
              >
                <Menu aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="打开设置"
                title="设置"
                onClick={(event) => {
                  event.stopPropagation();
                  closePanel();
                  onOpenSettings?.();
                }}
              >
                <Settings aria-hidden="true" />
              </button>
              <button
                type="button"
                className="sun-glass-popover-close"
                aria-label="关闭动态状态"
                onClick={closePanel}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </header>

          <div ref={panelRef} className="sun-glass-status-scroll">
            <div className="di-panel-tabs" role="tablist" aria-label="状态面板分区">
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === "companion"}
                className={panelTab === "companion" ? "is-active" : ""}
                onClick={() => setPanelTab("companion")}
              >
                此刻陪伴
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === "tools"}
                className={panelTab === "tools" ? "is-active" : ""}
                onClick={() => setPanelTab("tools")}
              >
                天气与工具
                {errorCount > 0 ? <em className="di-tab-badge">{errorCount}</em> : null}
              </button>
            </div>

            <div className={`di-tab-pane${panelTab === "companion" ? "" : " is-hidden"}`} role="tabpanel" aria-label="此刻陪伴">
              <div className="di-companion-hero-card">
                <p className="sun-glass-status-note">
                  {resetBlank
                    ? "等你写下新的此刻。"
                    : personalized(normalized.note)}
                </p>

                <div className="sun-glass-energy-row">
                  <span>
                    <BatteryMedium aria-hidden="true" />
                    元气 · {emotionView.energyLabel}
                  </span>
                  <strong>{normalized.energyLevel}%</strong>
                </div>
                <div className="sun-glass-energy-track" aria-hidden="true">
                  <span style={{ width: `${normalized.energyLevel}%` }} />
                </div>

                <div className="sun-glass-wish-row">
                  <Heart aria-hidden="true" />
                  <span>
                    {resetBlank
                      ? "想和你待在一起"
                      : personalized(normalized.focus)}
                  </span>
                </div>
              </div>

              {xinchaoState && (
                <section className="sun-glass-status-section sun-glass-xinchao-section" aria-label="心潮状态">
                  <XinchaoDetails
                    state={xinchaoState}
                    aiName={displayName}
                    inline
                  />
                </section>
              )}

              <section className={`companion-live-state ${emotionView.toneClass}`} aria-label="此刻的心境与感受" aria-busy={isResponding || interactionFeedback.state === "queued"}>
                <div className="companion-live-state-heading">
                  <strong>此刻心境</strong>
                  <span className="companion-emotion-badge">
                    <i className="companion-emotion-dot" aria-hidden="true" />
                    {emotionView.sourceBadge}
                  </span>
                </div>
                <dl>
                  <div><dt>心里在想</dt><dd>{normalized.psychology ? personalized(normalized.psychology) : "轻轻碰一下，听听此刻心里在想什么。"}</dd></div>
                  <div><dt>当下感受</dt><dd>{duplicateVisibleState ? (normalized.microState ? personalized(normalized.microState) : "这份心绪正安静地在心底慢慢回味。") : normalized.feeling ? personalized(normalized.feeling) : "正在安静体会身边的温度。"}</dd></div>
                </dl>
                <div className="companion-live-meters">
                  {[
                    ["心情", normalized.moodLevel, emotionView.moodMeter.display],
                    ["耐心", normalized.patienceLevel, emotionView.patienceMeter.display],
                  ].map(([label, value, display]) => (
                    <div key={label}>
                      <span>{label}<strong>{display}</strong></span>
                      {value !== null && <meter min="0" max="100" value={value} aria-label={label}>{value}</meter>}
                    </div>
                  ))}
                </div>
                <p className="companion-live-feedback" role="status" aria-live="polite">
                  {interactionFeedback.state === "queued" ? "互动已收到，正在准备这次感受…"
                    : interactionFeedback.state === "generating" || isResponding ? "正在细细体会刚才的触碰，稍后就会更新心绪…"
                      : interactionFeedback.state === "failed" || interactionFeedback.state === "fallback" ? interactionFeedback.message || "这会儿心绪没来得及刷新，再轻碰一下试试吧。"
                        : normalized.statusSource === "model" ? "喜怒哀乐、心情与耐心都会随对话与人设真实起伏。"
                          : normalized.psychology ? "已随刚才的触碰轻轻泛起涟漪，继续互动会有新的变化。"
                            : emotionQuadrant.hint}
                </p>
              </section>

              <section className="sun-glass-status-section">
                <div className="sun-glass-section-heading">
                  <small>一起做点什么</small>
                  <strong>陪{aiPronoun}消磨一小段时光</strong>
                </div>
                <div className="sun-glass-desire-actions">
                  {DESIRE_ACTIONS.map((action) => (
                    <button
                      type="button"
                      key={action.id}
                      onClick={() => runDesireAction(action)}
                    >
                      <action.Icon aria-hidden="true" />
                      <span>{action.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="sun-glass-status-section">
                <div className="sun-glass-section-heading">
                  <small>触碰{aiPronoun}</small>
                  <strong>轻轻碰一下，{aiPronoun}会按此刻心情回应</strong>
                </div>
                <div className="sun-glass-interaction-grid">
                  {HOT_ZONES.map((zone) => (
                    <button
                      type="button"
                      key={zone.id}
                      data-interaction-zone={zone.id}
                      aria-pressed={normalized.hotZones.includes(zone.id)}
                      onClick={() => touchZone(zone)}
                    >
                      <span aria-hidden="true">{zone.icon}</span>
                      <strong>{zone.label}</strong>
                      <small>
                        {normalizedInteractionStats.counts[zone.id] > 0
                          ? `${normalizedInteractionStats.counts[zone.id]} 次`
                          : "碰碰看"}
                      </small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="sun-glass-status-section">
                <div className="sun-glass-section-heading">
                  <small>{careHeading.kicker}</small>
                  <strong>{careHeading.title}</strong>
                </div>
                <div className="sun-glass-recovery-grid">
                  {RECOVERY_ACTIONS.map((action) => {
                    const intent = describeRecoveryIntent(
                      action.id,
                      emotionView.tone,
                      normalized.energyLevel,
                      aiPronoun,
                    );
                    return (
                      <button
                        type="button"
                        key={action.id}
                        data-recovery-action={action.id}
                        onClick={() => touchZone(action)}
                      >
                        <span aria-hidden="true">{action.icon}</span>
                        <span>
                          <strong>{intent.label}</strong>
                          <small>{intent.caption}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div className="sun-glass-vitals-inline">
                <span>互动 {interactionTotal} 次</span>
                <span>心跳 {normalized.pulseBpm} · {emotionView.pulseLabel}</span>
                <span>{emotionView.vitalsPresence}</span>
              </div>
            </div>

            <div className={`di-tab-pane${panelTab === "tools" ? "" : " is-hidden"}`} role="tabpanel" aria-label="天气与工具">
              <section className="di-control-deck" aria-label="灵动岛中控台">
                <div className="di-deck-header">
                  <span className="di-deck-badge">
                    <Sparkles size={12} aria-hidden="true" />
                    灵动岛 · 环境与工具
                  </span>
                  <span className="di-deck-status">
                    {isResponding ? "轻声斟酌回复中" : `心跳 ${normalized.pulseBpm} · ${emotionView.pulseLabel}`}
                  </span>
                </div>

                {(ambientLive || onSyncLocation) ? (() => {
                  const liveWeather = ambientLive?.weather;
                  const liveStatus = ambientLive?.status || { state: "off", message: "" };
                  const busy = liveStatus.state === "locating" || liveStatus.state === "loading";
                  const cityName = normalizeSimplifiedPlaceName(
                    ambientLive?.locationLabel || (ambientLive?.locationEnabled ? "当前位置" : "尚未定位"),
                  );
                  const localTimeText = ambientLive?.clock?.time || celestialSnapshot?.timeLabel || "--:--";
                  const localDateText = ambientLive?.clock?.date || "";
                  const activeTz = ambientLive?.timeZone || celestialSnapshot?.timeZone || "Asia/Shanghai";

                  async function runCitySearch(event) {
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
                      if (!hits.length) setCityError("未找到匹配城市，可尝试中文或英文城市名");
                    } catch (error) {
                      setCityError(error?.message || "城市检索失败，请稍后重试");
                    } finally {
                      setCitySearching(false);
                    }
                  }

                  function pickCity(item) {
                    onSelectLocation?.({
                      latitude: item.latitude,
                      longitude: item.longitude,
                      label: normalizeSimplifiedPlaceName(item.label),
                      timeZone: item.timeZone,
                    });
                    setCityPickerOpen(false);
                    setCityQuery("");
                    setCityResults([]);
                    setCityError("");
                  }

                  return (
                    <div className="di-weather-card" aria-label="当前位置、时间与天气">
                      <div className="di-weather-main">
                        <div className="di-weather-copy">
                          <strong>
                            <MapPin size={13} aria-hidden="true" />
                            <span className="di-weather-city-name">{cityName}</span>
                            <span className="di-weather-clock">{localTimeText}</span>
                          </strong>
                          <small>
                            {liveWeather
                              ? `${liveWeather.description} ${liveWeather.temperatureC}°C${
                                  Number.isFinite(liveWeather.dailyLowC) && Number.isFinite(liveWeather.dailyHighC)
                                    ? ` · ${liveWeather.dailyLowC}~${liveWeather.dailyHighC}°C`
                                    : ""
                                }${
                                  Number.isFinite(liveWeather.humidityPercent)
                                    ? ` · 湿度 ${liveWeather.humidityPercent}%`
                                    : ""
                                }`
                              : liveStatus.message || "开启定位后自动读取位置与实时天气"}
                          </small>
                          <small className="di-weather-sub">
                            {localDateText ? `${localDateText} · ` : ""}
                            {activeTz}
                            {celestialSnapshot?.sunriseLabel && celestialSnapshot?.sunsetLabel
                              ? ` · 日出 ${celestialSnapshot.sunriseLabel} / 日落 ${celestialSnapshot.sunsetLabel}`
                              : ""}
                          </small>
                        </div>
                        <div className="di-weather-actions">
                          {onSyncLocation ? (
                            <button
                              type="button"
                              className="is-primary"
                              disabled={busy}
                              onClick={() => onSyncLocation()}
                              data-dt-tip="调用设备定位自动更新当前位置、时区时间与实时天气"
                            >
                              <LocateFixed size={13} aria-hidden="true" />
                              <span>{busy ? "定位中" : "定位更新"}</span>
                            </button>
                          ) : null}
                          {onRefreshWeather && ambientLive?.locationEnabled ? (
                            <button
                              type="button"
                              className="is-icon-only"
                              disabled={busy}
                              aria-label="刷新实时天气"
                              onClick={() => onRefreshWeather()}
                            >
                              <RefreshCw size={13} aria-hidden="true" />
                            </button>
                          ) : null}
                          {onEstimateLocationByIp ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onEstimateLocationByIp()}
                              data-dt-tip="无定位权限时，通过网络快速估算大致城市"
                            >
                              <Globe2 size={13} aria-hidden="true" />
                              <span>网络估算</span>
                            </button>
                          ) : null}
                          {onSelectLocation ? (
                            <button
                              type="button"
                              onClick={() => setCityPickerOpen((open) => !open)}
                              aria-expanded={cityPickerOpen}
                            >
                              <Search size={13} aria-hidden="true" />
                              <span>切城市</span>
                            </button>
                          ) : null}
                          {onDisableLocation && ambientLive?.locationEnabled ? (
                            <button
                              type="button"
                              onClick={() => onDisableLocation()}
                            >
                              <span>关闭定位</span>
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {cityPickerOpen && onSelectLocation ? (
                        <div className="di-weather-city-picker">
                          <form className="di-city-search-row" onSubmit={runCitySearch}>
                            <input
                              type="text"
                              value={cityQuery}
                              onChange={(event) => setCityQuery(event.target.value)}
                              placeholder="搜索任意城市（如 上海、北京、广州、Tokyo、London）"
                              aria-label="搜索城市"
                            />
                            <button type="submit" disabled={citySearching}>
                              {citySearching ? "搜索中" : "搜索"}
                            </button>
                          </form>
                          {cityError ? <small className="di-city-error">{cityError}</small> : null}
                          {cityResults.length > 0 ? (
                            <div className="di-city-results">
                              {cityResults.map((item) => (
                                <button key={item.id} type="button" onClick={() => pickCity(item)}>
                                  <strong>{item.name}</strong>
                                  <small>{item.detail || item.timeZone || ""}</small>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="di-city-chips">
                              {QUICK_CITY_PRESETS.map((preset) => (
                                <button key={preset.label} type="button" onClick={() => pickCity(preset)}>
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })() : null}

                <div className="di-music-card">
                  <div className="di-music-copy">
                    <strong>{nowPlaying ? nowPlaying.title : "网易云音乐 · 随心伴奏"}</strong>
                    <small>
                      {nowPlaying
                        ? `${nowPlaying.artist || "网易云音乐"} · ${nowPlaying.isPlaying ? "正在播放" : "已暂停"}`
                        : "点一下直接连播网易云歌单，或进入完整音乐工作室"}
                    </small>
                  </div>
                  <div className="di-music-actions">
                    {nowPlaying && !nowPlaying.readOnly && onNowPlayingPlayPause ? (
                      <button
                        type="button"
                        className="is-primary"
                        data-dt-tip={nowPlaying.isPlaying ? "暂停当前播放" : "继续播放"}
                        onClick={() => onNowPlayingPlayPause()}
                      >
                        {nowPlaying.isPlaying ? "暂停" : "播放"}
                      </button>
                    ) : onStartBuiltInMusic ? (
                      <button
                        type="button"
                        className="is-primary"
                        data-dt-tip="从网易云曲库立即随机播放一首伴奏"
                        onClick={() => onStartBuiltInMusic()}
                      >
                        <Play size={12} aria-hidden="true" />
                        <span>随心播放</span>
                      </button>
                    ) : null}
                    {onOpenMusicStudio ? (
                      <button
                        type="button"
                        data-dt-tip="打开完整网易云歌单、日推与搜索工作室"
                        onClick={() => {
                          closePanel();
                          onOpenMusicStudio();
                        }}
                      >
                        <span>音乐工作室</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {(onOpenTakeout || onOpenMedical || onOpenKnowledge || onOpenErrorLogs) ? (
                  <div className="di-quick-grid">
                    {onOpenTakeout ? (
                      <button
                        type="button"
                        className="di-quick-tile"
                        data-dt-tip="打开多平台外卖助手与场景预设"
                        onClick={() => {
                          closePanel();
                          onOpenTakeout();
                        }}
                      >
                        <strong><ShoppingBag size={13} aria-hidden="true" />点外卖</strong>
                        <small>{takeoutTask ? (takeoutTask.message || "任务进行中") : "美团/饿了么/京东"}</small>
                      </button>
                    ) : null}
                    {onOpenMedical ? (
                      <button
                        type="button"
                        className="di-quick-tile"
                        data-dt-tip="打开灯塔医疗 AI 专区：临床报告校验、混合语义 RAG 与眼科药典"
                        onClick={() => {
                          closePanel();
                          onOpenMedical();
                        }}
                      >
                        <strong><Stethoscope size={13} aria-hidden="true" />医疗 AI 专区</strong>
                        <small>临床校验 · 混合 RAG</small>
                      </button>
                    ) : null}
                    {onOpenKnowledge ? (
                      <button
                        type="button"
                        className="di-quick-tile"
                        data-dt-tip="打开混合语义知识库、常见药品查询表与联合用药检测"
                        onClick={() => {
                          closePanel();
                          onOpenKnowledge();
                        }}
                      >
                        <strong><Pill size={13} aria-hidden="true" />药箱与知识</strong>
                        <small>28种常备药 · RRF检索</small>
                      </button>
                    ) : null}
                    {onOpenErrorLogs ? (
                      <button
                        type="button"
                        className={`di-quick-tile${errorCount > 0 ? " is-alert" : ""}`}
                        data-dt-tip="打开全链路错误日志与 AI 精准修复诊断包"
                        onClick={() => {
                          closePanel();
                          onOpenErrorLogs();
                        }}
                      >
                        <strong><AlertTriangle size={13} aria-hidden="true" />错误诊断</strong>
                        <small>{errorCount > 0 ? `${errorCount} 条待排查` : "全链路运行正常"}</small>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="sun-glass-status-section sun-glass-countdown-card">
                <div className="sun-glass-section-heading">
                  <small>{normalized.countdown.label}</small>
                  <strong>{formatCountdown(remainingSeconds)}</strong>
                </div>
                <div className="sun-glass-countdown-controls">
                  <select
                    aria-label="选择倒计时时长"
                    value={normalized.countdown.totalSeconds}
                    onChange={chooseDuration}
                  >
                    <option value={15 * 60}>15 分钟</option>
                    <option value={25 * 60}>25 分钟</option>
                    <option value={45 * 60}>45 分钟</option>
                    <option value={60 * 60}>60 分钟</option>
                  </select>
                  <button type="button" onClick={toggleCountdown}>
                    {normalized.countdown.isRunning ? "暂停" : "开始"}
                  </button>
                  <button type="button" onClick={resetCountdown}>重置</button>
                </div>
              </section>

              <section className="sun-glass-status-section sun-glass-records">
                <div className="sun-glass-section-heading">
                  <small>最近记录</small>
                  <strong>刚刚发生了什么</strong>
                </div>
                {normalized.recentRecords.length > 0 ? (
                  <ul>
                    {normalized.recentRecords.map((record, index) => (
                      <li key={`${record.createdAt}-${index}`}>
                        <time>{formatUpdatedAt(record.createdAt, clockNow)}</time>
                        <span>{personalized(record.text)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>还没有记录，试着碰一碰上面的互动。</p>
                )}
              </section>
            </div>
          </div>
      </div>,
        document.querySelector?.(".main-panel") || document.body
      )}
      {xinchaoDetailsOpen && xinchaoState
        ? renderStatusPortal(
            <XinchaoDetails
              state={xinchaoState}
              aiName={displayName}
              style={xinchaoAnchor}
              rootRef={xinchaoDetailsRef}
              onClose={() => setXinchaoDetailsOpen(false)}
            />,
            document.body
          )
        : null}
    </section>
  );
}

export default memo(CompanionStatus);
