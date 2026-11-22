import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCompanionInteractionLifecycle } from "../src/companion-interaction-lifecycle.js";
import { COMPANION_INTERACTION_TYPES, enqueueCompanionInteraction } from "../src/companion-interaction.js";
import { createDefaultCompanionInteractionStats, recordCompanionInteraction, readCompanionStatus, saveCompanionStatus, readCompanionInteractionStats, saveCompanionInteractionStats } from "../src/companion-status.js";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const queueSource = source.slice(source.indexOf("  async function processCompanionInteractionQueue()"), source.indexOf("  async function selectChatAttachments("));
const registerSource = source.slice(source.indexOf("  function registerCompanionInteraction("), source.indexOf("  companionInteractionHandlerRef.current = registerCompanionInteraction;"));
assert.ok(queueSource.includes("lifecycle.begin(interaction.eventId)"));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const identity = (account = "account-a", companion = "companion-a") => ({ user: { id: account }, activeCompanionId: companion });
const scopeOf = snapshot => JSON.stringify([snapshot.user.id, snapshot.activeCompanionId]);

function fixture({ sessionId = "session-a", flush, device, call, timeoutMs = 90_000 } = {}) {
  const state = { identity: identity(), scope: scopeOf(identity()), sessions: [], messages: [], status: { revision: 0, mood: "虚构旧心情" }, stats: createDefaultCompanionInteractionStats(), busy: false, feedback: { state: "queued", message: "" }, notices: [], scheduled: [], drafts: [], models: [], plays: [], hints: [], syncs: [], merges: 0, calls: [], timer: null };
  const activeSessionIdRef = { current: sessionId };
  const auth = {
    getSnapshot: () => state.identity,
    getRequestContext: async () => ({ accessToken: "fictional-token", companionId: state.identity.activeCompanionId }),
  };
  const lifecycle = createCompanionInteractionLifecycle({ getScope: () => state.scope, getSessionId: () => activeSessionIdRef.current, authSession: auth, timeoutMs, setTimer: callback => { state.timer = callback; return 1; }, clearTimer() {} });
  lifecycle.synchronize(state.scope, sessionId);
  state.stats = recordCompanionInteraction(state.stats, "hand", Date.now());
  const eventCounts = Object.fromEntries(COMPANION_INTERACTION_TYPES.map(type => [type, type === "hand" ? 1 : 0]));
  const event = { eventId: "fictional-event-a", sessionId, preInteractionStatus: state.status, interactionType: "hand", burstCount: 1, interactionCount: 1, streakCount: 1, interactionCounts: eventCounts, batchCounts: eventCounts, recentSequence: ["hand"], lastClickedAt: Date.now() };
  const update = key => value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const context = {
    navigator: { onLine: true },
    companionInteractionQueueRef: { current: [event] }, companionInteractionLifecycleRef: { current: lifecycle },
    companionInteractionInFlightRef: { current: false }, companionReplyTimesRef: { current: [] }, isSendingRef: { current: false }, voiceStateRef: { current: "idle" },
    companionStatusRef: { current: state.status }, companionInteractionStatsRef: { current: state.stats }, environmentContextRef: { current: {} },
    activeSessionIdRef, streamingSessionIdRef: { current: null }, messageLoadTokenRef: { current: 0 }, messagesSessionIdRef: { current: sessionId },
    privateMediaScope: state.scope, COMPANION_INTERACTION_TYPES: ["hand", "heart"], COMPANION_INTERACTION_RATE_WINDOW_MS: 60_000, COMPANION_INTERACTION_RATE_LIMIT: 10, COMPANION_INTERACTION_DEBOUNCE_MS: 1100,
    voiceInputBusy: () => false, voiceAutoSpeakEnabled: false, effectiveAiName: "虚构伴侣", selectedChatModel: "fictional-model", settings: { model: "fictional-model" }, visualPreview: false,
    scheduleCompanionInteraction: delay => state.scheduled.push(delay),
    setNotice: value => state.notices.push(value), setInteractionFeedback: update("feedback"), setIsCompanionResponding: update("busy"),
    setCompanionStatus: update("status"), setMessages: update("messages"), setSessions: update("sessions"), setCompanionInteractionStats: update("stats"),
    companionStatusForRequest: value => value,
    mergeCompanionStatus: (current, next) => { state.merges++; return { ...current, ...next }; },
    setActiveSessionId: value => { activeSessionIdRef.current = value; lifecycle.synchronize(state.scope, value); },
    flushLatestSettingsDraft: flush || (async () => true), refreshDeviceActivityContext: device || (async () => null),
    moveSessionDraft: (...args) => state.drafts.push(args), initializeSessionChatModel: id => state.models.push(id),
    readStoredSessionChatModel: () => "", shanghaiClientTime: () => "2026-10-19T12:00:00+08:00", SHANGHAI_TIME_ZONE: "Asia/Shanghai",
    playAssistantReply: (...args) => state.plays.push(args), refreshComposerHint: async (...args) => state.hints.push(args), syncDisplayedMessages: async (...args) => state.syncs.push(args),
    describeOperationError: error => ({ code: error.code || "request_failed" }),
    recordCompanionInteraction, enqueueCompanionInteraction,
    createCompanionInteractionEventId: () => "fictional-event-b",
    apiRequest: async (path, options = {}) => {
      state.calls.push({ path, options });
      await options.authSession?.getRequestContext();
      if (call) return call(path, options, state);
      if (path === "/api/v2/sessions" && options.method === "POST") return { session: { id: "created-session" } };
      if (path === "/api/v2/sessions") return { sessions: [{ id: activeSessionIdRef.current }] };
      return { interaction_event_id: event.eventId, assistant_message: { id: "assistant-a", role: "assistant", conversation_id: activeSessionIdRef.current, content: "虚构回应" }, companion_status: { revision: 1, statusSource: "model", mood: "虚构新心情" }, status_generation: { state: "generated", code: "" } };
    },
  };
  const drain = new Function(...Object.keys(context), queueSource + "\nreturn processCompanionInteractionQueue;")(...Object.values(context));
  const register = new Function(...Object.keys(context), registerSource + "\nreturn registerCompanionInteraction;")(...Object.values(context));
  const change = ({ account, companion, session = activeSessionIdRef.current } = {}) => {
    state.identity = identity(account || state.identity.user.id, companion || state.identity.activeCompanionId);
    state.scope = scopeOf(state.identity);
    activeSessionIdRef.current = session;
    lifecycle.synchronize(state.scope, session);
    context.companionInteractionQueueRef.current = [];
    context.companionInteractionInFlightRef.current = false;
    state.busy = false;
    state.feedback = { state: "idle", message: "" };
  };
  return { state, context, lifecycle, drain, register, event, auth, change, activeSessionIdRef };
}

