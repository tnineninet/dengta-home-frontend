import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import {
  beginVisibleMonologueStream,
  canRequestVisibleMonologue,
  reduceVisibleMonologueEvent,
  visibleMonologueForMessage,
  VISIBLE_MONOLOGUE_SOURCE,
} from "../src/inner-monologue.js";
import {
  appendPublicProviderSummary,
  appendThinkingStatus,
  mergeStreamedAssistantMessage,
} from "../src/chat-thinking.js";
import {
  clearChatClientMessage,
  isChatGenerationInProgress,
  updateChatClientMessage,
} from "../src/chat-idempotency.js";
import { publicChatErrorMessage, temporaryReplyOnFailure } from "../src/chat-errors.js";
import { settingsSaveScope } from "../src/settings-save-scope.js";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const streamStart = source.indexOf("await streamChat(");
const callbackStart = source.indexOf("        (event) => {", streamStart);
const callbackEnd = source.indexOf("\n        { signal: request.controller.signal },", callbackStart);
assert.ok(streamStart >= 0 && callbackStart > streamStart && callbackEnd > callbackStart,
  "extract the actual App stream callback instead of reproducing its reducer");
const callbackSource = source.slice(callbackStart, callbackEnd).trim().replace(/,$/, "");
const sessionId = "11111111-1111-4111-8111-111111111111";
const savedMessageId = "019c0000-0000-7000-8000-000000000001";
const savedUserId = "019c0000-0000-7000-8000-000000000002";
const localAssistantId = "local-assistant-body-first";
const mono = (content, offset = 0, segment = 0) => ({
  type: "monologue", phase: "delta", source: VISIBLE_MONOLOGUE_SOURCE,
  public: true, content, offset, segment,
});
const endMono = state => ({
  type: "monologue", phase: "end", source: VISIBLE_MONOLOGUE_SOURCE,
  public: true, state,
});
const snapshot = (text, state = "complete") => ({
  schema_version: 1, source: VISIBLE_MONOLOGUE_SOURCE, text, state,
  generated_with_reply: true, segment_count: text ? 1 : 0,
});
const done = (body, monologue = snapshot("Synthetic visible self-report.")) => ({
  type: "done", ok: true,
  assistant_message: {
    id: savedMessageId, conversation_id: sessionId, role: "assistant", content: body,
    speech_token: "synthetic-body-only-token", tool_calls: { visible_monologue: monologue },
  },
});

function harness() {
  let owner = { user: { id: "account-a" }, activeCompanionId: "companion-a" };
  const played = [], receipts = [], writes = [];
  let messages = [{
    id: localAssistantId, role: "assistant", conversation_id: sessionId, content: "",
    created_at: "2026-10-19T12:00:00Z", isStreaming: true,
    visibleMonologue: beginVisibleMonologueStream(),
  }];
  const request = { controller: new AbortController(), clientMessageId: "synthetic-client-message" };
  const env = {
    request, sessionId, localAssistantId, localUserId: "local-user-body-first",
    componentMountedRef: { current: true },
    privateMediaScope: settingsSaveScope(owner),
    authSession: { getSnapshot: () => owner }, settingsSaveScope,
    activeSessionIdRef: { current: sessionId }, chatRequestRef: { current: request },
    streamThinkingRef: { current: { statuses: [], summary: "" } },
    pendingChatClientMessageRef: { current: null },
    userMessageCommitted: true, completedUserMessageId: savedUserId,
    completedAssistantMessageId: "", generationInProgress: false, streamFailed: false,
    voiceAutoSpeakEnabled: true, messageReferenceAtRequest: null,
    appendPublicProviderSummary, appendThinkingStatus, reduceVisibleMonologueEvent,
    mergeStreamedAssistantMessage, VISIBLE_MONOLOGUE_SOURCE,
    publicChatErrorMessage, temporaryReplyOnFailure, isChatGenerationInProgress,
    clearChatClientMessage, updateChatClientMessage,
    flushNow: callback => callback(),
    setMessages(update) { messages = typeof update === "function" ? update(messages) : update; writes.push(messages); },
    applyPromptReceipt(receipt) { receipts.push(receipt); },
    normalizeCompanionActivities: () => [], openCompanionActivity: () => {},
    mergeCompanionStatus: (value, next) => ({ ...value, ...next }), setCompanionStatus: () => {},
    playAssistantReply(...args) { played.push(args); },
  };
  const emit = new Function("env", `with (env) { return (${callbackSource}); }`)(env);
  return { env, emit, played, receipts, writes, get message() { return messages[0]; },
    get messages() { return messages; }, switchOwner(changes) { owner = { ...owner, ...changes }; } };
}

