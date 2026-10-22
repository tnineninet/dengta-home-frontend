const OPEN_ENDED_PATTERN =
  /(?:要不要|想不想|愿不愿|好不好|行不行|可以吗|行吗|对吗|是吗|你选|你决定|你说|告诉我|跟我说|和我说|说说|聊聊|接着聊|继续聊|还想|再来|等你|过来|来嘛|想听哪|听哪首|看哪|选哪|哪一|哪个|什么|怎么|为什么|是不是|有没有|会不会|能不能|要不要我|让我|我帮你|我陪你|我等|要是你|就窝|我一边)/u;

function messageText(message) {
  return String(message?.content || "").trim();
}

export function shouldAutoOpenReplyOptions(message) {
  if (!message || message.role !== "assistant") return false;
  if (message.isStreaming) return false;
  const suggestions = message?.tool_calls?.reply_suggestions;
  if (
    Array.isArray(suggestions) &&
    suggestions.length >= 2 &&
    suggestions.every((item) => typeof item === "string" && item.trim())
  ) {
    return true;
  }
  const text = messageText(message);
  if (!text) return false;
  // Explicit questions are the strongest signal.
  if (/[?？]\s*$/u.test(text)) return true;
  // Unfinished invitations / choices / emotional prompts often end with a
  // period, ellipsis, or nothing at all, not a question mark.
  if (/(?:……|\.{3,}|…)\s*$/u.test(text)) return true;
  if (OPEN_ENDED_PATTERN.test(text)) return true;
  return false;
}
