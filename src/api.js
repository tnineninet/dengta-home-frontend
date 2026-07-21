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
    } catch {
      if (timedOut) {
        throw new Error(
          `等待 AI 回应超过 ${Math.ceil(timeoutMs / 1000)} 秒，本次不会自动重复请求。`,
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

export async function streamChat(payload, onEvent) {
  const response = await fetchFromApi("/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

  function processLine(rawLine) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("data:")) return;
    const json = line.slice(5).trim();
    if (!json) return;

    try {
      const event = JSON.parse(json);
      if (event.type === "error") streamError = event.content || "回复中断。";
      onEvent(event);
    } catch {
      // 半截数据会留在 buffer 中；真正损坏的单条事件忽略即可。
    }
  }

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
}

export { API_BASE_URL };