test("the actual App callback receives body before delayed public monologue without replacing either field", () => {
  const h = harness();
  h.emit({ type: "text", content: "在呢乖乖~ 🙂" });
  assert.equal(h.message.content, "在呢乖乖~ 🙂");
  assert.equal(h.message.visibleMonologue.text, "");
  assert.equal(h.message.isStreaming, true);
  assert.equal(h.played.length, 0, "provisional body must not be spoken as a completed answer");
  h.emit(mono("想🙂", 0));
  h.emit(mono("陪你。", 2));
  assert.equal(h.message.content, "在呢乖乖~ 🙂");
  assert.equal(h.message.visibleMonologue.text, "想🙂陪你。");
  assert.equal(h.message.visibleMonologue.stream_offset, 5);
  h.emit(endMono("complete"));
  assert.equal(h.played.length, 0, "even a finished visible thought is not a TTS source");
  h.emit(done("在呢乖乖~ 🙂", snapshot("想🙂陪你。")));
  assert.equal(h.message.content, "在呢乖乖~ 🙂");
  assert.equal(visibleMonologueForMessage(h.message).text, "想🙂陪你。");
  assert.equal(h.message.id, savedMessageId);
  assert.equal(h.message.renderKey, localAssistantId);
  assert.equal(h.message.isStreaming, false);
  assert.equal(canRequestVisibleMonologue(h.message), false);
  assert.deepEqual(h.played[0], ["在呢乖乖~ 🙂", savedMessageId, "synthetic-body-only-token", sessionId]);
});

test("delayed monologue replays use Unicode offsets and segment identity without duplicating body or thoughts", () => {
  const h = harness();
  h.emit({ type: "text", content: "Body" });
  h.emit(mono("想🙂", 0)); h.emit(mono("想🙂", 0));
  h.emit(mono("再想。", 0, 1)); h.emit(mono("再想。", 0, 1));
  h.emit(mono("想🙂", 0));
  assert.equal(h.message.visibleMonologue.text, "想🙂\n\n再想。");
  assert.equal(h.message.visibleMonologue.stream_offset, 3);
  assert.equal(h.message.visibleMonologue.stream_segment, 1);
  assert.equal(h.message.content, "Body");
  h.emit(endMono("complete"));
  h.emit(mono("late", 3, 1));
  assert.equal(h.message.visibleMonologue.text, "想🙂\n\n再想。");
  h.emit(done("Body", snapshot("Authoritative corrected visible self-report.")));
  assert.equal(h.message.visibleMonologue.text, "Authoritative corrected visible self-report.");
  assert.equal(h.message.content, "Body");
});

test("a delayed monologue offset gap never corrupts the already visible body and the final snapshot repairs the thought", () => {
  const h = harness();
  h.emit({ type: "text", content: "Already visible body" });
  h.emit(mono("想🙂", 0));
  h.emit(mono("must not append across a gap", 9));
  assert.equal(h.message.visibleMonologue.text, "想🙂");
  assert.equal(h.message.content, "Already visible body");
  h.emit(done("Already visible body", snapshot("想🙂，现在补齐。")));
  assert.equal(h.message.visibleMonologue.text, "想🙂，现在补齐。");
  assert.equal(h.message.visibleMonologue.state, "complete");
  assert.equal(h.message.content, "Already visible body");
});

test("body-first delivery keeps supplementation disabled while running and unlocks missing or truncated terminal thoughts", () => {
  for (const state of ["missing", "truncated", "failed"]) {
    const h = harness();
    h.emit({ type: "text", content: "Complete body" });
    assert.equal(canRequestVisibleMonologue(h.message), false);
    h.emit(endMono(state));
    assert.equal(canRequestVisibleMonologue(h.message), false, "a monologue terminal is not the turn terminal");
    h.emit(done("Complete body", snapshot(state === "missing" ? "" : "Synthetic partial thought", state)));
    assert.equal(h.message.isStreaming, false);
    assert.equal(h.message.generationInProgress, false);
    assert.equal(canRequestVisibleMonologue(h.message), true);
    assert.equal(h.message.content, "Complete body");
  }
});

test("a body-only success without any monologue end or snapshot settles the thought as missing and enables recovery", () => {
  const h = harness();
  h.emit({ type: "text", content: "Body survived missing monologue" });
  const terminal = done("Body survived missing monologue");
  delete terminal.assistant_message.tool_calls.visible_monologue;
  h.emit(terminal);
  assert.equal(h.message.isStreaming, false);
  assert.equal(h.message.visibleMonologue.state, "missing");
  assert.equal(canRequestVisibleMonologue(h.message), true);
  assert.equal(h.message.content, "Body survived missing monologue");
});

test("an error after early body and monologue cancels provisional completion and never triggers automatic speech", () => {
  const h = harness();
  h.emit({ type: "text", content: "Synthetic partial body" });
  h.emit(mono("Synthetic visible thought."));
  h.emit(endMono("complete"));
  h.emit({ type: "error", code: "provider_stream_incomplete", user_message_committed: true });
  assert.equal(h.message.chatError, true);
  assert.equal(h.message.isStreaming, false);
  assert.equal(h.message.visibleMonologue.state, "failed");
  assert.equal(h.message.partialContent, "Synthetic partial body");
  assert.equal(h.message.monologueUserMessageId, savedUserId);
  assert.equal(canRequestVisibleMonologue(h.message), true);
  h.emit(done("This invalid success must not replace the failure."));
  assert.equal(h.message.chatError, true);
  assert.equal(h.played.length, 0);
  assert.equal(h.env.streamFailed, true);
});

