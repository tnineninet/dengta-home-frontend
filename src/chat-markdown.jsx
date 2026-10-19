// 轻量聊天 Markdown：只处理模型常用的加粗、斜体、删除线、行内代码。
// 未闭合的标记在流式过程中也按对应样式显示，避免用户先看到 **。
const INLINE_PATTERN = /(\*\*[^*\n]+(?:\*\*|$)|__[^_\n]+(?:__|$)|~~[^~\n]+(?:~~|$)|\x60[^\x60\n]+\x60|\*[^*\n]+(?:\*|$)|_[^_\n]+(?:_|$))/g;

function renderInline(text, keyPrefix) {
  const nodes = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const token = match[0];
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = keyPrefix + "-" + index++;
    if (token.startsWith("**") || token.startsWith("__")) {
      const inner = token.replace(/^\*\*|^__/, "").replace(/\*\*$|__$/, "");
      nodes.push(<strong key={key}>{inner}</strong>);
    } else if (token.startsWith("~~")) {
      const inner = token.replace(/^~~/, "").replace(/~~$/, "");
      nodes.push(<del key={key}>{inner}</del>);
    } else if (token.startsWith("\x60")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const inner = token.replace(/^\*|^_/, "").replace(/\*$|_$/, "");
      nodes.push(<em key={key}>{inner}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderChatMarkdown(value) {
  const text = String(value || "");
  if (!text) return null;
  // 逐行保留换行；行内标记交给 renderInline。
  const lines = text.split("\n");
  const nodes = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push("\n");
    nodes.push(...renderInline(line, "l" + index));
  });
  return nodes;
}
