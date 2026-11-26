import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  BellRing,
  Clock,
  MoonStar,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import {
  COMMON_TIMEZONES,
  DEFAULT_CHRONOS_POLICY,
  buildPreviewChronosState,
  createChronosSchedule,
  deleteChronosSchedule,
  detectBrowserTimeZone,
  formatCountdown,
  formatLocalClock,
  getChronosState,
  kindLabelZh,
  syncNativeLocalWakeNotifications,
  triggerChronosHeartbeat,
  updateChronosPolicy,
  updateChronosSchedule,
} from "./chronos-client.js";
import "./chronos-wake-center.css";

export default function ChronosWakeCenter({
  aiName = "小小灯",
  preferredTimezone = "Asia/Shanghai",
  visualPreview = false,
  onTimezoneSynced,
  onWakeMessagesFired,
}) {
  const [state, setState] = useState(() =>
    visualPreview ? buildPreviewChronosState(preferredTimezone) : null,
  );
  const [policyDraft, setPolicyDraft] = useState(() =>
    visualPreview
      ? buildPreviewChronosState(preferredTimezone).policy
      : { ...DEFAULT_CHRONOS_POLICY, timezone: preferredTimezone || "Asia/Shanghai" },
  );
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(!visualPreview);
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState(null);

  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState("one_shot");
  const [newDelayMin, setNewDelayMin] = useState("30");
  const [newTimeHhmm, setNewTimeHhmm] = useState("08:00");
  const [newPromptHint, setNewPromptHint] = useState("");
  const [newBypassQuiet, setNewBypassQuiet] = useState(true);

  const applyServerState = useCallback(
    (next) => {
      if (!next) return;
      setState(next);
      if (next.policy) setPolicyDraft(next.policy);
      if (next.server_now) {
        const parsed = Date.parse(next.server_now);
        if (Number.isFinite(parsed)) setServerOffsetMs(parsed - Date.now());
      }
      if (Array.isArray(next.schedules)) {
        void syncNativeLocalWakeNotifications(next.schedules, { aiName });
      }
    },
    [aiName],
  );

  const refreshState = useCallback(async () => {
    if (visualPreview) {
      applyServerState(buildPreviewChronosState(policyDraft.timezone || preferredTimezone));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getChronosState();
      applyServerState(data);
    } catch (error) {
      setFeedback({
        type: "error",
        text: error?.message || "暂时无法读取严格时间与唤醒状态。",
      });
    } finally {
      setLoading(false);
    }
  }, [applyServerState, policyDraft.timezone, preferredTimezone, visualPreview]);

  useEffect(() => {
    if (visualPreview) return undefined;
    let cancelled = false;
    getChronosState()
      .then((data) => {
        if (!cancelled) applyServerState(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setFeedback({
            type: "error",
            text: error?.message || "暂时无法读取严格时间与唤醒状态。",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyServerState, visualPreview]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const authoritativeNowMs = nowMs + serverOffsetMs;
  const activeTimezone = policyDraft.timezone || state?.policy?.timezone || preferredTimezone || "Asia/Shanghai";
  const liveClock = useMemo(
    () => formatLocalClock(new Date(authoritativeNowMs), activeTimezone),
    [authoritativeNowMs, activeTimezone],
  );
  const clockSkewSec = Math.round(Math.abs(serverOffsetMs) / 1000);

  const nextSchedule = useMemo(() => {
    const list = Array.isArray(state?.schedules) ? state.schedules : [];
    const active = list
      .filter((s) => s.enabled && s.next_fire_at && Number.isFinite(Date.parse(s.next_fire_at)))
      .sort((a, b) => Date.parse(a.next_fire_at) - Date.parse(b.next_fire_at));
    return active[0] || null;
  }, [state]);

  const nextCountdownMs = nextSchedule
    ? Math.max(0, Date.parse(nextSchedule.next_fire_at) - authoritativeNowMs)
    : null;

  async function handleSavePolicy(patchOverride = null) {
    const payload = patchOverride ? { ...policyDraft, ...patchOverride } : { ...policyDraft };
    setPolicyDraft(payload);
    setBusyAction("policy");
    setFeedback(null);
    try {
      if (visualPreview) {
        setState((prev) => ({ ...(prev || buildPreviewChronosState(payload.timezone)), policy: payload }));
        setFeedback({ type: "ok", text: "已在预览模式更新严格时间与免打扰策略。" });
        return;
      }
      const next = await updateChronosPolicy({ ...payload, sync_push_enabled: false });
      applyServerState(next);
      if (payload.timezone && typeof onTimezoneSynced === "function") {
        onTimezoneSynced(payload.timezone);
      }
      setFeedback({ type: "ok", text: "严格时间、静默免打扰与自动唤醒策略已保存生效。" });
    } catch (error) {
      setFeedback({ type: "error", text: error?.message || "保存唤醒策略失败。" });
    } finally {
      setBusyAction("");
    }
  }

  async function handleQuickSchedule(preset) {
    setBusyAction("create");
    setFeedback(null);
    try {
      if (visualPreview) {
        const fireMs = preset.delay_minutes
          ? Date.now() + preset.delay_minutes * 60_000
          : Date.now() + 8 * 3600_000;
        const created = {
          id: `preview-${Date.now()}`,
          title: preset.title,
          kind: preset.kind || "one_shot",
          time_hhmm: preset.time_hhmm || null,
          next_fire_at: new Date(fireMs).toISOString(),
          enabled: true,
          bypass_quiet_hours: true,
          created_by: "user",
          prompt_hint: preset.prompt_hint || preset.title,
        };
        setState((prev) => ({
          ...(prev || buildPreviewChronosState(activeTimezone)),
          schedules: [...(prev?.schedules || []), created],
        }));
        setFeedback({ type: "ok", text: `已创建快捷唤醒「${preset.title}」。` });
        return;
      }
      const res = await createChronosSchedule(preset);
      if (res?.state) applyServerState(res.state);
      setFeedback({
        type: "ok",
        text: `已设定「${res.schedule?.title || preset.title}」→ ${res.next_fire_local || "准点触发"}。`,
      });
    } catch (error) {
      setFeedback({ type: "error", text: error?.message || "创建定时唤醒失败。" });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCustomCreate(event) {
    event.preventDefault();
    const title = newTitle.trim() || "定时唤醒";
    const payload = {
      title,
      kind: newKind,
      prompt_hint: newPromptHint.trim() || title,
      bypass_quiet_hours: newBypassQuiet,
    };
    if (newKind === "one_shot") {
      const mins = Number(newDelayMin);
      if (Number.isFinite(mins) && mins > 0) payload.delay_minutes = mins;
      else payload.time_hhmm = newTimeHhmm;
    } else {
      payload.time_hhmm = newTimeHhmm;
    }
    await handleQuickSchedule(payload);
    setNewTitle("");
    setNewPromptHint("");
  }

  async function handleToggleSchedule(item) {
    setBusyAction(`toggle:${item.id}`);
    try {
      if (visualPreview) {
        setState((prev) => ({
          ...prev,
          schedules: (prev?.schedules || []).map((s) =>
            s.id === item.id ? { ...s, enabled: !s.enabled } : s,
          ),
        }));
        return;
      }
      const res = await updateChronosSchedule(item.id, { enabled: !item.enabled });
      if (res?.state) applyServerState(res.state);
    } catch (error) {
      setFeedback({ type: "error", text: error?.message || "切换开关失败。" });
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteSchedule(item) {
    setBusyAction(`del:${item.id}`);
    try {
      if (visualPreview) {
        setState((prev) => ({
          ...prev,
          schedules: (prev?.schedules || []).filter((s) => s.id !== item.id),
        }));
        return;
      }
      const res = await deleteChronosSchedule(item.id);
      if (res?.state) applyServerState(res.state);
      setFeedback({ type: "ok", text: `已删除定时唤醒「${item.title}」。` });
    } catch (error) {
      setFeedback({ type: "error", text: error?.message || "删除唤醒失败。" });
    } finally {
      setBusyAction("");
    }
  }

  async function handleRunHeartbeatNow() {
    setBusyAction("heartbeat");
    setFeedback(null);
    try {
      if (visualPreview) {
        setFeedback({ type: "ok", text: "心跳校准完成（预览模式）：所有待命唤醒均按严格时间待触发。" });
        return;
      }
      const res = await triggerChronosHeartbeat();
      await refreshState();
      if (res?.fired_count > 0 && typeof onWakeMessagesFired === "function") {
        onWakeMessagesFired(res.fired_messages || []);
      }
      setFeedback({
        type: "ok",
        text:
          res?.fired_count > 0
            ? `唤醒心跳已触发 ${res.fired_count} 条到点消息并送达聊天。`
            : `唤醒心跳已完成校准（服务器时间 ${res?.clock?.currentTimeSeconds || liveClock.hhmmss}，当前无到期条目）。`,
      });
    } catch (error) {
      setFeedback({ type: "error", text: error?.message || "执行唤醒心跳失败。" });
    } finally {
      setBusyAction("");
    }
  }

  function handleSyncBrowserTimezone() {
    const detected = detectBrowserTimeZone();
    void handleSavePolicy({ timezone: detected });
  }

  const inQuiet = Boolean(state?.summary?.in_quiet_hours);
  const quietLabel = state?.summary?.quiet_window_label || `工作日 ${policyDraft.weekday_quiet_start}–${policyDraft.weekday_quiet_end}`;
  const schedules = Array.isArray(state?.schedules) ? state.schedules : [];
  const recentRuns = Array.isArray(state?.recent_runs) ? state.recent_runs : [];

  return (
    <section className="ch-panel" aria-label="Chronos 严格时间与自动唤醒控制中心">
      <div className="ch-header">
        <div>
          <div className="ch-title-row">
            <AlarmClock size={18} />
            <h4>Chronos 严格时间与自动唤醒</h4>
          </div>
          <p className="ch-subtitle">
            单一权威时钟 · 对话跨天/间隔真实感知 · 免打扰静默窗口 · 聊天内直接说「15分钟后提醒我 / 明早7点半叫我起床」自动创建真实闹钟。
          </p>
        </div>
        <div className="ch-header-actions">
          <button
            type="button"
            className="ch-pill-btn"
            onClick={handleSyncBrowserTimezone}
            disabled={busyAction === "policy"}
          >
            <Clock size={14} />
            同步本机时区
          </button>
          <button
            type="button"
            className="ch-pill-btn ch-pill-btn--primary"
            onClick={handleRunHeartbeatNow}
            disabled={busyAction === "heartbeat"}
          >
            <Play size={14} />
            {busyAction === "heartbeat" ? "校准中…" : "立即执行唤醒心跳"}
          </button>
        </div>
      </div>

      <div className="ch-hero">
        <div className="ch-clock-row">
          <div className="ch-clock-digits" data-testid="chronos-live-clock">
            {liveClock.hhmmss}
          </div>
          <div className="ch-clock-meta">
            <span className="ch-badge ch-badge--soft">
              <Sun size={12} />
              {liveClock.date} · {liveClock.weekdayName} · {liveClock.periodName}
            </span>
            <span className="ch-badge ch-badge--soft">
              {liveClock.timezone} ({liveClock.utcOffset})
            </span>
            {inQuiet ? (
              <span className="ch-badge ch-badge--quiet">
                <MoonStar size={12} />
                静默免打扰中（{quietLabel}）
              </span>
            ) : (
              <span className="ch-badge ch-badge--ok">
                <ShieldCheck size={12} />
                活跃唤醒窗口
              </span>
            )}
            {clockSkewSec >= 90 && (
              <span className="ch-badge ch-badge--warn">
                设备时间偏差约 {clockSkewSec} 秒（已自动对齐服务器）
              </span>
            )}
          </div>
        </div>

        <div className="ch-next-bar">
          <span>
            <BellRing size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {nextSchedule
              ? `下一次精确唤醒：${nextSchedule.title}（${formatLocalClock(new Date(nextSchedule.next_fire_at), activeTimezone).hhmm}）`
              : "当前暂无排期的精确唤醒；可在下方一键创建，或在聊天里直接告诉伴侣。"}
          </span>
          {nextCountdownMs !== null && (
            <strong>倒计时 {formatCountdown(nextCountdownMs)}</strong>
          )}
        </div>

        <div className="ch-quick-row">
          <button
            type="button"
            className="ch-pill-btn"
            disabled={busyAction === "create"}
            onClick={() =>
              handleQuickSchedule({
                title: "15分钟小提醒",
                kind: "one_shot",
                delay_minutes: 15,
                prompt_hint: "15分钟到了，轻声提醒用户喝水或休息一下",
              })
            }
          >
            <Plus size={13} /> +15分钟提醒
          </button>
          <button
            type="button"
            className="ch-pill-btn"
            disabled={busyAction === "create"}
            onClick={() =>
              handleQuickSchedule({
                title: "30分钟专注回响",
                kind: "one_shot",
                delay_minutes: 30,
                prompt_hint: "半小时到了，温柔检查用户进度",
              })
            }
          >
            <Plus size={13} /> +30分钟提醒
          </button>
          <button
            type="button"
            className="ch-pill-btn"
            disabled={busyAction === "create"}
            onClick={() =>
              handleQuickSchedule({
                title: "1小时关怀唤醒",
                kind: "one_shot",
                delay_minutes: 60,
                prompt_hint: "一小时到了，提醒用户起身活动一下",
              })
            }
          >
            <Plus size={13} /> +1小时提醒
          </button>
          <button
            type="button"
            className="ch-pill-btn"
            disabled={busyAction === "create"}
            onClick={() =>
              handleQuickSchedule({
                title: "明早 07:30 叫醒",
                kind: "one_shot",
                time_hhmm: "07:30",
                prompt_hint: "按个性化指令的叫醒风格准点叫醒用户",
                bypass_quiet_hours: true,
              })
            }
          >
            <Sparkles size={13} /> 明早 07:30 叫醒
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`ch-feedback ${feedback.type === "error" ? "ch-feedback--error" : ""}`} role="status">
          {feedback.text}
        </div>
      )}

      <form className="ch-section" onSubmit={handleCustomCreate}>
        <div className="ch-section-title">
          <span>新建精确自动唤醒</span>
          <button type="submit" className="ch-pill-btn ch-pill-btn--primary" disabled={busyAction === "create"}>
            <Plus size={14} /> 添加唤醒
          </button>
        </div>
        <div className="ch-form-grid">
          <label className="ch-field">
            唤醒主题
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="例如：喝水提醒 / 早起叫醒 / 开会提醒"
              maxLength={60}
            />
          </label>
          <label className="ch-field">
            触发周期
            <select value={newKind} onChange={(e) => setNewKind(e.target.value)}>
              <option value="one_shot">一次性倒计时 / 指定时刻</option>
              <option value="daily">每天固定时刻</option>
              <option value="weekdays">仅工作日（周一至周五）</option>
              <option value="weekends">仅周末（周六、周日）</option>
            </select>
          </label>
          {newKind === "one_shot" ? (
            <label className="ch-field">
              多少分钟后触发（留空则按右侧时刻）
              <input
                type="number"
                min="1"
                max="10080"
                value={newDelayMin}
                onChange={(e) => setNewDelayMin(e.target.value)}
                placeholder="30"
              />
            </label>
          ) : null}
          <label className="ch-field">
            当地 24h 时刻
            <input
              type="time"
              value={newTimeHhmm}
              onChange={(e) => setNewTimeHhmm(e.target.value)}
            />
          </label>
        </div>
        <label className="ch-field">
          到点说话提示（可选）
          <input
            type="text"
            value={newPromptHint}
            onChange={(e) => setNewPromptHint(e.target.value)}
            placeholder="例如：用温柔一点的语气催我早点睡"
            maxLength={200}
          />
        </label>
        <label className="ch-check">
          <input
            type="checkbox"
            checked={newBypassQuiet}
            onChange={(e) => setNewBypassQuiet(e.target.checked)}
          />
          <span>显式闹钟允许穿透夜间静默免打扰时段（准点必达）</span>
        </label>
      </form>

      <div className="ch-section">
        <div className="ch-section-title">
          <span>定时唤醒清单（{schedules.length}）</span>
          <button type="button" className="ch-icon-btn" onClick={refreshState} disabled={loading}>
            <RefreshCw size={13} /> 刷新
          </button>
        </div>
        {schedules.length === 0 ? (
          <div className="ch-empty">还没有定时唤醒。点击上方快捷按钮，或在聊天中直接说「20分钟后叫我」。</div>
        ) : (
          <div className="ch-schedule-list">
            {schedules.map((item) => {
              const nextLocal = item.next_fire_at
                ? formatLocalClock(new Date(item.next_fire_at), activeTimezone)
                : null;
              const delta = item.next_fire_at ? Date.parse(item.next_fire_at) - authoritativeNowMs : null;
              return (
                <div className="ch-schedule-item" key={item.id}>
                  <div className="ch-schedule-main">
                    <div className="ch-schedule-name">
                      <span>{item.title}</span>
                      <span className="ch-badge ch-badge--soft">{kindLabelZh(item.kind)}</span>
                      {item.created_by === "ai_tool" && (
                        <span className="ch-badge ch-badge--ok">聊天创建</span>
                      )}
                      {item.created_by === "ritual" && (
                        <span className="ch-badge ch-badge--quiet">早晚仪式</span>
                      )}
                    </div>
                    <div className="ch-schedule-sub">
                      {item.enabled && nextLocal
                        ? `下次触发：${nextLocal.date} ${nextLocal.hhmm}（${formatCountdown(delta)}后）`
                        : item.last_status === "fired"
                          ? "已完成触发"
                          : "已暂停"}
                      {item.prompt_hint && item.prompt_hint !== item.title ? ` · ${item.prompt_hint}` : ""}
                    </div>
                  </div>
                  <div className="ch-schedule-actions">
                    <button
                      type="button"
                      className="ch-icon-btn"
                      onClick={() => handleToggleSchedule(item)}
                      disabled={busyAction === `toggle:${item.id}`}
                    >
                      {item.enabled ? "暂停" : "启用"}
                    </button>
                    {item.created_by !== "ritual" && (
                      <button
                        type="button"
                        className="ch-icon-btn ch-icon-btn--danger"
                        onClick={() => handleDeleteSchedule(item)}
                        disabled={busyAction === `del:${item.id}`}
                        aria-label={`删除 ${item.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="ch-section">
        <div className="ch-section-title">
          <span>严格时间边界、免打扰与早晚仪式</span>
          <button
            type="button"
            className="ch-pill-btn ch-pill-btn--primary"
            onClick={() => handleSavePolicy()}
            disabled={busyAction === "policy"}
          >
            {busyAction === "policy" ? "保存中…" : "保存策略"}
          </button>
        </div>

        <div className="ch-form-grid">
          <label className="ch-field">
            权威时区（IANA）
            <select
              value={
                COMMON_TIMEZONES.some((tz) => tz.value === policyDraft.timezone)
                  ? policyDraft.timezone
                  : "Asia/Shanghai"
              }
              onChange={(e) => setPolicyDraft((p) => ({ ...p, timezone: e.target.value }))}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ch-field">
            工作日静默开始
            <input
              type="time"
              value={policyDraft.weekday_quiet_start}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, weekday_quiet_start: e.target.value }))}
            />
          </label>
          <label className="ch-field">
            工作日静默结束
            <input
              type="time"
              value={policyDraft.weekday_quiet_end}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, weekday_quiet_end: e.target.value }))}
            />
          </label>
          <label className="ch-field">
            周末静默开始
            <input
              type="time"
              value={policyDraft.weekend_quiet_start}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, weekend_quiet_start: e.target.value }))}
            />
          </label>
          <label className="ch-field">
            周末静默结束
            <input
              type="time"
              value={policyDraft.weekend_quiet_end}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, weekend_quiet_end: e.target.value }))}
            />
          </label>
          <label className="ch-field">
            沉默超时自动轻唤（小时）
            <input
              type="number"
              min="1"
              max="72"
              value={policyDraft.silence_wake_hours}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, silence_wake_hours: Number(e.target.value) || 6 }))}
            />
          </label>
          <label className="ch-field">
            最小冷却间隔（分钟）
            <input
              type="number"
              min="10"
              max="720"
              value={policyDraft.min_cooldown_minutes}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, min_cooldown_minutes: Number(e.target.value) || 60 }))}
            />
          </label>
          <label className="ch-field">
            早安仪式时间
            <input
              type="time"
              value={policyDraft.morning_ritual_time}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, morning_ritual_time: e.target.value }))}
            />
          </label>
          <label className="ch-field">
            晚安仪式时间
            <input
              type="time"
              value={policyDraft.evening_ritual_time}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, evening_ritual_time: e.target.value }))}
            />
          </label>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label className="ch-check">
            <input
              type="checkbox"
              checked={policyDraft.enabled !== false}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, enabled: e.target.checked }))}
            />
            <span>启用 Chronos 自动唤醒总开关</span>
          </label>
          <label className="ch-check">
            <input
              type="checkbox"
              checked={policyDraft.quiet_hours_enabled !== false}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, quiet_hours_enabled: e.target.checked }))}
            />
            <span>启用夜间静默免打扰（静默期内彻底暂停自主主动消息，不浪费模型调用）</span>
          </label>
          <label className="ch-check">
            <input
              type="checkbox"
              checked={policyDraft.silence_wake_enabled !== false}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, silence_wake_enabled: e.target.checked }))}
            />
            <span>活跃时段长时间未聊天自动轻唤（严格遵守冷却间隔与免打扰窗口）</span>
          </label>
          <label className="ch-check">
            <input
              type="checkbox"
              checked={policyDraft.morning_ritual_enabled === true}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, morning_ritual_enabled: e.target.checked }))}
            />
            <span>开启每日早安叫醒仪式（按「个性化指令」里的叫醒风格准点问候）</span>
          </label>
          <label className="ch-check">
            <input
              type="checkbox"
              checked={policyDraft.evening_ritual_enabled === true}
              onChange={(e) => setPolicyDraft((p) => ({ ...p, evening_ritual_enabled: e.target.checked }))}
            />
            <span>开启每日晚安收尾问候</span>
          </label>
        </div>
      </div>

      {recentRuns.length > 0 && (
        <div className="ch-section">
          <div className="ch-section-title">
            <span>最近唤醒执行审计（防重幂等记录）</span>
          </div>
          <div className="ch-log-list">
            {recentRuns.slice(0, 5).map((run, idx) => {
              const t = formatLocalClock(new Date(run.at), activeTimezone);
              return (
                <div className="ch-log-item" key={`${run.at}-${idx}`}>
                  <span>
                    <strong>{run.title || run.kind}</strong>
                    {run.message_preview ? `：${run.message_preview}` : run.reason ? `（${run.reason}）` : ""}
                  </span>
                  <span className="ch-log-time">{t.date} {t.hhmm}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