test("the actual queue takes ownership before settings/device awaits so duplicate drains send once", async () => {
  const saving = deferred();
  const f = fixture({ flush: () => saving.promise });
  const first = f.drain(), second = f.drain();
  await tick();
  assert.equal(f.state.busy, true);
  assert.equal(f.state.feedback.state, "generating");
  assert.equal(f.state.calls.length, 0);
  saving.resolve(true);
  await Promise.all([first, second]); await tick();
  assert.equal(f.state.calls.filter(item => item.path === "/companion/interact").length, 1);
  assert.equal(f.state.messages.filter(item => item.id === "assistant-a").length, 1);
  assert.equal(f.state.busy, false);
  assert.equal(f.state.feedback.state, "idle");
  assert.equal(f.context.companionInteractionInFlightRef.current, false);
});

for (const failure of ["false", "error"]) test(`settings save ${failure} retains the original event for explicit retry without model calls or auto-reschedule`, async () => {
  let attempts = 0;
  const f = fixture({ flush: async () => {
    if (++attempts > 1) return true;
    if (failure === "error") throw Object.assign(new Error("虚构设置网络错误"), { code: "request_failed" });
    return false;
  } });
  await f.drain();
  assert.equal(f.context.companionInteractionQueueRef.current[0].eventId, f.event.eventId);
  assert.equal(f.state.feedback.state, "failed");
  assert.equal(f.state.calls.length + f.state.scheduled.length + f.state.messages.length + f.state.syncs.length, 0);
  assert.equal(f.state.busy, false);
  f.register("heart");
  assert.equal(f.context.companionInteractionQueueRef.current[0].eventId, f.event.eventId);
  assert.equal(f.context.companionInteractionQueueRef.current[0].burstCount, 2);
  await f.drain(); await tick();
  const calls = f.state.calls.filter(item => item.path === "/companion/interact");
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).event_id, f.event.eventId);
  assert.equal(JSON.parse(calls[0].options.body).burst_count, 2);
  assert.equal(f.context.companionInteractionQueueRef.current.length, 0);
  assert.equal(f.state.messages.at(-1).id, "assistant-a");
});

