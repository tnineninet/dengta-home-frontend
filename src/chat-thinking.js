const STATUS_LABELS = {
  accepted: "服务器已接收本轮消息",
  already_received: "服务器已识别并复用先前保存的消息",
  generation_in_progress: "消息已保存，AI 仍在处理中",
  reading_attachments: "正在读取附件",
  reading_files: "正在读取附件",
  processing_attachments: "正在安全读取附件",
  attachments_ready: "附件已经读取完成",
  organizing_context: "正在整理对话上下文",
  preparing_context: "正在整理对话上下文",
  generating: "正在生成回复",
  calling_model: "正在请求所选模型",
  saving: "正在保存本轮对话",
  completed: "本轮处理完成",
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

export function appendThinkingSummary(current = "", value, limit = 6_000) {
  const previous = removeControlCharacters(current).slice(-limit);
  const chunk = removeControlCharacters(value);
  if (!chunk) return previous;
  return `${previous}${chunk}`.slice(-limit);
}

export function localizedThinkingStatus(value) {
  const text = cleanText(value, 120);
  if (!text) return "";
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return STATUS_LABELS[key] || "";
}

export function appendThinkingStatus(current = [], value) {
  const next = localizedThinkingStatus(value);
  const statuses = Array.isArray(current) ? current.filter(Boolean).slice(-7) : [];
  if (!next || statuses.at(-1) === next) return statuses;
  return [...statuses, next].slice(-8);
}

function moodTone(value) {
  const mood = cleanText(value, 80).toLowerCase();
  if (/疲|累|困|tired|sleepy/.test(mood)) return "tired";
  if (/气|烦|闷|不开心|grumpy|upset|angry|sad/.test(mood)) return "upset";
  if (/害羞|脸红|shy|bashful/.test(mood)) return "shy";
  if (/温|亲密|想念|开心|warm|tender|happy|flirty/.test(mood)) {
    return "warm";
  }
  return "neutral";
}

export function personalizedThinkingStatus(
  value,
  { aiName = "小灯", companionMood = "" } = {},
) {
  const status = cleanText(value, 160);
  if (!status) return "";
  const name = cleanText(aiName, 40) || "小灯";
  const tone = moodTone(companionMood);
  const phrases = {
    "服务器已接收本轮消息": `${name}听见了`,
    "服务器已识别并复用先前保存的消息": `${name}还记得刚才那句话`,
    "消息已保存，AI 仍在处理中": `${name}还在想，没有把这句话忘掉`,
    "正在读取附件": `${name}在看你发来的内容`,
    "正在安全读取附件": `${name}在认真看你发来的内容`,
    "附件已经读取完成": `${name}已经看完你发来的内容`,
    "正在整理对话上下文": `${name}在把前后的话慢慢接起来`,
    "正在生成回复":
      tone === "tired"
        ? `${name}有点累，还是想慢慢回应你`
        : tone === "upset"
          ? `${name}心里有点闷，正在想怎么告诉你`
          : tone === "shy"
            ? `${name}有点不好意思，正在斟酌措辞`
            : tone === "warm"
              ? `${name}在把想对你说的话慢慢理好`
              : `${name}正在想怎么好好回应你`,
    "正在请求所选模型":
      tone === "tired"
        ? `${name}慢慢想一会儿`
        : tone === "upset"
          ? `${name}带着现在的心情想一会儿`
          : tone === "shy"
            ? `${name}悄悄想一会儿`
            : tone === "warm"
              ? `${name}把你的话放在心上想一会儿`
              : `${name}安静想一会儿`,
    "正在保存本轮对话": `${name}把这段对话好好收起来`,
    "本轮处理完成": `${name}想好了`,
  };
  return phrases[status] || status;
}

export function thinkingPanelVisible(message = {}) {
  return (
    (Array.isArray(message.thinkingStatuses) &&
      message.thinkingStatuses.length > 0) ||
    cleanText(message.thinkingSummary, 6_000).length > 0
  );
}

export function thinkingPanelCompleted(message = {}) {
  return (
    message?.isStreaming !== true && message?.generationInProgress !== true
  );
}

function publicMessageFields(message = {}) {
  const safeMessage = { ...message };
  delete safeMessage.reasoningSummary;
  delete safeMessage.reasoning_summary;
  delete safeMessage.reasoning;
  delete safeMessage.reasoning_content;
  delete safeMessage.thinking;
  delete safeMessage.thinking_content;
  if (
    safeMessage.tool_calls &&
    typeof safeMessage.tool_calls === "object" &&
    !Array.isArray(safeMessage.tool_calls)
  ) {
    safeMessage.tool_calls = { ...safeMessage.tool_calls };
    delete safeMessage.tool_calls.reasoningSummary;
    delete safeMessage.tool_calls.reasoning_summary;
    delete safeMessage.tool_calls.reasoning;
    delete safeMessage.tool_calls.reasoning_content;
    delete safeMessage.tool_calls.thinking;
    delete safeMessage.tool_calls.thinking_content;
  }
  return safeMessage;
}

function stageValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value.stage || value.status || value.content || "";
}

function publicStageKey(value) {
  const text = cleanText(stageValue(value), 120);
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return Object.hasOwn(STATUS_LABELS, key) ? key : "";
}

export function hydrateStoredThinkingTrace(message = {}) {
  const storedStages = message?.tool_calls?.processing_stages;
  const source = Array.isArray(storedStages)
    ? storedStages
    : message.thinkingStatuses;
  const thinkingStatuses = Array.isArray(source)
    ? source.reduce(
        (current, stage) =>
          appendThinkingStatus(current, publicStageKey(stage)),
        [],
      )
    : [];

  return {
    ...publicMessageFields(message),
    thinkingStatuses,
  };
}

export function attachThinkingTrace(message = {}, trace = {}) {
  return {
    ...publicMessageFields(message),
    thinkingStatuses: Array.isArray(trace.statuses) ? trace.statuses : [],
    thinkingSummary: cleanText(trace.summary, 6_000),
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
      generationInProgress: false,
      retryAvailable: false,
    },
    trace,
  );
}
