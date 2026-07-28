import assert from "node:assert/strict";
import fs from "node:fs";
import { streamChat } from "../src/api.js";
import {
  CHAT_ERROR_FALLBACK,
  dismissChatErrorMessage,
  publicChatErrorMessage,
} from "../src/chat-errors.js";

assert.equal(
  publicChatErrorMessage("<html><pre>provider stack</pre></html>"),
  CHAT_ERROR_FALLBACK,
);
assert.equal(
  publicChatErrorMessage('{"error":{"message":"raw provider response"}}'),
  CHAT_ERROR_FALLBACK,
);
assert.equal(
  publicChatErrorMessage("Authorization: Bearer secret-provider-token"),
  CHAT_ERROR_FALLBACK,
);
assert.equal(publicChatErrorMessage("模型接口等待超时，请稍后重试。"), "模型接口等待超时，请稍后重试。");

assert.deepEqual(
  dismissChatErrorMessage(
    [
      { id: "user", role: "user", content: "原消息" },
      { id: "error", role: "assistant", content: "错误", chatError: true },
    ],
    "error",
  ),
  [{ id: "user", role: "user", content: "原消息" }],
);

const chatMessageSource = fs.readFileSync(
  new URL("../src/ChatMessage.jsx", import.meta.url),
  "utf8",
);
assert.match(chatMessageSource, /aria-label="关闭这条错误提示"/);
assert.match(chatMessageSource, /onDismissError\(item\.id\)/);

async function streamWithEvents(events) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let readCount = 0;

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader() {
        return {
          async read() {
            readCount += 1;
            if (readCount > 1) return { done: true, value: undefined };
            return {
              done: false,
              value: new TextEncoder().encode(
                events
                  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                  .join(""),
              ),
            };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  });

  try {
    return await streamChat({}, () => {});
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

await assert.rejects(
  streamWithEvents([
    {
      type: "error",
      code: "provider_error",
      content:
        "<!doctype html><html><body><pre>UPSTREAM_POLICY_DENIED stack=abc</pre></body></html>",
    },
  ]),
  (error) => {
    assert.equal(error.message, "模型服务暂时无法完成这次回复，请稍后重试。");
    assert.doesNotMatch(
      error.message,
      /<!doctype|<html|<pre>|UPSTREAM_POLICY_DENIED|stack=/i,
    );
    return true;
  },
);

console.log("chat error sanitization tests passed");