test("clicks during a pending settings save merge into the retained event before consumption", async () => {
  const saving = deferred();
  const f = fixture({ flush: () => saving.promise });
  const task = f.drain(); await tick();
  f.register("heart");
  assert.equal(f.context.companionInteractionQueueRef.current.length, 1);
  assert.equal(f.context.companionInteractionQueueRef.current[0].burstCount, 2);
  assert.equal(f.state.calls.length, 0);
  saving.resolve(true); await task; await tick();
  const body = JSON.parse(f.state.calls.find(item => item.path === "/companion/interact").options.body);
  assert.equal(body.event_id, f.event.eventId);
  assert.equal(body.burst_count, 2);
  assert.equal(body.batch_counts.hand, 1);
  assert.equal(body.batch_counts.heart, 1);
  assert.deepEqual(body.recent_sequence, ["hand", "heart"]);
  assert.equal(f.state.feedback.state, "idle");
});

for (const stage of ["settings", "device"]) for (const field of ["account", "companion", "session"]) test(`${field} switch during ${stage} cannot send requests or write late feedback`, async () => {
  const pending = deferred();
  const f = fixture({ [stage === "settings" ? "flush" : "device"]: () => pending.promise });
  const task = f.drain(); await tick();
  f.change({ [field]: `fictional-other-${field}` });
  f.state.busy = true;
  pending.resolve(true); await task; await tick();
  assert.equal(f.state.calls.length + f.state.messages.length + f.state.merges, 0);
  assert.deepEqual(f.state.feedback, { state: "idle", message: "" });
  assert.equal(f.state.notices.length, 1, "only the initial notice reset occurred");
  assert.equal(f.state.busy, true, "late finally must not release the replacement operation");
});

test("a delayed session-creation receipt cannot select a session in another account", async () => {
  const creating = deferred();
  const f = fixture({ sessionId: null, call: () => creating.promise });
  const task = f.drain(); await tick();
  assert.equal(f.state.calls[0].path, "/api/v2/sessions");
  assert.equal(f.state.calls[0].options.authSession.getSnapshot().user.id, "account-a");
  f.change({ account: "account-b", session: "session-b" });
  f.state.busy = true;
  creating.resolve({ session: { id: "old-created-session" } }); await task; await tick();
  assert.equal(f.activeSessionIdRef.current, "session-b");
  assert.equal(f.state.sessions.length + f.state.drafts.length + f.state.models.length + f.state.messages.length, 0);
  assert.equal(f.state.busy, true);
});

test("an interaction-created session is adopted without cancelling the response and rebases queued clicks", async () => {
  const creating = deferred();
  const f = fixture({ sessionId: null, call: (path, options) => {
    if (options.method === "POST" && path === "/api/v2/sessions") return creating.promise;
    if (path === "/api/v2/sessions") return { sessions: [{ id: "created-session" }] };
    return { assistant_message: { id: "assistant-a", role: "assistant", content: "虚构创建后回应" }, companion_status: { statusSource: "model" } };
  } });
  const task = f.drain(); await tick();
  f.register("heart");
  assert.equal(f.state.feedback.state, "queued");
  creating.resolve({ session: { id: "created-session" } }); await task; await tick();
  assert.equal(f.activeSessionIdRef.current, "created-session");
  assert.deepEqual(f.state.drafts, [[null, "created-session"]]);
  assert.equal(f.context.companionInteractionQueueRef.current[0].sessionId, "created-session");
  assert.equal(f.state.messages.at(-1).id, "assistant-a");
  assert.equal(f.state.feedback.state, "queued", "older reply cannot dismiss a newer queued interaction");
  assert.equal(f.state.busy, false);
  assert.ok(f.state.scheduled.length >= 2);
});

