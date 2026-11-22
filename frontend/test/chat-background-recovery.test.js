import assert from "node:assert/strict";
import test from "node:test";
import { findRecoveredAssistant, shouldRecoverPendingChat } from "../src/chat-background-recovery.js";

test("recovers an assistant reply by client message id after background suspension", () => {
  const messages = [
    { id: "u1", role: "user", content: "在吗" },
    { id: "a1", role: "assistant", content: "在。", tool_calls: { reply_to_client_message_id: "client-1" } }
  ];
  assert.equal(findRecoveredAssistant(messages, "client-1")?.id, "a1");
  assert.equal(findRecoveredAssistant(messages, "client-2"), null);
});

test("only recovers the active session with a committed or in-progress turn", () => {
  const pending = { clientMessageId: "client-1", sessionId: "s1", userMessageCommitted: true };
  assert.equal(shouldRecoverPendingChat(pending, "s1"), true);
  assert.equal(shouldRecoverPendingChat(pending, "s2"), false);
  assert.equal(shouldRecoverPendingChat({ ...pending, userMessageCommitted: false, generationInProgress: false }, "s1"), false);
});
