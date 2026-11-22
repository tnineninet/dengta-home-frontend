import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const scope = "fictional-account-A:companion-A";
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function functionSource(name) {
  const start = app.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} must come from the current App`);
  const end = app.indexOf("\n  }\n", start);
  assert.ok(end > start);
  return app.slice(start, end + "\n  }".length);
}
function bind(source, env) {
  return new Function("env", `with (env) { return (${source}); }`)(env);
}
function fixture({ task = null, send = deferred(), stop = deferred() } = {}) {
  let state = task;
  let liveScope = scope;
  const sends = [], stops = [], aborts = [], writes = [];
  const owner = { scope };
  const env = {
    isSendingRef: { current: false }, companionInteractionInFlightRef: { current: false },
    voiceBlocksComposer: () => false, voiceStateRef: { current: "idle" },
    takeoutPluginAvailable: () => true, accountStorageScope: "fictional-account-A", companionScope: "companion-A",
    privateMediaScope: scope, takeoutLifetimeRef: { current: owner }, takeoutConstraintsRef: { current: null },
    componentMountedRef: { current: true }, settingsSaveScope: () => liveScope, authSession: { getSnapshot: () => ({}) },
    setTakeoutTask: update => { state = typeof update === "function" ? update(state) : update; writes.push(state); },
    sendMessage: options => { sends.push(options); return send.promise; },
    takeoutTask: task, abortChatRequest: (...args) => aborts.push(args), chatRequestRef: { current: null },
    diagnosticScopeKey: () => scope,
    stopTakeoutAutomation: options => { stops.push(options); return stop.promise; },
  };
  return {
    env, owner, sends, stops, aborts, writes, send, stop,
    start: bind(functionSource("startTakeoutFromChat"), env),
    pause: bind(functionSource("pauseTakeoutFromChat"), env),
    get state() { return state; },
    set state(next) { state = next; env.takeoutTask = next; },
    setLiveScope: next => { liveScope = next; },
  };
}
const request = { text: "虚构点餐需求正文", query: "热饭", budget: 42.5, note: "不要香菜" };
const settle = async value => { value.send.resolve(); await value.send.promise; await Promise.resolve(); };

test("actual App starts a scoped run with exact explicit local constraints and no carried chat attachments", async () => {
  const h = fixture();
  assert.deepEqual(h.start(request), { ok: true });
  assert.equal(h.state.scope, scope);
  assert.equal(h.state.status, "working");
  assert.equal(h.state.executing, false);
  assert.equal(h.env.takeoutConstraintsRef.current.owner, h.owner);
  assert.equal(h.env.takeoutConstraintsRef.current.runId, h.state.runId);
  assert.equal(h.env.takeoutConstraintsRef.current.budget, request.budget);
  assert.equal(h.env.takeoutConstraintsRef.current.note, request.note);
  assert.deepEqual(h.sends, [{ text: request.text, attachments: [], messageReference: {}, turnContext: "", preserveComposer: true, takeoutConstraints: { runId: h.state.runId } }]);
  await settle(h);
  assert.equal(h.state.status, "manual_review");
  assert.match(h.state.message, /还没有收到手机执行回执/);
});

test("actual App refuses busy and unavailable starts before changing the task or its constraints", () => {
  for (const change of [
    env => { env.isSendingRef.current = true; },
    env => { env.companionInteractionInFlightRef.current = true; },
    env => { env.voiceBlocksComposer = () => true; },
    env => { env.takeoutPluginAvailable = () => false; },
    env => { env.accountStorageScope = ""; },
    env => { env.companionScope = ""; },
  ]) {
    const task = { scope, runId: "existing", status: "manual_review" };
    const h = fixture({ task }); change(h.env);
    assert.equal(h.start(request).ok, false);
    assert.equal(h.state, task);
    assert.equal(h.env.takeoutConstraintsRef.current, null);
    assert.deepEqual(h.sends, []);
  }
});

test("a chat completion cannot settle a newer run, active native operation or payment handoff", async () => {
  for (const current of [
    { runId: "a-newer-run", status: "working", executing: false },
    { status: "working", executing: true },
    { status: "awaiting_payment", executing: false },
  ]) {
    const h = fixture(); h.start(request);
    h.state = { ...h.state, ...current };
    const expected = h.state;
    await settle(h);
    assert.equal(h.state, expected);
  }
});

test("a start completion is ignored after unmount, account switch and A to B to A owner replacement", async () => {
  for (const change of [
    h => { h.env.componentMountedRef.current = false; },
    h => { h.setLiveScope("fictional-account-B:companion-B"); },
    h => { h.env.takeoutLifetimeRef.current = { scope: "B" }; h.env.takeoutLifetimeRef.current = { scope }; },
  ]) {
    const h = fixture(); h.start(request); change(h);
    const expected = h.state;
    await settle(h);
    assert.equal(h.state, expected);
  }
});

test("command-only pause immediately gates its task, clears owned constraints and never closes a page", async () => {
  const h = fixture({ task: { scope, commandId: "command-only", status: "working", executing: true } });
  h.env.takeoutConstraintsRef.current = { scope, owner: h.owner, budget: 42.5 };
  const pending = h.pause();
  assert.equal(h.state.pausedByUser, true);
  assert.equal(h.state.executing, false);
  assert.equal(h.state.status, "manual_review");
  assert.equal(h.env.takeoutConstraintsRef.current, null);
  assert.equal(h.aborts.length, 1);
  assert.deepEqual(h.stops, [{ scope }]);
  h.stop.resolve({ ok: true, message: "虚构暂停回执" });
  await pending;
  assert.equal(h.state.message, "虚构暂停回执");
});

test("pause with no target never aborts ordinary chat or sends a native command", async () => {
  const h = fixture();
  await h.pause();
  assert.deepEqual(h.aborts, []);
  assert.deepEqual(h.stops, []);
  assert.deepEqual(h.writes, []);
});

test("pause late completions cannot replace a newer command, owner or account task", async () => {
  for (const change of [
    h => { h.state = { scope, commandId: "new-command", status: "working", executing: true }; },
    h => { h.env.takeoutLifetimeRef.current = { scope: "B" }; h.env.takeoutLifetimeRef.current = { scope }; },
    h => { h.setLiveScope("B"); },
    h => { h.env.componentMountedRef.current = false; },
  ]) {
    const h = fixture({ task: { scope, commandId: "old-command", status: "working", executing: true } });
    const pending = h.pause(); change(h);
    const expected = h.state;
    h.stop.resolve({ ok: true, message: "旧命令的暂停回执" });
    await pending;
    assert.equal(h.state, expected);
  }
});

function intentFixture(extra = {}) {
  const source = functionSource("sendMessage");
  const cut = source.indexOf("\n    isSendingRef.current = true;");
  assert.ok(cut > 0);
  const events = [], requests = [], views = [], notices = [];
  const env = {
    publicReasoningSummaryEnabled: false, settings: { provider: "custom" }, message: "帮我点外卖",
    turnContextRef: { current: "" }, messageReference: null, normalizeMessageReference: value => value,
    chatAttachmentsRef: { current: [] }, attachmentSafetyEnabled: true,
    isSendingRef: { current: false }, companionInteractionInFlightRef: { current: false },
    statusRefreshAbortRef: { current: null }, setReplyOptionsOpen: () => {},
    voiceBlocksComposer: () => false, voiceStateRef: { current: "idle" },
    window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    accountStorageScope: "fictional-account-A", companionScope: "companion-A", diagnosticScopeKey: () => scope,
    privateMediaScope: scope, takeoutTask: null, isTakeoutOpen: false, takeoutPluginAvailable: () => true,
    takeoutConstraintsRef: { current: { budget: 99 } },
    setTakeoutActivityRequest: request => requests.push(request), changeView: view => views.push(view),
    setIsTakeoutOpen: value => views.push(value), setNotice: value => notices.push(value),
    ...extra,
  };
  const sendPrefix = bind(source.slice(0, cut) + "\n return 'continue-to-chat';\n}", env);
  return { env, events, requests, views, notices, sendPrefix };
}

test("actual sendMessage prefix opens a chat-side ordering sheet and scoped wake before any asynchronous preparation", async () => {
  const h = intentFixture();
  assert.equal(await h.sendPrefix(), "continue-to-chat");
  assert.deepEqual(h.views, ["takeout"]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].accountScope, "fictional-account-A");
  assert.equal(h.requests[0].companionScope, "companion-A");
  assert.equal(h.requests[0].query, "帮我点外卖");
  assert.equal(h.events[0].type, "dengta:takeout-wake");
  assert.deepEqual(h.events[0].detail, { scope });
  assert.equal(h.env.takeoutConstraintsRef.current, null);
});

test("ongoing ordering intent opens existing progress without waking, clearing constraints or sending another chat", async () => {
  const h = intentFixture({ takeoutTask: { scope, status: "working", executing: true } });
  const prior = h.env.takeoutConstraintsRef.current;
  assert.equal(await h.sendPrefix(), undefined);
  assert.deepEqual(h.views, [true]);
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.requests, []);
  assert.equal(h.env.takeoutConstraintsRef.current, prior);
  assert.match(h.notices[0], /任务还在处理中/);
});

test("modal-generated chat retains its explicit local budget and does not open a duplicate sheet", async () => {
  const h = intentFixture({ takeoutTask: { scope, status: "working", executing: false } });
  const prior = h.env.takeoutConstraintsRef.current;
  assert.equal(await h.sendPrefix({ text: "帮我点外卖", preserveComposer: true, takeoutConstraints: { runId: "current-run" } }), "continue-to-chat");
  assert.deepEqual(h.views, []);
  assert.deepEqual(h.requests, []);
  assert.equal(h.env.takeoutConstraintsRef.current, prior);
  assert.equal(h.events.length, 1);
});

test("ordinary chat, unavailable UI and a folded existing sheet do not spawn duplicate ordering panels", async () => {
  for (const [extra, text] of [
    [{ message: "普通的聊天内容" }, "continue-to-chat"],
    [{ takeoutPluginAvailable: () => false }, "continue-to-chat"],
    [{ isTakeoutOpen: true }, "continue-to-chat"],
    [{ accountStorageScope: "" }, "continue-to-chat"],
    [{ companionScope: "" }, "continue-to-chat"],
  ]) {
    const h = intentFixture(extra);
    assert.equal(await h.sendPrefix(), text);
    assert.deepEqual(h.views, []);
    assert.deepEqual(h.requests, []);
  }
});
