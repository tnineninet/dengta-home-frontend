import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "./api";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { describeOperationError } from "./operation-error-help.js";
import TypewriterText from "./TypewriterText";
import SlidingIndicator from "./SlidingIndicator.jsx";

const SPEECH_ACTIONS = [
  { id: "talk", label: "说话" },
  { id: "teach", label: "教她" },
  { id: "feed", label: "喂语料" },
];

const CARE_ACTIONS = [
  { id: "soothe", label: "安抚", symbol: "♡" },
  { id: "diaper", label: "换尿布", symbol: "◇" },
  { id: "burp", label: "拍嗝", symbol: "○" },
  { id: "play", label: "玩一会", symbol: "✦" },
];

const STATE_ITEMS = [
  ["mood", "心情"],
  ["health", "健康"],
  ["nutrition", "饱足"],
  ["fatigue", "疲劳"],
  ["intimacy", "亲密"],
  ["digest_load", "消化负担"],
];

function clientActionId(kind) {
  const generated = globalThis.crypto?.randomUUID?.();
  return generated || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestFailureMessage(error) {
  const { code, reason, action } = describeOperationError(error);
  return `${reason}${action}（错误代码：${code}）`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidNurseryResponse() {
  const error = new Error("家庭状态回执不完整，请重新读取核对。");
  error.code = "nursery_response_invalid";
  return error;
}

function assertNurserySnapshot(data, { requireChild = false, childId = "" } = {}) {
  if (!requireChild && data?.available === false && data.child === null && typeof data.message === "string") return;
  const child = data?.child;
  const validChild = child === null ? data?.state === null :
    isRecord(child) && typeof child.id === "string" && child.id &&
    typeof child.display_name === "string" && (child.name === null || typeof child.name === "string") &&
    isRecord(child.stage) && typeof child.stage.label === "string" && Number.isFinite(child.stage.age_days) &&
    isRecord(data?.state) && STATE_ITEMS.every(([key]) => Number.isFinite(data.state[key]));
  const valid = isRecord(data) && data.available === true && validChild &&
    ["bonds", "actions", "utterances", "milestones", "events"].every((key) => Array.isArray(data[key])) &&
    data.bonds.every((bond) => isRecord(bond) && typeof bond.caregiver_kind === "string") &&
    data.utterances.every((item) => isRecord(item) && typeof item.text === "string") &&
    data.milestones.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.title === "string" &&
      (item.note == null || typeof item.note === "string")) &&
    (!requireChild || (child !== null && (!childId || child.id === childId)));
  if (!valid) throw invalidNurseryResponse();
}

function assertNurseryPortrait(data) {
  const portrait = data?.portrait;
  if (!isRecord(portrait) || !isRecord(portrait.language) || !Number.isFinite(portrait.milestones) ||
    !["learned_characters", "unique_characters", "utterances"].every((key) => Number.isFinite(portrait.language[key]))) {
    throw invalidNurseryResponse();
  }
}

const OVERHEAR_STORAGE_PREFIX = "dengta_nursery_overhear_enabled:";

const TRIGGER_LABELS = {
  overhear: "偷学开口",
  reflect: "自己想的",
  talk: "回你一句",
  teach: "学着念",
  feed: "吃饱哼哼",
  event: "半夜醒来",
};

function readOverhearEnabled(scopeKey) {
  try {
    const specific = globalThis.localStorage?.getItem(`${OVERHEAR_STORAGE_PREFIX}${scopeKey}`);
    if (specific === "0") return false;
    if (specific === "1") return true;
    const globalFlag = globalThis.localStorage?.getItem("dengta_nursery_overhear_enabled");
    if (globalFlag === "0") return false;
  } catch { /* 忽略本地存储读取异常 */ }
  return true;
}

function writeOverhearEnabled(scopeKey, enabled) {
  const val = enabled ? "1" : "0";
  try {
    globalThis.localStorage?.setItem(`${OVERHEAR_STORAGE_PREFIX}${scopeKey}`, val);
    globalThis.localStorage?.setItem("dengta_nursery_overhear_enabled", val);
  } catch { /* 忽略本地存储写入异常 */ }
}

function assertNurseryReceipt(data, { label, actionKind, candidates }) {
  if (label === "birth") {
    if (typeof data.created !== "boolean") throw invalidNurseryResponse();
    return;
  }
  if (label === "overhear") {
    if (!Array.isArray(data.overheard)) throw invalidNurseryResponse();
    return;
  }
  if (label === "reflect") {
    if (typeof data.reflected !== "boolean") throw invalidNurseryResponse();
    return;
  }
  if (typeof data.idempotent !== "boolean") throw invalidNurseryResponse();
  if (label === "name") {
    if (typeof data.chosen_name !== "string" || !data.chosen_name ||
      data.child.name !== data.chosen_name || !candidates.includes(data.chosen_name)) {
      throw invalidNurseryResponse();
    }
    return;
  }
  const action = data.action;
  const companion = label === "companion";
  const expectedKind = label === "speech" ? actionKind : label;
  if (!isRecord(action) || typeof action.id !== "string" || !action.id.trim() ||
    action.actor !== (companion ? "companion" : "user") ||
    (companion ? !["talk", "soothe"].includes(action.kind) : action.kind !== expectedKind) ||
    typeof action.applied_at !== "string" || !Number.isFinite(Date.parse(action.applied_at))) {
    throw invalidNurseryResponse();
  }
}

function formatTime(value) {
  if (typeof value !== "string" || !value.trim()) return "时间未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function StateMeter({ label, value, inverse = false }) {
  const amount = Math.min(100, Math.max(0, Number(value || 0)));
  return (
    <div className={`nursery-meter${inverse ? " is-inverse" : ""}`}>
      <span>
        <small>{label}</small>
        <strong>{Math.round(amount)}</strong>
      </span>
      <i aria-hidden="true">
        <b style={{ width: `${amount}%` }} />
      </i>
    </div>
  );
}

function createPreviewNurserySnapshot(aiName = "伴侣") {
  return {
    available: true,
    child: {
      id: "preview-child-1",
      name: "小灯芽",
      display_name: "小灯芽（本地预览）",
      stage: { label: "咿呀学语期", age_days: 12.5 },
    },
    state: {
      mood: 86,
      health: 94,
      nutrition: 82,
      fatigue: 22,
      intimacy: 78,
      digest_load: 18,
    },
    bonds: [
      { caregiver_kind: "user", attachment: 78, trust: 84 },
      { caregiver_kind: "companion", attachment: 82, trust: 88 },
    ],
    actions: [],
    utterances: [
      {
        id: "preview-u-1",
        trigger: "overhear",
        stage: "child",
        text: `晚霞灯灯暖暖的，你们刚聊听歌我也要听呀～`,
        generation_parameters: {
          thought: `刚才偷听你们聊起「一起听歌」，心里觉得好新奇，想插一句嘴。`,
          overheard_snippet: "待会儿日出照到窗台，一起听歌",
        },
        created_at: "2026-11-26T08:45:00+08:00",
      },
      {
        id: "preview-u-2",
        trigger: "talk",
        stage: "toddler",
        text: `抱抱…晚安灯灯`,
        created_at: "2026-11-25T21:10:00+08:00",
      },
    ],
    overheard_corpus: [
      { id: 1, speaker: "companion", text: "待会儿日出照到窗台，你得陪着我看", created_at: "2026-11-26T07:14:00+08:00" },
      { id: 2, speaker: "user", text: "再让我赖三分钟嘛", created_at: "2026-11-26T07:08:00+08:00" },
    ],
    learned_chunks: [
      { text: "灯塔", count: 5, overheard: true },
      { text: "晚安", count: 4, overheard: false },
      { text: "抱抱", count: 4, overheard: false },
      { text: "窗台", count: 2, overheard: true },
      { text: "三分钟", count: 2, overheard: true },
    ],
    language_profile: {
      current_stage_id: "child",
      current_summary: "萌芽思考期 · 会自己琢磨说短句，偶尔语出惊人",
      can_think: true,
      max_length: 36,
      thought: "刚才偷听你们聊起「窗台」和「三分钟」，小脑袋里冒出好奇，想自己琢磨着插一句嘴。",
      overheard_count: 2,
      corpus_count: 14,
      psyche_axes: { curiosity: 68, independence: 42, warmth: 81 },
      next_stage: { id: "teen", label: "青春期", starts_at_day: 24, days_remaining: 11.5, summary: "独立主见期 · 会自己思考，表达更长且有小脾气" },
      stages: [
        { id: "infant", label: "婴儿期", starts_at_day: 0, unlocked: true, current: false, can_think: false },
        { id: "toddler", label: "幼儿期", starts_at_day: 4, unlocked: true, current: false, can_think: false },
        { id: "child", label: "童年期", starts_at_day: 12, unlocked: true, current: true, can_think: true },
        { id: "teen", label: "青春期", starts_at_day: 24, unlocked: false, current: false, can_think: true },
        { id: "adult", label: "成年期", starts_at_day: 36, unlocked: false, current: false, can_think: true },
      ],
    },
    milestones: [
      {
        id: "preview-m-1",
        title: "第一次对名字露出了笑脸",
        note: `听到你和${aiName}叫“小灯芽”时挥了挥小手。`,
        created_at: "2026-11-24T19:20:00+08:00",
      },
      {
        id: "preview-m-2",
        title: "学会了说“亮亮”",
        note: "指着窗外晚霞和灯塔小夜灯重复了两遍。",
        created_at: "2026-11-25T08:45:00+08:00",
      },
    ],
    events: [],
  };
}

export default function Nursery({ aiName = "伴侣", onNotice, visualPreview = false }) {
  const [snapshot, setSnapshot] = useState(() => (visualPreview ? createPreviewNurserySnapshot(aiName) : null));
  const [loading, setLoading] = useState(!visualPreview);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [needsRecheck, setNeedsRecheck] = useState(false);
  const [busy, setBusy] = useState("");
  const [speechAction, setSpeechAction] = useState("talk");
  const [speechText, setSpeechText] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [portrait, setPortrait] = useState(null);
  const [portraitOpen, setPortraitOpen] = useState(false);
  const [scope] = useState(() => settingsSaveScope(authSession.getSnapshot()));
  const [overhearEnabled, setOverhearEnabled] = useState(() => readOverhearEnabled(scope));
  const [eavesdropNotice, setEavesdropNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const lifecycleRef = useRef(null);
  const busyRef = useRef(false);
  const recheckRef = useRef(false);
  const readVersionRef = useRef(0);
  const noticeRef = useRef(onNotice);
  const speechTabsRef = useRef(null);
  const activeSpeechRef = useRef(null);

  useEffect(() => {
    noticeRef.current = onNotice;
  }, [onNotice]);

  const isCurrent = useCallback((lifecycle) =>
    lifecycle && lifecycleRef.current === lifecycle &&
    !lifecycle.controller.signal.aborted &&
    settingsSaveScope(authSession.getSnapshot()) === scope,
  [scope]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (visualPreview) {
        setLoading(false);
        setReading(false);
        return;
      }
      const lifecycle = lifecycleRef.current;
      if (!isCurrent(lifecycle) || busyRef.current) return;
      const version = ++readVersionRef.current;
      const acceptsRead = () => isCurrent(lifecycle) && readVersionRef.current === version;
      setReading(true);
      try {
        const data = await apiRequest("/api/v2/nursery", {
          signal: lifecycle.controller.signal,
          authSession: lifecycle.session,
          retry: false,
        });
        if (!acceptsRead()) return;
        assertNurserySnapshot(data);
        setSnapshot(data);
        setReadError("");
        setActionError("");
        if (data.available === true) { recheckRef.current = false; setNeedsRecheck(false); }
      } catch (error) {
        if (!acceptsRead()) return;
        const message = requestFailureMessage(error);
        setReadError(`家庭状态读取失败。${message}`);
        if (!silent) noticeRef.current?.(message);
      } finally {
        if (acceptsRead()) {
          setLoading(false);
          setReading(false);
        }
      }
    },
    [isCurrent],
  );

  useEffect(() => {
    if (visualPreview) return undefined;
    const controller = new AbortController();
    const lifecycle = {
      controller,
      session: createScopedSettingsSession(authSession, scope, controller.signal),
    };
    lifecycleRef.current = lifecycle;
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    }, 60 * 1000);
    return () => {
      controller.abort();
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      busyRef.current = false;
      recheckRef.current = false;
      readVersionRef.current += 1;
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load, scope, visualPreview]);

  const child = snapshot?.child || null;
  const latestUtterance = snapshot?.utterances?.[0] || null;
  const overheardCorpus = Array.isArray(snapshot?.overheard_corpus) ? snapshot.overheard_corpus : [];
  const learnedChunks = Array.isArray(snapshot?.learned_chunks) ? snapshot.learned_chunks : [];
  const languageProfile = snapshot?.language_profile || null;
  const latestThought = latestUtterance?.generation_parameters?.thought || languageProfile?.thought || "";
  const latestTriggerTag = TRIGGER_LABELS[latestUtterance?.trigger] || "";
  const bonds = useMemo(
    () =>
      Object.fromEntries(
        (snapshot?.bonds || []).map((bond) => [bond.caregiver_kind, bond]),
      ),
    [snapshot?.bonds],
  );

  async function perform(label, request, { portraitOnly = false, actionKind, candidates } = {}) {
    const lifecycle = lifecycleRef.current;
    if (busyRef.current || (!portraitOnly && recheckRef.current) || !isCurrent(lifecycle)) return null;
    busyRef.current = true;
    readVersionRef.current += 1;
    setReading(false);
    setBusy(label);
    setActionError("");
    try {
      const data = await request({
        signal: lifecycle.controller.signal,
        authSession: lifecycle.session,
        retry: false,
      });
      if (!isCurrent(lifecycle)) return null;
      if (portraitOnly) {
        assertNurseryPortrait(data);
        setPortrait(data.portrait);
      }
      else {
        assertNurserySnapshot(data, { requireChild: true, childId: child?.id });
        assertNurseryReceipt(data, { label, actionKind, candidates });
        setSnapshot(data);
        setPortrait(null);
        setReadError("");
      }
      return data;
    } catch (error) {
      if (!isCurrent(lifecycle)) return null;
      if (portraitOnly) setPortraitOpen(false);
      else { recheckRef.current = true; setNeedsRecheck(true); }
      const message = requestFailureMessage(error);
      setActionError(portraitOnly
        ? `成长画像读取失败。${message}`
        : `本次操作结果尚未确认，请先重新读取家庭状态核对，勿重复提交。${message}`);
      noticeRef.current?.(message);
      return null;
    } finally {
      if (isCurrent(lifecycle)) {
        busyRef.current = false;
        setBusy("");
      }
    }
  }

  async function createChild() {
    await perform("birth", (options) =>
      apiRequest("/api/v2/nursery/children", {
        ...options,
        method: "POST",
        body: JSON.stringify({ client_action_id: clientActionId("birth") }),
      }),
    );
  }

  async function sendSpeech(event) {
    event.preventDefault();
    const submitted = speechText;
    const text = speechText.trim();
    if (!child || !text) return;
    if (visualPreview) {
      setSnapshot((current) => current ? {
        ...current,
        state: { ...current.state, mood: Math.min(100, (current.state?.mood || 80) + 3), intimacy: Math.min(100, (current.state?.intimacy || 75) + 2) },
        utterances: [{ id: `preview-u-${Date.now()}`, text: `记住了：“${text.slice(0, 24)}”！` }, ...(current.utterances || [])],
      } : current);
      setSpeechText("");
      return;
    }
    const result = await perform("speech", (options) =>
      apiRequest(`/api/v2/nursery/children/${child.id}/actions`, {
        ...options,
        method: "POST",
        body: JSON.stringify({
          action: speechAction,
          text,
          client_action_id: clientActionId(speechAction),
        }),
      }),
      { actionKind: speechAction },
    );
    if (result) setSpeechText((current) => current === submitted ? "" : current);
  }

  async function care(action) {
    if (!child) return;
    if (visualPreview) {
      const replyMap = { soothe: "抱抱最安心啦～", diaper: "清爽舒服多啦！", burp: "嗝～舒服！", play: "嘻嘻，还要再玩一次！" };
      setSnapshot((current) => current ? {
        ...current,
        state: {
          ...current.state,
          mood: Math.min(100, (current.state?.mood || 80) + 4),
          fatigue: Math.max(0, (current.state?.fatigue || 20) + (action === "play" ? 4 : -4)),
        },
        utterances: [{ id: `preview-u-${Date.now()}`, text: replyMap[action] || "开心～" }, ...(current.utterances || [])],
      } : current);
      return;
    }
    await perform(action, (options) =>
      apiRequest(`/api/v2/nursery/children/${child.id}/actions`, {
        ...options,
        method: "POST",
        body: JSON.stringify({
          action,
          client_action_id: clientActionId(action),
        }),
      }),
    );
  }

  async function letCompanionCare() {
    if (!child) return;
    if (visualPreview) {
      setSnapshot((current) => current ? {
        ...current,
        state: { ...current.state, mood: Math.min(100, (current.state?.mood || 80) + 5) },
        utterances: [{ id: `preview-u-${Date.now()}`, text: `${aiName}讲的小故事真好听呀～` }, ...(current.utterances || [])],
      } : current);
      return;
    }
    await perform("companion", (options) =>
      apiRequest(
        `/api/v2/nursery/children/${child.id}/companion-actions`,
        {
          ...options,
          method: "POST",
          body: JSON.stringify({
            client_action_id: clientActionId("companion"),
          }),
        },
      ),
    );
  }

  async function chooseName(event) {
    event.preventDefault();
    if (!child) return;
    const submitted = nameDraft;
    const candidates = nameDraft
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!candidates.length) return;
    const result = await perform("name", (options) =>
      apiRequest(`/api/v2/nursery/children/${child.id}/name`, {
        ...options,
        method: "POST",
        body: JSON.stringify({
          candidates,
          client_action_id: clientActionId("name"),
        }),
      }),
      { candidates },
    );
    if (result) setNameDraft((current) => current === submitted ? "" : current);
  }

  async function triggerOverhear() {
    if (!child) return;
    if (visualPreview) {
      setEavesdropNotice("预览模式：她悄悄记住了你们刚聊的“窗台看日出”～");
      return;
    }
    setEavesdropNotice("");
    const result = await perform("overhear", (options) =>
      apiRequest(`/api/v2/nursery/children/${child.id}/overhear`, {
        ...options,
        method: "POST",
        body: JSON.stringify({
          client_action_id: clientActionId("overhear"),
        }),
      }),
    );
    if (result) {
      if (result.overheard?.length) {
        setEavesdropNotice(`刚刚偷偷从你们的聊天里学会了：“${result.overheard[0].text}”`);
      } else if (result.message) {
        setEavesdropNotice(result.message);
      }
    }
  }

  async function triggerReflect() {
    if (!child) return;
    if (visualPreview) {
      setSnapshot((current) => current ? {
        ...current,
        utterances: [
          {
            id: `preview-r-${Date.now()}`,
            trigger: "reflect",
            stage: "child",
            text: "我刚在想，明天早上窗台亮起来的时候，我也可以赖三分钟吗？",
            generation_parameters: { thought: "听你们聊三分钟和日出，自己也想撒个娇试试。" },
            created_at: new Date().toISOString(),
          },
          ...(current.utterances || []),
        ],
      } : current);
      return;
    }
    setEavesdropNotice("");
    const result = await perform("reflect", (options) =>
      apiRequest(`/api/v2/nursery/children/${child.id}/reflect`, {
        ...options,
        method: "POST",
        body: JSON.stringify({
          client_action_id: clientActionId("reflect"),
        }),
      }),
    );
    if (result?.thought) {
      setEavesdropNotice(result.provider_used ? "她结合偷学来的话自己想了想，开口说出了一句新话。" : "");
    }
  }

  function toggleAutoOverhear(nextChecked) {
    setOverhearEnabled(nextChecked);
    writeOverhearEnabled(scope, nextChecked);
    setEavesdropNotice(
      nextChecked
        ? `已开启自动偷听：平时你和${aiName}聊天时，她会随机悄悄偷学几个字或短句。`
        : "已暂停自动偷听，仍可随时点下方按钮让她听一次。",
    );
  }

  async function togglePortrait() {
    if (visualPreview) {
      setPortraitOpen((open) => !open);
      setPortrait((current) => current || { language: { learned_characters: 42, unique_characters: 26, utterances: 9 }, milestones: 2 });
      return;
    }
    if (busyRef.current || !isCurrent(lifecycleRef.current)) return;
    const nextOpen = !portraitOpen;
    setPortraitOpen(nextOpen);
    if (!nextOpen || portrait || !child) return;
    await perform("portrait", (options) => apiRequest(
      `/api/v2/nursery/children/${child.id}/portrait`, options,
    ), { portraitOnly: true });
  }

  if (loading) {
    return <section className="feature-page nursery-page is-loading">正在回家…</section>;
  }

  const previewBanner = visualPreview && (
    <div className="nursery-empty-state" role="note" style={{ marginBottom: "14px" }}>
      <span>当前位于无登录视觉预览页（/visual-preview.html），下方为离线演示家庭状态，互动仅在本地画面生效。</span>
      <button type="button" onClick={() => { window.location.href = "/"; }}>前往主入口登录</button>
    </div>
  );

  const feedback = (readError || actionError) && (
    <div className="nursery-empty-state" role="alert">
      {actionError && <span>{actionError}</span>}
      {readError && <span>{readError}</span>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center" }}>
        <button type="button" disabled={reading || Boolean(busy)} onClick={() => void load()}>
          {reading ? "正在读取…" : "重新读取家庭状态"}
        </button>
        {(readError.includes("authentication_required") || actionError.includes("authentication_required")) && (
          <button type="button" onClick={() => { window.location.href = "/"; }}>
            前往主入口登录
          </button>
        )}
      </div>
    </div>
  );

  if (!snapshot) {
    return <section className="feature-page nursery-page">{feedback}</section>;
  }

  if (snapshot?.available === false) {
    return (
      <section className="feature-page nursery-page">
        {feedback}
        <div className="nursery-empty-state">
          <strong>育儿房正在准备</strong>
          <span>{snapshot.message}</span>
        </div>
      </section>
    );
  }

  if (!child) {
    return (
      <section className="feature-page nursery-page">
        {feedback}
        <div className="nursery-birth-scene">
          <span className="nursery-birth-mark" aria-hidden="true">✦</span>
          <h2>我们的小朋友</h2>
          <button type="button" disabled={Boolean(busy) || needsRecheck} onClick={createChild}>
            {busy === "birth" ? "正在出生…" : "迎接她回家"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="feature-page nursery-page">
      {previewBanner}
      {feedback}
      <header className="nursery-hero">
        <div className="nursery-child-orbit" aria-hidden="true">
          <span>{child.name?.slice(0, 1) || "?"}</span>
        </div>
        <div>
          <small>{child.stage.label} · 第 {child.stage.age_days.toFixed(1)} 天</small>
          <h2>{child.display_name}</h2>
          <p>
            {latestUtterance ? (
              <>
                {latestTriggerTag && <span className="nursery-utterance-tag">{latestTriggerTag}</span>}
                “<TypewriterText text={latestUtterance.text} stepMs={24} />”
              </>
            ) : (
              "“咿呀……”"
            )}
          </p>
          {latestThought && (
            <p className="nursery-thought-line">内心小想法：{latestThought}</p>
          )}
        </div>
        <span className="nursery-local-badge">{languageProfile?.can_think ? "成长思考" : "LOCAL"}</span>
      </header>

      {languageProfile?.stages?.length > 0 && (
        <section className="nursery-lang-journey" aria-label="语言发育阶段">
          <div className="nursery-lang-journey-head">
            <strong>{languageProfile.current_summary}</strong>
            {languageProfile.next_stage ? (
              <small>再过 {languageProfile.next_stage.days_remaining} 天进入{languageProfile.next_stage.label}</small>
            ) : (
              <small>已解锁全部语言阶段</small>
            )}
          </div>
          <ol className="nursery-stage-track">
            {languageProfile.stages.map((st) => (
              <li key={st.id} className={`${st.unlocked ? "is-unlocked" : ""}${st.current ? " is-current" : ""}`}>
                <span>{st.label}</span>
                <small>{st.can_think ? "会思考" : st.id === "infant" ? "复读叠词" : "拼词学语"}</small>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!child.name && (
        <form className="nursery-name-form" onSubmit={chooseName}>
          <input
            value={nameDraft}
            maxLength={64}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="一个名字，或最多三个候选"
          />
          <button type="submit" disabled={Boolean(busy) || needsRecheck || !nameDraft.trim()}>
            {busy === "name" ? "…" : "定名"}
          </button>
        </form>
      )}

      <div className="nursery-state-grid">
        {STATE_ITEMS.map(([key, label]) => (
          <StateMeter
            key={key}
            label={label}
            value={snapshot.state?.[key]}
            inverse={key === "fatigue" || key === "digest_load"}
          />
        ))}
      </div>

      <form className="nursery-speech-form" onSubmit={sendSpeech}>
        <div className="nursery-segments has-sliding-indicator" role="group" aria-label="说话方式" ref={speechTabsRef}>
          <SlidingIndicator containerRef={speechTabsRef} activeRef={activeSpeechRef} activeKey={speechAction} className="nursery-segment-indicator" />
          {SPEECH_ACTIONS.map((action) => (
            <button
              type="button"
              key={action.id}
              className={speechAction === action.id ? "active" : ""}
              ref={speechAction === action.id ? activeSpeechRef : undefined}
              onClick={() => setSpeechAction(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="nursery-speech-composer">
          <textarea
            value={speechText}
            maxLength={1000}
            rows={3}
            onChange={(event) => setSpeechText(event.target.value)}
            placeholder="说给孩子听…"
          />
          <button type="submit" disabled={Boolean(busy) || needsRecheck || !speechText.trim()} aria-label="发送给孩子">
            {busy === "speech" ? "…" : "↑"}
          </button>
        </div>
      </form>

      <div className="nursery-care-grid">
        {CARE_ACTIONS.map((action) => (
          <button
            type="button"
            key={action.id}
            disabled={Boolean(busy) || needsRecheck}
            onClick={() => care(action.id)}
          >
            <span aria-hidden="true">{action.symbol}</span>
            <small>{busy === action.id ? "进行中" : action.label}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="nursery-companion-action"
        disabled={Boolean(busy) || needsRecheck}
        onClick={letCompanionCare}
      >
        <span>{aiName.slice(0, 1)}</span>
        <strong>{busy === "companion" ? `${aiName}正在陪她` : `让${aiName}陪她一会`}</strong>
      </button>

      <section className="nursery-eavesdrop-card" aria-labelledby="nursery-eavesdrop-title">
        <header className="nursery-eavesdrop-head">
          <div>
            <h3 id="nursery-eavesdrop-title">偷学小本本 · 聊天语料</h3>
            <small>
              平时你和{aiName}聊天时，她会随机悄悄偷学几个字或几句话；小时候只会咿呀重复，长大后结合偷学词自己思考说更多。
            </small>
          </div>
          <label className="nursery-eavesdrop-toggle">
            <input
              type="checkbox"
              checked={overhearEnabled}
              onChange={(event) => toggleAutoOverhear(event.target.checked)}
            />
            <span>自动偷听</span>
          </label>
        </header>

        <div className="nursery-eavesdrop-actions">
          <button
            type="button"
            disabled={Boolean(busy) || needsRecheck}
            onClick={() => void triggerOverhear()}
          >
            {busy === "overhear" ? "正竖起耳朵偷听…" : "让她偷听刚聊的话"}
          </button>
          <button
            type="button"
            className="is-think"
            disabled={Boolean(busy) || needsRecheck}
            onClick={() => void triggerReflect()}
          >
            {busy === "reflect"
              ? "正在小脑袋里琢磨…"
              : languageProfile?.can_think
                ? "听她自己想想说句话"
                : "听她咿呀学一句"}
          </button>
        </div>

        {eavesdropNotice && (
          <p className="nursery-eavesdrop-notice" role="status">{eavesdropNotice}</p>
        )}

        {learnedChunks.length > 0 && (
          <div className="nursery-chunk-section">
            <small>脑海里记住的高频小词库</small>
            <div className="nursery-chunk-cloud">
              {learnedChunks.slice(0, 12).map((chunk) => (
                <span key={chunk.text} className={chunk.overheard ? "is-overheard" : ""}>
                  {chunk.text}
                </span>
              ))}
            </div>
          </div>
        )}

        {overheardCorpus.length > 0 ? (
          <div className="nursery-overheard-list">
            <small>最近偷听到的词句（{overheardCorpus.length}）</small>
            <ul>
              {overheardCorpus.slice(0, 6).map((item) => (
                <li key={item.id || `${item.speaker}-${item.text}`}>
                  <span className={`is-${item.speaker === "companion" ? "companion" : "user"}`}>
                    {item.speaker === "companion" ? `偷听${aiName}` : "偷听你"}
                  </span>
                  <strong>“{item.text}”</strong>
                  <time>{formatTime(item.created_at)}</time>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="nursery-eavesdrop-empty">
            还没有偷听到你和{aiName}的聊天词句。点「让她偷听刚聊的话」或去聊两句，她就会悄悄竖起耳朵记下来。
          </p>
        )}
      </section>

      {snapshot.utterances?.length > 1 && (
        <section className="nursery-utterance-log">
          <button type="button" onClick={() => setHistoryOpen((open) => !open)}>
            <span>最近开口记录（{snapshot.utterances.length}）</span>
            <strong>{historyOpen ? "收起" : "展开"}</strong>
          </button>
          {historyOpen && (
            <ul>
              {snapshot.utterances.slice(0, 6).map((item) => (
                <li key={item.id || item.text}>
                  <span>{TRIGGER_LABELS[item.trigger] || "开口"}</span>
                  <strong>“{item.text}”</strong>
                  <time>{formatTime(item.created_at)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="nursery-bonds">
        {[
          ["user", "和我"],
          ["companion", `和${aiName}`],
        ].map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{Math.round(Number(bonds[key]?.attachment ?? 20))}</strong>
            <small>安心 {Math.round(Number(bonds[key]?.trust ?? 20))}</small>
          </div>
        ))}
      </section>

      <section className="nursery-album">
        <header>
          <h3>成长相册</h3>
          <span>{snapshot.milestones?.length || 0}</span>
        </header>
        <div>
          {(snapshot.milestones || []).slice(0, 12).map((milestone) => (
            <article key={milestone.id}>
              <time>{formatTime(milestone.created_at)}</time>
              <strong>{milestone.title}</strong>
              {milestone.note && <p>{milestone.note}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="nursery-portrait">
        <button type="button" onClick={togglePortrait} disabled={Boolean(busy)}>
          <span>成长画像</span>
          <strong>{portraitOpen ? "收起" : busy === "portrait" ? "读取中" : "查看"}</strong>
        </button>
        {portraitOpen && portrait && (
          <div>
            <span>学过 {portrait.language.learned_characters} 个字</span>
            <span>词汇 {portrait.language.unique_characters} 种</span>
            <span>回应 {portrait.language.utterances} 次</span>
            <span>里程碑 {portrait.milestones} 个</span>
          </div>
        )}
      </section>
    </section>
  );
}
