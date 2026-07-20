const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
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
  const response = await fetch(`${API_BASE_URL}/chat/stream`, {
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