for (const field of ["account", "companion", "session"]) test(`a delayed model reply after ${field} switch cannot update status, messages or notices`, async () => {
  const response = deferred();
  const f = fixture({ call: path => path === "/companion/interact" ? response.promise : { sessions: [] } });
  const task = f.drain(); await tick();
  assert.equal(f.state.messages.length, 1);
  f.change({ [field]: `fictional-new-${field}` });
  f.state.messages = [];
  f.state.busy = true;
  response.resolve({ assistant_message: { id: "late-assistant", role: "assistant", content: "虚构迟到回复" }, companion_status: { mood: "不能写入新空间" } });
  await task; await tick();
  assert.equal(f.state.messages.length + f.state.merges + f.state.hints.length + f.state.syncs.length, 0);
  assert.equal(f.state.feedback.state, "idle");
  assert.equal(f.state.busy, true);
  assert.equal(f.state.calls.length, 1);
});

test("body deadline releases the owned busy state and shows a retryable failure without auto-resending", async () => {
  const never = deferred();
  const f = fixture({ call: () => never.promise });
  const task = f.drain(); await tick();
  f.state.timer(); await task;
  assert.equal(f.state.feedback.state, "failed");
  assert.match(f.state.feedback.message, /companion_interaction_timeout/);
  assert.equal(f.state.busy, false);
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.scheduled.length, 0);
  never.resolve({ assistant_message: { role: "assistant", content: "虚构迟到回复" } }); await tick();
  assert.equal(f.state.messages.length + f.state.merges, 0);
});

for (const bad of ["event", "session", "empty"]) test(`an invalid ${bad} receipt cannot apply status before reply validation`, async () => {
  const f = fixture({ call: () => ({
    interaction_event_id: bad === "event" ? "wrong-event" : "fictional-event-a",
    assistant_message: { id: "assistant-a", role: "assistant", conversation_id: bad === "session" ? "wrong-session" : "session-a", content: bad === "empty" ? "" : "虚构回应" },
    companion_status: { mood: "不该更新的心情" },
  }) });
  await f.drain();
  assert.equal(f.state.merges, 0);
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.state.feedback.state, "failed");
  assert.match(f.state.feedback.message, /companion_interaction_receipt_invalid/);
});

test("missing generated-state tool data shows fallback while preserving the successful interaction reply", async () => {
  const f = fixture({ call: path => path === "/api/v2/sessions" ? { sessions: [] } : ({ assistant_message: { id: "assistant-a", role: "assistant", content: "虚构成功正文" }, companion_status: { statusSource: "interaction_fallback" }, status_generation: { state: "unavailable", code: "interaction_status_not_returned" } }) });
  await f.drain(); await tick();
  assert.equal(f.state.feedback.state, "fallback");
  assert.match(f.state.feedback.message, /未生成新的心理和感受/);
  assert.equal(f.state.status.mood, "虚构旧心情");
  assert.equal(f.state.merges, 0, "fallback data cannot clear the previous genuinely generated state");
  assert.equal(f.state.messages.at(-1).content, "虚构成功正文");
  assert.equal(f.state.busy, false);
});

test("scoped auth rechecks the account after a delayed token refresh", async () => {
  const f = fixture(), refresh = deferred();
  f.auth.getRequestContext = () => refresh.promise;
  const operation = f.lifecycle.begin("fictional-auth-refresh");
  const token = operation.authSession.getRequestContext();
  f.change({ companion: "companion-b" });
  refresh.resolve({ accessToken: "fictional-token", companionId: "companion-b" });
  await assert.rejects(token, { code: "settings_scope_changed" });
  assert.equal(operation.controller.signal.aborted, true);
});

test("new operations own their busy state even if a disposed operation finalizes later", () => {
  const f = fixture();
  const old = f.lifecycle.begin("old");
  f.change({ session: "new-session" });
  const next = f.lifecycle.begin("new");
  assert.equal(f.lifecycle.finish(old), false);
  assert.equal(next.isCurrent(), true);
  assert.equal(f.lifecycle.begin("duplicate"), null);
  assert.equal(f.lifecycle.finish(next), true);
  f.lifecycle.dispose();
  assert.equal(next.controller.signal.aborted, true, "scope disposal also aborts completed operation's background refresh");
});

