const KNOWN_TOOL_TAGS = [
  "update_companion_status",
  "select_companion_sticker",
  "select_reply_suggestions",
  "post_moment"
];

function normalizeToolKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const KNOWN_TOOL_KEYS = new Set(KNOWN_TOOL_TAGS.map(normalizeToolKey));

function matchKnownToolMarkup(text, index) {
  const suffix = text.slice(index);
  const match = /^<[|/]?\s*([A-Za-z_][A-Za-z0-9_-]*)/i.exec(suffix);
  if (!match) return null;
  const key = normalizeToolKey(match[1]);
  if (!KNOWN_TOOL_KEYS.has(key)) return null;
  const rest = suffix.slice(match[0].length);
  if (rest === "" || /^[:|\s/>]/.test(rest)) return { partial: rest === "" };
  return null;
}

function findTagEnd(text, start) {
  const name = /^<\s*([A-Za-z_][A-Za-z0-9_-]*)/.exec(text.slice(start))?.[1] || "";
  const closeMarker = name ? `</${name.toLowerCase()}` : "";
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ">" && (text[index - 1] === "/" || text[index - 1] === "|")) return index + 1;
    if (closeMarker && char === "<" && text.slice(index).toLowerCase().startsWith(closeMarker)) {
      const closeEnd = text.indexOf(">", index);
      if (closeEnd >= 0) return closeEnd + 1;
    }
  }
  return -1;
}

function knownAt(text, index) {
  return matchKnownToolMarkup(text, index) !== null;
}

// 历史消息里可能已经保存了模型误输出的工具标记；渲染时再做一次显示层清理。
export function stripLegacyToolMarkupForDisplay(value) {
  const source = String(value || "");
  let output = "";
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf("<", index);
    if (start < 0) { output += source.slice(index); break; }
    output += source.slice(index, start);
    const suffix = source.slice(start);
    if (/^<\s*\/?\s*toolcall\b/i.test(suffix)) {
      const closeEnd = suffix.indexOf(">");
      if (closeEnd >= 0) { index = start + closeEnd + 1; continue; }
      index = start + 1;
      continue;
    }
    if (/^<\s*function\s*=/i.test(suffix)) {
      const end = findTagEnd(source, start);
      if (end < 0) { index = start + 1; continue; }
      index = end;
      continue;
    }
    if (!knownAt(source, start)) { output += "<"; index = start + 1; continue; }
    const end = findTagEnd(source, start);
    if (end < 0) { index = source.length; break; }
    index = end;
  }
  return output.replace(/\n{3,}/g, "\n\n").trim();
}

export { KNOWN_TOOL_TAGS };
