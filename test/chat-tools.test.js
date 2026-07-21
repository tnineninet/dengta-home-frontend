import assert from "node:assert/strict";
import {
  CHAT_ATTACHMENT_MAX_FILE_BYTES,
  createAttachmentDraft,
  normalizeMessageAttachments,
  revokeAttachmentDraft,
  validateAttachmentFiles,
} from "../src/chat-attachments.js";
import {
  chooseChatModel,
  normalizeModelsResponse,
  readStoredChatModel,
  storeChatModel,
} from "../src/chat-models.js";
import {
  attachThinkingTrace,
  appendReasoningSummary,
  appendThinkingStatus,
  mergeStreamedAssistantMessage,
  thinkingPanelVisible,
} from "../src/chat-thinking.js";
import { buildStreamChatFormData, streamChat } from "../src/api.js";

function fakeFile(name, type, size) {
  return { name, type, size };
}

{
  const result = validateAttachmentFiles([], [
    fakeFile("照片.jpg", "image/jpeg", 100),
    fakeFile("说明.pdf", "application/pdf", 200),
    fakeFile(
      "资料.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      200,
    ),
    fakeFile("录音.webm", "audio/webm", 300),
  ]);
  assert.equal(result.accepted.length, 4);
  assert.equal(result.rejected.length, 0);
}

{
  const result = validateAttachmentFiles([], [
    fakeFile(
      "不支持.doc",
      "application/msword",
      100,
    ),
    fakeFile(
      "太大.pdf",
      "application/pdf",
      CHAT_ATTACHMENT_MAX_FILE_BYTES + 1,
    ),
  ]);
  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected.join(" "), /暂不支持/);
  assert.match(result.rejected.join(" "), /12MB/);
}

{
  const existing = Array.from({ length: 3 }, (_, index) => ({
    size: 1024,
    name: `${index}.txt`,
  }));
  const result = validateAttachmentFiles(existing, [
    fakeFile("可加入.txt", "text/plain", 100),
    fakeFile("第五个.txt", "text/plain", 100),
  ]);
  assert.equal(result.accepted.length, 1);
  assert.match(result.rejected[0], /最多添加 4 个/);
}

{
  const calls = [];
  const urlApi = {
    createObjectURL() {
      calls.push("create");
      return "blob:preview";
    },
    revokeObjectURL(value) {
      calls.push(`revoke:${value}`);
    },
  };
  const draft = createAttachmentDraft(
    fakeFile("照片.png", "image/png", 12),
    urlApi,
  );
  assert.equal(draft.previewUrl, "blob:preview");
  revokeAttachmentDraft(draft, urlApi);
  assert.deepEqual(calls, ["create", "revoke:blob:preview"]);
}

{
  const normalized = normalizeMessageAttachments(
    [
      { name: "安全.png", type: "image/png", url: "/files/safe.png" },
      { name: "危险.txt", type: "text/plain", url: "javascript:alert(1)" },
    ],
    "https://api.example.com",
  );
  assert.equal(normalized[0].url, "https://api.example.com/files/safe.png");
  assert.equal(normalized[1].url, "");
}

{
  const catalog = normalizeModelsResponse(
    {
      models: ["gpt-a", { id: "gpt-b", label: "模型 B" }, "gpt-a"],
      current_model: "gpt-b",
    },
    "fallback",
  );
  assert.deepEqual(catalog.models, [
    { id: "gpt-a", label: "gpt-a" },
    { id: "gpt-b", label: "模型 B" },
  ]);
  assert.equal(
    chooseChatModel({
      models: catalog.models,
      stored: "missing",
      current: catalog.currentModel,
      fallback: "gpt-a",
    }),
    "gpt-b",
  );
}

{
  assert.equal(
    chooseChatModel({
      models: [],
      stored: "gpt-5.4-mini",
      fallback: "gpt-5.5",
    }),
    "gpt-5.4-mini",
    "模型列表加载期间不能用服务端默认值覆盖设备保存的选择",
  );
}

{
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  storeChatModel("gpt-test", storage);
  assert.equal(readStoredChatModel(storage), "gpt-test");
}

