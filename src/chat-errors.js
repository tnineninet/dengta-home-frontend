const CHAT_ERROR_FALLBACK = "模型服务暂时无法完成这次回复，请稍后重试。";
const COMMITTED_CHAT_ERROR_FALLBACK =
  "AI 回复没有完成，但你的消息已经保存，可以稍后重试。";
const MAX_PUBLIC_ERROR_LENGTH = 220;

const PUBLIC_ERROR_BY_CODE = Object.freeze({
  CHAT_GENERATION_IN_PROGRESS: "这条消息已经保存，AI 仍在服务器处理中。",
  MODEL_NOT_AVAILABLE:
    "请求的模型不在当前接口可用列表中 / The requested model is not available from the current API.",
  data_inspection_failed:
    "输入内容未通过模型接口的内容检查 / The input did not pass the model provider's content inspection.",
  provider_error_document:
    "模型接口返回了错误文档，本轮回复未保存 / The model API returned an error document; this reply was not saved.",
  provider_boundary_residue:
    "模型回复被识别为拒答残留，拒答正文未保存 / The model response was identified as refusal residue; the refusal text was not saved.",
});

const MARKUP_OR_DOCUMENT_PATTERN =
  /<!doctype|<\/?(?:html|head|body|script|style|pre|code|div|span|table|iframe|svg)\b|&lt;\/?(?:html|body|pre|code)\b/i;
const STACK_OR_CODE_PATTERN =
  /(?:^|\s)(?:traceback|syntaxerror|typeerror|referenceerror|stack(?:trace)?\s*[:=]|at\s+[\w$.<>]+\s*\([^\n]*:\d+:\d+\)|node_modules[\\/]|webpack:\/\/|```|econnrefused|enotfound|fetch failed|sqlstate|permission denied|relation\s+.+\s+does not exist)/i;
const SECRET_PATTERN =
  /(?:authorization\s*[:=]|bearer\s+[a-z0-9._-]{12,}|api[_ -]?key\s*[:=]|cookie\s*[:=]|sk-[a-z0-9_-]{12,}|sb_secret_[a-z0-9_-]+)/i;
const GENERIC_UPSTREAM_ERROR_PATTERN =
  /^(?:upstream (?:request )?failed|bad gateway|gateway timeout|service unavailable|internal server error)$/i;
const UPSTREAM_PROTOCOL_ERROR_PATTERN =
  /^upstream stream ended (?:without|before) (?:a )?terminal response event$/i;
const CONTENT_INSPECTION_ERROR_PATTERN =
  /(?:data_inspection_failed|input text data may contain inappropriate content)/i;
const SAFE_PROVIDER_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const PUBLIC_ERROR_SOURCES = new Set([
  "upstream_provider_or_gateway",
  "dengta_output_guard",
]);

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

function publicDiagnosticCode(source) {
  const code = String(source?.provider_code || source?.providerCode || "").trim();
  return SAFE_PROVIDER_CODE_PATTERN.test(code) ? code : "";
}

function publicDiagnosticSource(source) {
  const value = String(source?.error_source || source?.errorSource || "").trim();
  return PUBLIC_ERROR_SOURCES.has(value) ? value : "";
}

function publicErrorLocation(source) {
  const location = String(source?.error_location || "").trim();
  return /^[A-Za-z0-9_./-]+:\d+:\d+$/.test(location) ? location : "";
}

function withDiagnostic(message, source) {
  const providerCode = publicDiagnosticCode(source);
  const errorSource = publicDiagnosticSource(source);
  const location = publicErrorLocation(source);
  const hasMetadata = Boolean(
    providerCode ||
      errorSource ||
      source?.provider_phase ||
      source?.upstream_status !== undefined ||
      location,
  );
  if (!hasMetadata) return message;
  const visibleCode = providerCode || String(source?.code || "").trim();
  const status = Number(source?.upstream_status);
  const statusText = Number.isInteger(status) && status >= 100 && status <= 599
    ? `；HTTP / HTTP: ${status}`
    : "";
  const locationText = location ? `；位置 / At: ${location}` : "";
  return `${message}（错误代码 / Code: ${visibleCode || "unknown"}；来源 / Source: ${errorSource || "dengta"}${statusText}${locationText}；日志已记录 / Logged）`;
}

export function isProviderErrorDocument(value) {
  void value;
  return false;
}

export function createProviderTextGuard(options = {}) {
  void options;
  return {
    push(value) {
      return { content: String(value || ""), blocked: false, pending: false };
    },
    finish() {
      return { content: "", blocked: false, pending: false };
    },
    get blocked() { return false; },
  };
}

export function sanitizeStoredChatMessage(message = {}) {
  return message;
}

export function publicChatErrorMessage(source, fallback = CHAT_ERROR_FALLBACK) {
  const code = String(source?.code || "");
  const safeFallback = PUBLIC_ERROR_BY_CODE[code] || fallback;
  if (code && code !== "CHAT_GENERATION_IN_PROGRESS" && PUBLIC_ERROR_BY_CODE[code]) {
    return withDiagnostic(safeFallback, source);
  }

  const candidate = stripControlCharacters(errorCandidate(source))
    .replace(/\s+/g, " ")
    .trim();
  if (!candidate) return safeFallback;
  if (UPSTREAM_PROTOCOL_ERROR_PATTERN.test(candidate)) {
    return withDiagnostic(
      "上游模型流没有正常结束，请重试或检查接口兼容性 / The upstream model stream ended without a terminal response event. Retry or check API compatibility.",
      source,
    );
  }
  if (CONTENT_INSPECTION_ERROR_PATTERN.test(candidate)) {
    return withDiagnostic(PUBLIC_ERROR_BY_CODE.data_inspection_failed, source);
  }
  if (candidate.length > MAX_PUBLIC_ERROR_LENGTH) return withDiagnostic(safeFallback, source);
  if (/^[{[]/.test(candidate) && /[}\]]$/.test(candidate)) return withDiagnostic(safeFallback, source);
  if (
    MARKUP_OR_DOCUMENT_PATTERN.test(candidate) ||
    STACK_OR_CODE_PATTERN.test(candidate) ||
    SECRET_PATTERN.test(candidate) ||
    GENERIC_UPSTREAM_ERROR_PATTERN.test(candidate)
  ) {
    return withDiagnostic(safeFallback, source);
  }
  return withDiagnostic(candidate, source);
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
