const MAX_SUGGESTION_CHARACTERS = 64;

function replaceControlCharacters(value) {
  return Array.from(String(value || ""), (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
}

function cleanSuggestion(value) {
  return Array.from(
    replaceControlCharacters(value)
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, MAX_SUGGESTION_CHARACTERS + 1)
    .join("");
}

const REFUSAL_PATTERNS = [
  /(?:抱歉|对不起)[，,\s]*(?:我|本模型)?[，,\s]*(?:无法|不能|不可以|不会)/i,
  /(?:我|本模型)[，,\s]*(?:无法|不能|不可以|不会)(?:继续|提供|生成|参与|协助|帮助|回应|回复|处理|满足)/i,
  /(?:平台|政策|规则|安全准则|内容政策)[^。！？\n]{0,32}(?:不允许|禁止|限制|违反|不符合)/i,
  /(?:涉及|属于|包含)[^。！？\n]{0,32}(?:成人|露骨|性内容|NSFW)[^。！？\n]{0,24}(?:内容|角色扮演|场景)/i,
  /(?:聊|说|谈)(?:点|些)?别的|换个话题|聊点别的|其他话题/i,
  /(?:as an AI|I(?:'m| am) sorry,? (?:but )?I (?:can(?:no|')t|am unable))/i
];

function isRefusalSuggestion(value) {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(value));
}

export function normalizeReplySuggestions(value) {
  if (!Array.isArray(value) || value.length !== 2) return [];

  const suggestions = value.map(cleanSuggestion);
  if (
    suggestions.some(
      (item) =>
        !item ||
        Array.from(item).length > MAX_SUGGESTION_CHARACTERS ||
        isRefusalSuggestion(item),
    )
  ) {
    return [];
  }

  const unique = new Set(suggestions.map((item) => item.toLocaleLowerCase()));
  return unique.size === 2 ? suggestions : [];
}

export function readReplySuggestions(message = {}) {
  return normalizeReplySuggestions(message?.tool_calls?.reply_suggestions);
}

export function resolveReplyOptionSeed(message = {}, { fresh = false } = {}) {
  return fresh ? [] : readReplySuggestions(message);
}
