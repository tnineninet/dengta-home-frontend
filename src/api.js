const API_BASE_URL = (
  import.meta.env?.VITE_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

const RETRYABLE_SERVER_STATUSES = new Set([502, 503, 504]);

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function fetchFromApi(path, options = {}) {
  const { timeoutMs = 0, ...requestOptions } = options;
  const method = String(requestOptions.method || "GET").toUpperCase();
  const retryDelays = method === "GET" ? [0, 1500, 4000] : [0];

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt];
    if (delay > 0) await wait(delay);

    let timeoutId;
    let timedOut = false;
    const controller =
      timeoutMs > 0 && !requestOptions.signal ? new AbortController() : null;

    try {
      if (controller) {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...requestOptions,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (
        attempt < retryDelays.length - 1 &&
        RETRYABLE_SERVER_STATUSES.has(response.status)
      ) {
        continue;
      }
      return response;
    } catch (error) {
      if (requestOptions.signal?.aborted) {
        throw error;
      }
      if (timedOut) {
        throw new Error(
          `等待 AI 回应超过 ${Math.ceil(timeoutMs / 1000)} 秒，本次不会自动重复请求。`,
          { cause: error },
        );
      }
      if (attempt === retryDelays.length - 1) break;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw new Error("无法连接 DengTa 服务器，请检查手机网络后重试。");
}

export async function apiRequest(path, options = {}) {
  const response = await fetchFromApi(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.detail || "请求失败，请稍后重试。");
  }

  return data;
}

export function buildStreamChatFormData(
  payload = {},
  FormDataImpl = globalThis.FormData,
) {
  if (!FormDataImpl) {
    throw new Error("当前环境不能发送聊天附件。");
  }

  const formData = new FormDataImpl();
  const fields = {
    message: payload.message,
    session_id: payload.session_id,
    client_time: payload.client_time,
    timezone: payload.timezone,
    emotion_understanding_enabled:
      payload.emotion_understanding_enabled === true ? "true" : "false",
    companion_status:
      typeof payload.companion_status === "string"
        ? payload.companion_status
        : JSON.stringify(payload.companion_status || {}),
    model: payload.model,
  };

  Object.entries(fields).forEach(([name, value]) => {
    formData.append(name, String(value ?? ""));
  });

  Array.from(payload.files || []).forEach((item) => {
    const file = item?.file || item;
    if (!(file instanceof Blob) || file.size === 0) return;
    formData.append("files", file, file.name || item?.name || "附件");
  });

  return formData;
}

export async function streamChat(payload, onEvent, { signal } = {}) {
  const formData = buildStreamChatFormData(payload);
  const response = await fetchFromApi("/chat/stream", {
    method: "POST",
    body: formData,
    signal,
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.detail || "无法开始流式回复。");
  }

  if (!response.body) {
    throw new Error("当前浏览器无法读取流式回复。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError = "";
  let completionEvent = null;

  function processLine(rawLine) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("data:")) return;
    const json = line.slice(5).trim();
    if (!json) return;

    try {
      const event = JSON.parse(json);
      if (event.type === "error") {
        streamError = event.content || event.message || "回复中断。";
      }
      if (event.type === "done") {
        completionEvent = event;
        if (event.ok === false) {
          streamError =
            event.content || event.message || streamError || "回复没有成功完成。";
        }
      }
      onEvent(event);
    } catch {
      // 半截数据会留在 buffer 中；真正损坏的单条事件忽略即可。
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(processLine);
    }

    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);

    if (streamError) {
      throw new Error(streamError);
    }

    if (!completionEvent) {
      throw new Error("回复连接提前结束，服务器没有确认本轮已保存。附件仍保留，可稍后重试。");
    }

    return completionEvent;
  } finally {
    if (signal?.aborted) {
      await reader.cancel(signal.reason).catch(() => {});
    }
    reader.releaseLock();
  }
}

export { API_BASE_URL };
