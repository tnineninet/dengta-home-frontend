export const emptySettings = {
  ai_name: "小灯",
  system_prompt: "",
  additional_prompt: "",
  personality: "",
  provider: "custom",
  api_url: "",
  model: "",
  temperature: 0.7,
  context_turns: 20,
  max_tokens: 2048,
  compression_threshold: 12000,
  compression_keep: 20,
  timezone: "Asia/Shanghai",
  push_enabled: false,
  max_push_per_day: 7,
};

export const PROMPT_FIELD_LIMITS = {
  ai_name: 50,
  system_prompt: 12000,
  additional_prompt: 8000,
  personality: 1000,
};

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function textOrFallback(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function normalizeSettingsDraft(value) {
  const source = objectOrEmpty(value);

  return {
    ...emptySettings,
    ...source,
    ai_name: textOrFallback(source.ai_name, emptySettings.ai_name),
    system_prompt: textOrFallback(source.system_prompt),
    additional_prompt: textOrFallback(source.additional_prompt),
    personality: textOrFallback(source.personality),
  };
}

export function createSettingsPayload(value) {
  const normalized = normalizeSettingsDraft(value);
  return {
    ...normalized,
    ai_name: normalized.ai_name.slice(0, PROMPT_FIELD_LIMITS.ai_name),
    system_prompt: normalized.system_prompt.slice(
      0,
      PROMPT_FIELD_LIMITS.system_prompt,
    ),
    additional_prompt: normalized.additional_prompt.slice(
      0,
      PROMPT_FIELD_LIMITS.additional_prompt,
    ),
    personality: normalized.personality.slice(
      0,
      PROMPT_FIELD_LIMITS.personality,
    ),
  };
}

function boundedCharacterCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(1_000_000, Math.round(parsed));
}

function firstCharacterCount(source, keys) {
  for (const key of keys) {
    const parsed = boundedCharacterCount(source[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizedIsoTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizePromptReceipt(value, fallbackAppliedAt) {
  const source = objectOrEmpty(value);
  const systemPromptChars = firstCharacterCount(source, [
    "system_prompt_chars",
    "system_prompt_length",
  ]);
  const additionalPromptChars = firstCharacterCount(source, [
    "additional_prompt_chars",
    "additional_prompt_length",
  ]);
  const personalityChars = firstCharacterCount(source, [
    "personality_chars",
    "personality_length",
  ]);

  if (
    systemPromptChars === null ||
    additionalPromptChars === null ||
    personalityChars === null
  ) {
    return null;
  }

  const appliedAt =
    normalizedIsoTime(source.applied_at) ||
    normalizedIsoTime(fallbackAppliedAt) ||
    new Date().toISOString();

  return {
    systemPromptChars,
    additionalPromptChars,
    personalityChars,
    settingsUpdatedAt: normalizedIsoTime(source.settings_updated_at),
    appliedAt,
  };
}
