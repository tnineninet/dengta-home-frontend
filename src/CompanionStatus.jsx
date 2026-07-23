import { useEffect, useMemo, useRef, useState } from "react";
import {
  HOT_ZONES,
  addStatusRecord,
  clamp,
  companionStatusForRequest,
  formatCountdown,
  formatUpdatedAt,
  localCompanionInteractionReaction,
  normalizeCompanionStatus,
  normalizeCompanionInteractionStats,
  remainingAt,
  settleExpiredCountdown,
} from "./companion-status";

export default function CompanionStatus({
  aiName,
  status,
  interactionStats,
  isResponding = false,
  onChange,
  onInteract,
}) {
  const displayName = String(aiName || "").trim() || "小灯";
  const presenceInitial = Array.from(displayName)[0] || "灯";
  const normalized = useMemo(
    () => normalizeCompanionStatus(status),
    [status],
  );
  const normalizedInteractionStats = useMemo(
    () => normalizeCompanionInteractionStats(interactionStats),
    [interactionStats],
  );
  const [expanded, setExpanded] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const remainingSeconds = remainingAt(normalized.countdown, clockNow);
  const rawCountdownEnd = Date.parse(status?.countdown?.endsAt);
  const countdownExpiredWhileAway =
    status?.countdown?.isRunning === true &&
    Number.isFinite(rawCountdownEnd) &&
    rawCountdownEnd <= clockNow;
  const pulseDuration = `${clamp(60 / normalized.pulseBpm, 0.35, 1.7)}s`;
  const thresholdClass =
    normalized.energyLevel >= 85
      ? " high-energy"
      : normalized.energyLevel <= 25
        ? " low-energy"
        : "";

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
    if (!expanded) return undefined;

    panelRef.current?.scrollTo({ top: 0 });

    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setExpanded(false);
      }
    }

    function closeFromEscape(event) {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [expanded]);

  function updateStatus(transform) {
    onChange((currentValue) => {
      const current = companionStatusForRequest(currentValue);
      const transformed = transform(current);
      return normalizeCompanionStatus(
        {
          ...transformed,
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
      );
      const streakIntensity = Math.min(
        8,
        Math.max(0, reaction.streakCount - 1),
      );
      const energyTarget = clamp(
        zone.energyTarget + Math.round(streakIntensity / 2),
        0,
        100,
      );
      const pulseTarget = clamp(
        zone.pulseTarget +
          Math.sign(zone.pulseDelta) * Math.round(streakIntensity * 0.8),
        30,
        220,
      );

      return {
        ...current,
        mood: zone.mood,
        focus: zone.focus,
        note: reaction.text,
        microState: zone.microState,
        energyLevel: clamp(
          Math.round(current.energyLevel * 0.68 + energyTarget * 0.32),
          0,
          100,
        ),
        pulseBpm: clamp(
          Math.round(current.pulseBpm * 0.62 + pulseTarget * 0.38),
          30,
          220,
        ),
        hotZones: [
          zone.id,
          ...current.hotZones.filter((id) => id !== zone.id),
        ].slice(0, HOT_ZONES.length),
        recentRecords: addStatusRecord(current, reaction.record),
      };
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
          d="M0 72H126l20-14 24 42 25-74 29 78 25-32H680"
        />
        <path
          className="status-pulse-runner"
          pathLength="1"
          d="M0 72H126l20-14 24 42 25-74 29 78 25-32H680"
        />
      </svg>

      <button
        type="button"
        className="status-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="status-presence" aria-hidden="true">
          <span>{presenceInitial}</span>
        </span>
        <span className="status-summary-copy">
          <span className="status-name-line">
            <strong>{displayName}</strong>
            <span className="status-mood">{normalized.mood}</span>
          </span>
          <span className="status-glance">
            <span>⌖ {normalized.place}</span>
            <span>·</span>
            <span>{normalized.focus}</span>
          </span>
        </span>
        <span className="status-mini-vitals" aria-label="角色氛围数值">
          <span>{normalized.energyLevel}%</span>
          <span>{normalized.pulseBpm} BPM</span>
          {normalized.countdown.isRunning && (
            <span>{formatCountdown(remainingSeconds)}</span>
          )}
        </span>
        <span className="status-chevron" aria-hidden="true">
          {expanded ? "⌃" : "⌄"}
        </span>
      </button>

      {expanded && (
        <div ref={panelRef} className="status-panel">
          <div className="status-panel-grid">
            <section className="status-card status-story-card">
              <div className="status-card-heading">
                <div>
                  <span className="status-eyebrow">此刻</span>
                  <h3>{normalized.microState}</h3>
                </div>
                <span>{formatUpdatedAt(normalized.updatedAt, clockNow)}</span>
              </div>
              <p>{normalized.note}</p>
              <dl className="status-facts">
                <div>
                  <dt>心情</dt>
                  <dd>{normalized.mood}</dd>
                </div>
                <div>
                  <dt>所在</dt>
                  <dd>{normalized.place}</dd>
                </div>
                <div>
                  <dt>在意</dt>
                  <dd>{normalized.focus}</dd>
                </div>
              </dl>
            </section>

            <section className="status-card status-vitals-card">
              <span className="status-eyebrow">实时氛围数值</span>
              <div className="vital-heading">
                <span>能量</span>
                <strong>{normalized.energyLevel}%</strong>
              </div>
              <div className="energy-track" aria-hidden="true">
                <span style={{ width: `${normalized.energyLevel}%` }} />
              </div>
              <div className="pulse-readout">
                <span className="pulse-heart" aria-hidden="true">
                  ♥
                </span>
                <span>
                  <small>虚拟心率</small>
                  <strong>{normalized.pulseBpm} BPM</strong>
                </span>
              </div>
              <small className="status-disclaimer">
                这是 AI 角色的界面氛围值，不是手机传感器或健康数据。
              </small>
            </section>
          </div>

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
                    <li key={`${record.createdAt}-${index}`}>{record.text}</li>
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
      )}
    </section>
  );
}
