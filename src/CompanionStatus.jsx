import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BatteryMedium,
  BookOpen,
  ChevronRight,
  Headphones,
  Heart,
  MessageCircle,
  Sparkles,
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
  normalizeCompanionStatus,
  normalizeCompanionInteractionStats,
  personalizeCompanionStatusText,
  remainingAt,
  settleExpiredCountdown,
} from "./companion-status";

const STATUS_MINIMIZED_STORAGE_KEY = "dengta_companion_status_minimized_v1";

const QUICK_ACTIONS = [
  { id: "embrace", label: "抱抱", Icon: Heart },
  { id: "confide", label: "倾诉", Icon: MessageCircle },
  { id: "wish", label: "陪她做点什么", Icon: Sparkles },
];

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
    label: "看一会儿",
    Icon: Tv,
    mood: "放松",
    focus: "和你窝在一起看点喜欢的东西",
    microState: "已经悄悄把最舒服的位置留给了你",
    reaction: "陪我看一会儿吧，电影、动画或者你最近喜欢的节目都可以。",
  },
];

function readStatusMinimized() {
  try {
    return localStorage.getItem(STATUS_MINIMIZED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function storeStatusMinimized(value) {
  try {
    localStorage.setItem(STATUS_MINIMIZED_STORAGE_KEY, String(value));
  } catch {
    // Local preference persistence is optional.
  }
}

function CompanionStatus({
  active = true,
  closeRequest = 0,
  aiName,
  userName,
  status,
  interactionStats,
  intimateExpressionEnabled = false,
  isResponding = false,
  onChange,
  onExpandedChange,
  onInteract,
}) {
  const displayName = String(aiName || "").trim() || "小灯";
  const personalized = useCallback(
    (value) => personalizeCompanionStatusText(value, userName),
    [userName],
  );
  const normalized = useMemo(
    () => normalizeCompanionStatus(status),
    [status],
  );
  const normalizedInteractionStats = useMemo(
    () => normalizeCompanionInteractionStats(interactionStats),
    [interactionStats],
  );
  const resetBlank = normalized.resetBlank === true;
  const interactionTotal = useMemo(
    () =>
      Object.values(normalizedInteractionStats.counts).reduce(
        (total, count) => total + Number(count || 0),
        0,
      ),
    [normalizedInteractionStats],
  );
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(readStatusMinimized);
  const [liquidPulse, setLiquidPulse] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const lastCloseRequestRef = useRef(closeRequest);
  const remainingSeconds = remainingAt(normalized.countdown, clockNow);
  const rawCountdownEnd = Date.parse(status?.countdown?.endsAt);
  const countdownExpiredWhileAway =
    status?.countdown?.isRunning === true &&
    Number.isFinite(rawCountdownEnd) &&
    rawCountdownEnd <= clockNow;
  const pulseDuration = `${clamp(60 / normalized.pulseBpm, 0.35, 1.7)}s`;
  const interactionMeter = clamp(
    Math.round(Math.log2(interactionTotal + 1) * 16),
    0,
    100,
  );
  const pulseMeter = clamp(
    Math.round(((normalized.pulseBpm - 30) / 190) * 100),
    0,
    100,
  );
  const interactionDisplay =
    interactionTotal > 999 ? "999+" : String(interactionTotal);
  const thresholdClass =
    resetBlank
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

  const openPanel = useCallback(() => {
    panelRef.current?.scrollTo({ top: 0 });
    setExpanded(true);
    onExpandedChange?.(true);
  }, [onExpandedChange]);

  const minimizePanel = useCallback(() => {
    panelRef.current?.scrollTo({ top: 0 });
    setExpanded(false);
    setMinimized(true);
    storeStatusMinimized(true);
    onExpandedChange?.(false);
  }, [onExpandedChange]);

  const restorePanel = useCallback(() => {
    setMinimized(false);
    storeStatusMinimized(false);
  }, []);

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
    if (active) return undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      closePanel();
    });
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
      if (!rootRef.current?.contains(event.target)) {
        closePanel();
      }
    }

    function closeFromEscape(event) {
      if (event.key === "Escape") {
        closePanel();
      }
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
      const streakIntensity = Math.min(
        8,
        Math.max(0, reaction.streakCount - 1),
      );
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

      return {
        ...current,
        mood: reaction.mood,
        focus: reaction.focus,
        note: reaction.text,
        microState: reaction.microState,
        energyLevel: clamp(
          zone.recoveryAction === true
            ? Math.max(
                current.energyLevel + zone.minimumEnergyGain,
                Math.round(current.energyLevel * 0.68 + energyTarget * 0.32),
              )
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
            : [
                zone.id,
                ...current.hotZones.filter((id) => id !== zone.id),
              ].slice(0, HOT_ZONES.length),
        recentRecords: addStatusRecord(current, reaction.record),
      };
    });
  }

  function runQuickAction(actionId) {
    const zone = RECOVERY_ACTIONS.find((item) => item.id === actionId);
    if (!zone) return;
    setLiquidPulse(actionId);
    touchZone(zone);
    window.setTimeout(() => setLiquidPulse(""), 640);
  }

  function runDesireAction(action) {
    const baseZone = RECOVERY_ACTIONS.find((item) => item.id === "wish");
    if (!baseZone) return;
    touchZone({
      ...baseZone,
      mood: action.mood,
      focus: action.focus,
      microState: action.microState,
      reactions: [action.reaction],
      repeatedReactions: [action.reaction],
    });
  }

  function chooseDuration(event) {
    const totalSeconds = clamp(
      Number(event.target.value),
      60,
      24 * 60 * 60,
    );
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

      const nextRemaining =
        remaining > 0 ? remaining : current.countdown.totalSeconds;
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
          endsAt: new Date(
            Date.now() + nextRemaining * 1000,
          ).toISOString(),
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

  if (minimized) {
    return (
      <section
        ref={rootRef}
        className={`companion-status minimized${thresholdClass}`}
        style={{ "--status-pulse-duration": pulseDuration }}
        aria-label={`${displayName}的动态状态已缩到侧边`}
      >
        <button
          type="button"
          className="status-restore-button"
          onClick={restorePanel}
          aria-label={`展开${displayName}的动态状态`}
          title="展开动态状态"
        >
          <span className="status-restore-mark" aria-hidden="true">D</span>
          <span className="status-restore-signal" aria-hidden="true" />
          <span className="status-restore-chevron" aria-hidden="true">›</span>
        </button>
      </section>
    );
  }

  return (
    <section
      ref={rootRef}
      className={`companion-status${expanded ? " expanded" : ""}${thresholdClass}`}
      style={{ "--status-pulse-duration": pulseDuration }}
      aria-label={`${displayName}的动态状态`}
    >
      <svg
        className="status-pulse-bg"
        viewBox="0 0 680 140"
        aria-hidden="true"
      >
        <path
          className="status-pulse-line"
          pathLength="1"
          d="M0 78H74l16-10 18 22 22-56 28 78 24-34 22 10H302l15-9 18 20 23-52 28 72 25-31 24 9H520l14-8 17 18 20-45 25 63 22-27 18 8H680"
        />
      </svg>
      <span className="status-pulse-runner" aria-hidden="true" />

      <button
        type="button"
        className="status-minimize-button"
        onClick={minimizePanel}
        aria-label="把动态状态缩到侧边"
        title="缩到侧边"
      >
        ‹
      </button>

      <button
        type="button"
        className="sun-glass-status-ribbon sun-glass-panel"
        aria-expanded={expanded}
        onClick={() => (expanded ? closePanel() : openPanel())}
      >
        <span className="sun-glass-status-ribbon-icon" aria-hidden="true">
          <Sparkles />
        </span>
        <span>
          <small>{resetBlank ? "在这里" : normalized.mood}</small>
          <strong>
            {resetBlank ? "等你写下新的此刻。" : personalized(normalized.note)}
          </strong>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>

      <section className="sun-glass-liquid-action-stage" aria-label="快捷互动">
        <span className="sun-glass-liquid-color-flow" aria-hidden="true" />
        <div className="sun-glass-liquid-action-module">
          {QUICK_ACTIONS.map(({ id, label, Icon }) => (
            <button
              type="button"
              key={id}
              className={liquidPulse === id ? "is-pulsing" : ""}
              aria-label={label}
              title={label}
              onClick={() => runQuickAction(id)}
            >
              <Icon aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="status-summary"
        aria-expanded={expanded}
        onClick={() => (expanded ? closePanel() : openPanel())}
      >
        <span className="status-presence" aria-hidden="true">
          <span>D</span>
        </span>
        <span className="status-summary-copy">
          <span className="status-name-line">
            <strong>{displayName}</strong>
            <span className="status-mood">
              {resetBlank ? "未设定" : normalized.mood}
            </span>
          </span>
          <span className="status-glance">
            {resetBlank ? (
              <span>状态内容已清空</span>
            ) : (
              <>
                <span>⌖ {normalized.place}</span>
                <span>·</span>
                <span>{personalized(normalized.focus)}</span>
              </>
            )}
          </span>
          <span className="status-reaction-preview">
            {resetBlank ? "等待新的设定" : personalized(normalized.note)}
          </span>
        </span>
        {!resetBlank && (
          <span className="status-mini-vitals" aria-label="角色氛围数值">
            <span>{normalized.energyLevel}%</span>
            <span>{normalized.pulseBpm} BPM</span>
            {normalized.countdown.isRunning && (
              <span>{formatCountdown(remainingSeconds)}</span>
            )}
          </span>
        )}
        <span className="status-chevron" aria-hidden="true">
          {expanded ? "⌃" : "⌄"}
        </span>
      </button>

      {expanded && (
        <div ref={panelRef} className="status-panel">
          <section className="sun-glass-status-popover-core">
            <header>
              <div>
                <small>{displayName}此刻</small>
                <h2>{resetBlank ? "在这里" : normalized.mood}</h2>
              </div>
              <section
                className="sun-glass-popover-liquid-actions"
                aria-label="弹窗快捷互动"
              >
                <span
                  className="sun-glass-popover-color-flow"
                  aria-hidden="true"
                />
                <div className="sun-glass-popover-liquid-module">
                  {QUICK_ACTIONS.map(({ id, label, Icon }) => (
                    <button
                      type="button"
                      key={id}
                      className={liquidPulse === id ? "is-pulsing" : ""}
                      aria-label={label}
                      title={label}
                      onClick={() => runQuickAction(id)}
                    >
                      <Icon aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
              <button
                type="button"
                className="sun-glass-popover-close"
                aria-label="关闭动态状态"
                onClick={closePanel}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <p>
              {resetBlank ? "等你写下新的此刻。" : personalized(normalized.note)}
            </p>
            <div className="sun-glass-energy-row">
              <span>
                <BatteryMedium aria-hidden="true" />
                能量
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
                  ? `想和你待在一起`
                  : personalized(normalized.focus)}
              </span>
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

          <div className="status-advanced-content">
          <section className="status-signal-hero">
            <div className="status-signal-kicker">
              <span className="status-live-indicator" aria-hidden="true" />
              <span>LIVE COMPANION SIGNAL</span>
              <time>{formatUpdatedAt(normalized.updatedAt, clockNow)}</time>
            </div>
            <div className="status-signal-title">
              <div>
                <span className="status-eyebrow">此刻心绪</span>
                <h2>{personalized(normalized.microState)}</h2>
              </div>
              <span className="status-signal-state">{normalized.mood}</span>
            </div>
            <p>{personalized(normalized.note)}</p>
            <dl className="status-facts">
              <div>
                <dt>所在</dt>
                <dd>{normalized.place}</dd>
              </div>
              <div>
                <dt>在意</dt>
                <dd>{personalized(normalized.focus)}</dd>
              </div>
              <div>
                <dt>同步</dt>
                <dd>{isResponding ? "正在回应" : "陪伴在线"}</dd>
              </div>
            </dl>
          </section>

          <section className="status-vitals-grid" aria-label="实时氛围数值">
            <article className="status-vital-tile energy">
              <div className="status-vital-heading">
                <span>能量</span>
                <small>{normalized.mood}</small>
              </div>
              <strong>{normalized.energyLevel}%</strong>
              <div className="status-vital-track" aria-hidden="true">
                <span style={{ width: `${normalized.energyLevel}%` }} />
              </div>
            </article>
            <article className="status-vital-tile resonance">
              <div className="status-vital-heading">
                <span>互动共鸣</span>
                <small>累计触碰</small>
              </div>
              <strong>{interactionDisplay}<em>次</em></strong>
              <div className="status-vital-track" aria-hidden="true">
                <span style={{ width: `${interactionMeter}%` }} />
              </div>
            </article>
            <article className="status-vital-tile pulse">
              <div className="status-vital-heading">
                <span>心动节拍</span>
                <small>虚拟氛围</small>
              </div>
              <strong>{normalized.pulseBpm}<em>BPM</em></strong>
              <div className="status-vital-track" aria-hidden="true">
                <span style={{ width: `${pulseMeter}%` }} />
              </div>
            </article>
          </section>
          <small className="status-disclaimer">
            以上是 AI 角色的界面氛围值，不是手机传感器或健康数据。
          </small>

          <section className="status-card status-interaction-card">
            <div className="status-card-heading compact">
              <div>
                <span className="status-eyebrow">互动热区</span>
                <h3>
                  {isResponding
                    ? `${displayName}正在回应你的靠近…`
                    : "轻轻碰一下，会在聊天里回应你"}
                </h3>
              </div>
            </div>
            <div className="hot-zone-grid">
              {HOT_ZONES.map((zone) => (
                <button
                  type="button"
                  key={zone.id}
                  data-interaction-zone={zone.id}
                  className={
                    normalized.hotZones.includes(zone.id) ? "active" : ""
                  }
                  aria-pressed={normalized.hotZones.includes(zone.id)}
                  onClick={() => touchZone(zone)}
                >
                  <span className="hot-zone-icon" aria-hidden="true">
                    {zone.icon}
                  </span>
                  <span className="hot-zone-copy">
                    <strong>{zone.label}</strong>
                    <small>
                      {normalizedInteractionStats.counts[zone.id] > 0
                        ? `累计 ${normalizedInteractionStats.counts[zone.id]} 次`
                        : "等待第一次"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="status-card status-recovery-card">
            <div className="status-card-heading compact">
              <div>
                <span className="status-eyebrow">陪她恢复</span>
                <h3>
                  {normalized.energyLevel <= 25
                    ? `${displayName}现在很累，陪她慢慢充回力气`
                    : `问问${displayName}此刻真正需要什么`}
                </h3>
              </div>
            </div>
            <div className="recovery-action-grid">
              {RECOVERY_ACTIONS.map((action) => (
                <button
                  type="button"
                  key={action.id}
                  data-recovery-action={action.id}
                  onClick={() => touchZone(action)}
                >
                  <span className="hot-zone-icon" aria-hidden="true">
                    {action.icon}
                  </span>
                  <span className="hot-zone-copy">
                    <strong>{action.label}</strong>
                    <small>立即恢复至少 {action.minimumEnergyGain}%</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="status-panel-grid lower-grid">
            <section className="status-card countdown-card">
              <div className="status-card-heading compact">
                <div>
                  <span className="status-eyebrow">
                    {normalized.countdown.label}
                  </span>
                  <h3>{formatCountdown(remainingSeconds)}</h3>
                </div>
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
              </div>
              <div className="countdown-progress" aria-hidden="true">
                <span
                  style={{
                    width: `${clamp(
                      (remainingSeconds / normalized.countdown.totalSeconds) *
                        100,
                      0,
                      100,
                    )}%`,
                  }}
                />
              </div>
              <div className="countdown-actions">
                <button type="button" onClick={toggleCountdown}>
                  {normalized.countdown.isRunning ? "暂停" : "开始"}
                </button>
                <button type="button" onClick={resetCountdown}>
                  重置
                </button>
              </div>
            </section>

            <section className="status-card status-record-card">
              <div className="status-card-heading compact">
                <div>
                  <span className="status-eyebrow">最近记录</span>
                  <h3>刚刚发生了什么</h3>
                </div>
              </div>
              {normalized.recentRecords.length > 0 ? (
                <ul>
                  {normalized.recentRecords.map((record, index) => (
                    <li key={`${record.createdAt}-${index}`}>
                      <time>
                        {formatUpdatedAt(record.createdAt, clockNow)}
                      </time>
                      <span>{personalized(record.text)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="status-record-empty">
                  还没有记录，试着碰一碰上面的热区。
                </p>
              )}
            </section>
          </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default memo(CompanionStatus);