test("provider summaries and raw reasoning fields never become the reply body or visible monologue", () => {
  const h = harness();
  h.emit({ type: "text", content: "Body first" });
  h.emit({ type: "reasoning", source: "provider_summary", public: true, content: "Public summary." });
  h.emit({ type: "reasoning", source: "raw", public: false, content: "Synthetic hidden trace." });
  h.emit({ type: "monologue", phase: "delta", source: "provider_summary", content: "Not a visible monologue" });
  assert.equal(h.message.content, "Body first");
  assert.equal(h.message.visibleMonologue.text, "");
  assert.equal(h.message.thinkingSummary, "Public summary.");
  h.emit(mono("A visible character self-report."));
  h.emit(endMono("complete"));
  h.emit(done("Body first", snapshot("A visible character self-report.")));
  assert.equal(h.played[0][0], "Body first");
  assert.ok(!JSON.stringify(h.message).includes("Synthetic hidden trace."));
});

test("late body, monologue and done cannot cross a session, request, unmount, account or companion boundary", () => {
  for (const change of [
    h => { h.env.activeSessionIdRef.current = "synthetic-other-session"; },
    h => { h.env.chatRequestRef.current = { controller: new AbortController() }; },
    h => h.env.request.controller.abort(),
    h => { h.env.componentMountedRef.current = false; },
    h => h.switchOwner({ user: { id: "account-b" } }),
    h => h.switchOwner({ activeCompanionId: "companion-b" }),
  ]) {
    const h = harness();
    h.emit({ type: "text", content: "Original account body" });
    change(h);
    const before = JSON.stringify(h.message), writes = h.writes.length;
    h.emit({ type: "text", content: " stale body" }); h.emit(mono("Stale thought.")); h.emit(done("Stale completion"));
    assert.equal(JSON.stringify(h.message), before);
    assert.equal(h.writes.length, writes);
    assert.equal(h.played.length, 0);
    assert.equal(h.receipts.length, 0);
  }
});

const previousAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const cachePrefix = join(tmpdir(), "dengta-body-first-monologue-");
const cacheRoot = mkdtempSync(cachePrefix);
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envDir: false,
  cacheDir: join(cacheRoot, "vite"), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
});
const { default: Transcript } = await vite.ssrLoadModule("/src/ChatTranscript.jsx");
const words = value => typeof value === "string" ? value
  : (Array.isArray(value) ? value : value?.children || []).map(words).join("");
after(async () => {
  await vite.close();
  const target = resolve(cacheRoot), parent = resolve(tmpdir());
  assert.ok(target.startsWith(`${parent}${sep}dengta-body-first-monologue-`));
  rmSync(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  if (previousAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
  else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test("the real transcript renders early body before monologue or done, then independently updates the thought and recovery control", async () => {
  const h = harness(); let tree; let pending = {};
  const props = () => ({
    messages: h.messages, preferences: { skin: "classic-glass", reduceMotion: true },
    innerMonologues: {}, innerMonologuePending: pending, innerMonologueErrors: {},
    aiName: "虚构伙伴", onRequestInnerMonologue() {},
  });
  const commit = async () => act(async () => {
    const element = React.createElement(Transcript, props());
    if (tree) tree.update(element); else tree = TestRenderer.create(element);
  });
  try {
    await commit();
    h.emit({ type: "text", content: "Synthetic first body token ~🙂" });
    await commit();
    assert.equal(tree.root.findByProps({ className: "message-content" }).children.join(""), "Synthetic first body token ~🙂");
    assert.ok(!words(tree.toJSON()).includes("Delayed visible thought"));
    assert.ok(tree.root.findAllByType("button").every(button => !words(button).includes("补充这次心声")));
    h.emit(mono("Delayed visible thought.")); await commit();
    assert.ok(words(tree.toJSON()).includes("Delayed visible thought."));
    assert.equal(tree.root.findByProps({ className: "message-content" }).children.join(""), "Synthetic first body token ~🙂");
    h.emit(endMono("truncated"));
    h.emit(done("Synthetic first body token ~🙂", snapshot("Delayed visible thought.", "truncated")));
    await commit();
    let recovery = tree.root.findAllByType("button").find(button => words(button) === "补充这次心声");
    assert.ok(recovery, "an incomplete terminal thought exposes its actual recovery control");
    assert.equal(recovery.props.disabled, false);
    pending = { [savedMessageId]: true }; await commit();
    recovery = tree.root.findAllByType("button").find(button => words(button) === "正在补充心声…");
    assert.equal(recovery.props.disabled, true);
    pending = {}; await commit();
    recovery = tree.root.findAllByType("button").find(button => words(button) === "补充这次心声");
    assert.equal(recovery.props.disabled, false, "settling the separate recovery operation releases the real button");
    assert.equal(h.played[0][0], "Synthetic first body token ~🙂");
  } finally { if (tree) await act(async () => tree.unmount()); }
});