{
  let statuses = appendThinkingStatus([], "reading_attachments");
  statuses = appendThinkingStatus(statuses, "reading_attachments");
  statuses = appendThinkingStatus(statuses, "generating");
  assert.deepEqual(statuses, ["正在读取附件", "正在生成回复"]);
  assert.equal(
    appendThinkingStatus([], "processing_attachments")[0],
    "正在安全读取附件",
  );
  assert.equal(appendReasoningSummary("先", "后"), "先后");
  assert.equal(
    thinkingPanelVisible({ isStreaming: false, thinkingStatuses: statuses }),
    true,
  );
  assert.equal(
    thinkingPanelVisible({ isStreaming: false, reasoningSummary: "摘要" }),
    true,
  );
  const historyMessage = attachThinkingTrace(
    { id: "assistant-1", tool_calls: { resolved_model: "gpt-test" } },
    { statuses, reasoningSummary: "摘要" },
  );
  assert.deepEqual(historyMessage.tool_calls, {
    resolved_model: "gpt-test",
  });
  const mergedMessage = mergeStreamedAssistantMessage(
    { id: "local", content: "流式内容" },
    {
      id: "assistant-1",
      content: "最终内容",
      tool_calls: { response_mode: "custom" },
    },
    { statuses, reasoningSummary: "摘要" },
  );
  assert.deepEqual(mergedMessage.tool_calls, { response_mode: "custom" });
  assert.equal(mergedMessage.content, "最终内容");
}

{
  const first = new File(["图片"], "图片.txt", { type: "text/plain" });
  const second = new File(["声音"], "声音.webm", { type: "audio/webm" });
  const formData = buildStreamChatFormData({
    message: "请看看",
    session_id: "session-1",
    client_time: "2026-07-21 12:00",
    timezone: "Asia/Shanghai",
    emotion_understanding_enabled: true,
    companion_status: { mood: "平静" },
    model: "gpt-test",
    files: [{ file: first }, second],
  });
  assert.equal(formData.get("message"), "请看看");
  assert.equal(formData.get("session_id"), "session-1");
  assert.equal(formData.get("emotion_understanding_enabled"), "true");
  assert.deepEqual(JSON.parse(formData.get("companion_status")), {
    mood: "平静",
  });
  assert.equal(formData.get("model"), "gpt-test");
  assert.equal(formData.getAll("files").length, 2);
}

{
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const events = [];
  let receivedSignal;
  let released = false;
  let readCount = 0;

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async (_url, options) => {
    receivedSignal = options.signal;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: {
        getReader() {
          return {
            async read() {
              readCount += 1;
              if (readCount === 1) {
                return {
                  done: false,
                  value: new TextEncoder().encode(
                    'data: {"type":"text","content":"你好"}\n\n',
                  ),
                };
              }
              return { done: true, value: undefined };
            },
            async cancel() {},
            releaseLock() {
              released = true;
            },
          };
        },
      },
    };
  };

  try {
    const controller = new AbortController();
    await streamChat({}, (event) => events.push(event), {
      signal: controller.signal,
    });
    assert.equal(receivedSignal, controller.signal);
    assert.deepEqual(events, [{ type: "text", content: "你好" }]);
    assert.equal(released, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

{
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let cancelled = false;
  let released = false;

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async (_url, options) => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader() {
        return {
          read() {
            return new Promise((resolve, reject) => {
              if (options.signal.aborted) {
                reject(options.signal.reason);
                return;
              }
              options.signal.addEventListener(
                "abort",
                () => reject(options.signal.reason),
                { once: true },
              );
            });
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {
            released = true;
          },
        };
      },
    },
  });

  try {
    const controller = new AbortController();
    const promise = streamChat({}, () => {}, { signal: controller.signal });
    await Promise.resolve();
    controller.abort(new DOMException("页面已离开", "AbortError"));
    await assert.rejects(promise, { name: "AbortError" });
    assert.equal(cancelled, true);
    assert.equal(released, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

console.log("聊天附件、模型选择、处理摘要与 multipart 契约测试通过。");