test("actual post-interaction history refresh is aborted and ignored after a companion switch", async () => {
  const f = fixture(), history = deferred();
  const operation = f.lifecycle.begin("fictional-history");
  f.lifecycle.finish(operation);
  const start = source.indexOf("  async function syncDisplayedMessages(");
  const end = source.indexOf("  function registerCompanionInteraction(", start);
  const context = { ...f.context,
    apiRequest: async (_path, options) => { assert.equal(options.authSession, operation.authSession); return history.promise; },
    hydrateSessionChatHistory: messages => messages,
  };
  const sync = new Function(...Object.keys(context), source.slice(start, end) + "\nreturn syncDisplayedMessages;")(...Object.values(context));
  const pending = sync("session-a", operation);
  await tick();
  f.change({ companion: "companion-b" });
  history.resolve({ messages: [{ id: "late-history", role: "assistant", content: "虚构历史" }] });
  await assert.rejects(pending);
  assert.equal(f.state.messages.length, 0);
  assert.equal(operation.controller.signal.aborted, true);
});

test("actual scope hydration cannot write the previous companion's state into a newly selected cache", () => {
  const start = source.indexOf("  useLayoutEffect(() => {\n    if (companionStateStorageScopeRef.current");
  const end = source.indexOf("  const companionInteractionHandlerRef", start);
  const persistenceStart = source.indexOf("  useEffect(() => {\n    if (companionStatusRef.current !== companionStatus)");
  const persistenceEnd = source.indexOf("  useEffect(() => {\n    if (\n      visualPreview", persistenceStart);
  assert.ok(start >= 0 && end > start && persistenceEnd > persistenceStart);
  const oldStatus = { mood: "虚构旧伴侣" }, oldStats = { counts: { hand: 99 } };
  const nextStatus = { mood: "虚构新伴侣" }, nextStats = { counts: { hand: 2 } };
  const context = {
    privateMediaScope: JSON.stringify(["same-account", "companion-b"]), companionStateStorageScopeRef: { current: JSON.stringify(["same-account", "companion-a"]) },
    companionStatusRef: { current: oldStatus }, companionInteractionStatsRef: { current: oldStats }, runtimeStateHydratedRef: { current: true }, companionStatus: oldStatus, companionInteractionStats: oldStats,
    readCompanionStatus: () => nextStatus, readCompanionInteractionStats: () => nextStats,
    setCompanionStatus: value => { context.nextStatus = value; }, setCompanionInteractionStats: value => { context.nextStats = value; },
    useLayoutEffect: callback => callback(), useEffect: callback => callback(), useRef: value => ({ current: value }),
    activeSessionId: "",
    saveCompanionStatus: (value, scope) => writes.push({ value, scope }), saveCompanionInteractionStats: (value, scope) => writes.push({ value, scope }),
  };
  const writes = [];
  const run = script => new Function(...Object.keys(context), script)(...Object.values(context));
  run(source.slice(start, end));
  run(source.slice(persistenceStart, persistenceEnd));
  assert.equal(writes.length, 0, "effects from the transition render must not persist the old account/companion state");
  assert.equal(context.runtimeStateHydratedRef.current, false);
  assert.equal(context.nextStatus, nextStatus);
  context.companionStatus = context.nextStatus; context.companionInteractionStats = context.nextStats;
  run(source.slice(start, end)); run(source.slice(persistenceStart, persistenceEnd));
  assert.equal(writes.length, 2);
  assert.equal(writes[0].value, nextStatus);
  assert.equal(writes[1].value, nextStats);
  assert.ok(writes.every(item => item.scope === context.privateMediaScope));
});

test("local status and interaction counts keep different companions in separate cache keys", () => {
  const values = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  try {
    const a = JSON.stringify(["same-account", "companion-a"]), b = JSON.stringify(["same-account", "companion-b"]);
    saveCompanionStatus({ mood: "虚构甲" }, a); saveCompanionStatus({ mood: "虚构乙" }, b);
    saveCompanionInteractionStats({ counts: { hand: 2 } }, a); saveCompanionInteractionStats({ counts: { hand: 8 } }, b);
    assert.equal(readCompanionStatus(a).mood, "虚构甲"); assert.equal(readCompanionStatus(b).mood, "虚构乙");
    assert.equal(readCompanionInteractionStats(a).counts.hand, 2); assert.equal(readCompanionInteractionStats(b).counts.hand, 8);
    assert.match(source, /readCompanionStatus\(privateMediaScope\)/);
    assert.match(source, /saveCompanionStatus\(companionStatus, privateMediaScope\)/);
    assert.doesNotMatch(source, /legacyOwnerStatus|legacyOwnerInteractionStats/);
  } finally { globalThis.localStorage = previous; }
});
