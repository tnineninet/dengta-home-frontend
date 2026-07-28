const CHAT_ERROR_FALLBACK = "模型服务暂时无法完成这次回复，请稍后重试。";
const COMMITTED_CHAT_ERROR_FALLBACK =
  "AI 回复没有完成，但你的消息已经保存，可以稍后重试。";
const MAX_PUBLIC_ERROR_LENGTH = 220;

const PUBLIC_ERROR_BY_CODE = Object.freeze({
  CHAT_GENERATION_IN_PROGRESS: "这条消息已经保存，AI 仍在服务器处理中。",
});

const MARKUP_OR_DOCUMENT_PATTERN =
  /<!doctype|<\/?(?:html|head|body|script|style|pre|code|div|span|table|iframe|svg)\b|&lt;\/?(?:html|body|pre|code)\b/i;
const STACK_OR_CODE_PATTERN =
  /(?:^|\s)(?:traceback|syntaxerror|typeerror|referenceerror|stack(?:trace)?\s*[:=]|at\s+[\w$.<>]+\s*\([^\n]*:\d+:\d+\)|node_modules[\\/]|webpack:\/\/|```|econnrefused|enotfound|fetch failed|sqlstate|permission denied|relation\s+.+\s+does not exist)/i;
const SECRET_PATTERN =
  /(?:authorization\s*[:=]|bearer\s+[a-z0-9._-]{12,}|api[_ -]?key\s*[:=]|cookie\s*[:=]|sk-[a-z0-9_-]{12,}|sb_secret_[a-z0-9_-]+)/i;

function errorCandidate(source) {
  if (typeof source === "string") return source;
  return source?.content || source?.message || source?.detail || "";
}

function stripControlCharacters(value) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || [9, 10, 13].includes(code);
    })
    .join("");
}

export function publicChatErrorMessage(source, fallback = CHAT_ERROR_FALLBACK) {
  const code = String(source?.code || "");
  const safeFallback = PUBLIC_ERROR_BY_CODE[code] || fallback;

  const candidate = stripControlCharacters(errorCandidate(source))
    .replace(/\s+/g, " ")
    .trim();
  if (!candidate) return safeFallback;
  if (candidate.length > MAX_PUBLIC_ERROR_LENGTH) return safeFallback;
  if (/^[{[]/.test(candidate) && /[}\]]$/.test(candidate)) return safeFallback;
  if (
    MARKUP_OR_DOCUMENT_PATTERN.test(candidate) ||
    STACK_OR_CODE_PATTERN.test(candidate) ||
    SECRET_PATTERN.test(candidate)
  ) {
    return safeFallback;
  }
  return candidate;
}

export function sanitizeChatErrorEvent(event = {}) {
  const fallback =
    event.user_message_committed === true
      ? COMMITTED_CHAT_ERROR_FALLBACK
      : CHAT_ERROR_FALLBACK;
  return {
    ...event,
    content: publicChatErrorMessage(event, fallback),
  };
}

export function dismissChatErrorMessage(messages, messageId) {
  return (Array.isArray(messages) ? messages : []).filter(
    (item) => !(item?.id === messageId && item?.chatError === true),
  );
}

export {
  CHAT_ERROR_FALLBACK,
  COMMITTED_CHAT_ERROR_FALLBACK,
  MAX_PUBLIC_ERROR_LENGTH,
};
