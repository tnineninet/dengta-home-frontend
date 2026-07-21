const STATUS_LABELS = {
  accepted: "服务器已接收本轮消息",
  reading_attachments: "正在读取附件",
  reading_files: "正在读取附件",
  processing_attachments: "正在安全读取附件",
  attachments_ready: "附件已经读取完成",
  organizing_context: "正在整理对话上下文",
  preparing_context: "正在整理对话上下文",
  generating: "正在生成回复",
  calling_model: "正在请求所选模型",
  saving: "正在保存本轮对话",
};

function removeControlCharacters(value) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("");
}

function cleanText(value, limit = 2_000) {
  return removeControlCharacters(value).trim().slice(0, limit);
}

export function localizedThinkingStatus(value) {
  const text = cleanText(value, 120);
  if (!text) return "";
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return STATUS_LABELS[key] || text;
}

export function appendThinkingStatus(current = [], value) {
  const next = localizedThinkingStatus(value);
  const statuses = Array.isArray(current) ? current.filter(Boolean).slice(-7) : [];
  if (!next || statuses.at(-1) === next) return statuses;
  return [...statuses, next].slice(-8);
}

export function appendReasoningSummary(current = "", value) {
  const addition = removeControlCharacters(value);
  if (!addition) return String(current || "");
  return `${String(current || "")}${addition}`.slice(-20_000);
}

export function thinkingPanelVisible(message = {}) {
  const hasReasoning = Boolean(String(message.reasoningSummary || "").trim());
  const hasStatus = Array.isArray(message.thinkingStatuses) && message.thinkingStatuses.length > 0;
  return hasReasoning || hasStatus;
}

export function attachThinkingTrace(message = {}, trace = {}) {
  return {
    ...message,
    thinkingStatuses: Array.isArray(trace.statuses) ? trace.statuses : [],
    reasoningSummary: String(trace.reasoningSummary || ""),
  };
}

export function mergeStreamedAssistantMessage(
  localMessage = {},
  serverMessage = {},
  trace = {},
) {
  return attachThinkingTrace(
    {
      ...localMessage,
      ...serverMessage,
      content: serverMessage?.content ?? localMessage?.content ?? "",
      isStreaming: false,
    },
    trace,
  );
}
