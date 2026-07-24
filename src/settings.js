export const emptySettings = {
  ai_name: "小灯",
  system_prompt: "",
  additional_prompt: "",
  personality: "",
  prompt_mode: "unified",
  unified_system_prompt: "",
  intimate_expression_enabled: false,
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
  unified_system_prompt: 30000,
  turn_context: 4000,
};

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function textOrFallback(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

const LEGACY_PROMPT_SECTIONS = [
  ["system_prompt", "原最高优先级系统提示词"],
  ["additional_prompt", "原普通补充提示词"],
  ["personality", "原独立人设词"],
];

export function settingsNeedsUnifiedPromptMigration(value) {
  const source = objectOrEmpty(value);
  if (textOrFallback(source.unified_system_prompt).length > 0) return false;
  return LEGACY_PROMPT_SECTIONS.some(
    ([field]) => textOrFallback(source[field]).length > 0,
  );
}

export function mergeLegacyPromptFields(value) {
  const source = objectOrEmpty(value);
  return LEGACY_PROMPT_SECTIONS.flatMap(([field, label]) => {
    const content = textOrFallback(source[field]);
    return content.length > 0 ? [`【${label}】\n${content}`] : [];
  }).join("\n\n");
}

export function normalizeSettingsDraft(value) {
  const source = objectOrEmpty(value);
  const migratedPrompt = settingsNeedsUnifiedPromptMigration(source)
    ? mergeLegacyPromptFields(source)
    : textOrFallback(source.unified_system_prompt);

  return {
    ...emptySettings,
    ...source,
    ai_name: textOrFallback(source.ai_name, emptySettings.ai_name),
    system_prompt: textOrFallback(source.system_prompt),
    additional_prompt: textOrFallback(source.additional_prompt),
    personality: textOrFallback(source.personality),
    prompt_mode: "unified",
    unified_system_prompt: migratedPrompt,
    intimate_expression_enabled:
      source.intimate_expression_enabled === true,
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
    prompt_mode: "unified",
    unified_system_prompt: normalized.unified_system_prompt.slice(
      0,
      PROMPT_FIELD_LIMITS.unified_system_prompt,
    ),
    intimate_expression_enabled:
      normalized.intimate_expression_enabled === true,
  };
}

export function settingsPayloadFingerprint(value) {
  return JSON.stringify(createSettingsPayload(value));
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

function optionalText(value, limit = 80) {
  const text = textOrFallback(value).trim().slice(0, limit);
  return text || null;
}

function deliveryBlock(source, fields) {
  const result = {};
  for (const [target, key, type] of fields) {
    if (type === "boolean") {
      result[target] = source[key] === true;
    } else if (type === "text") {
      result[target] = optionalText(source[key]);
    } else {
      result[target] = firstCharacterCount(source, [key]);
    }
  }
  return result;
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
  const hasLegacyReceipt =
    systemPromptChars === null ||
    additionalPromptChars === null ||
    personalityChars === null
      ? false
      : true;
  const unifiedSystemPromptChars = firstCharacterCount(source, [
    "unified_system_prompt_chars",
  ]);
  const rawDelivery = objectOrEmpty(source.delivery);
  const hasUnifiedReceipt =
    unifiedSystemPromptChars !== null ||
    Boolean(optionalText(source.prompt_architecture)) ||
    Boolean(optionalText(source.prompt_mode)) ||
    Object.keys(rawDelivery).length > 0;

  if (!hasLegacyReceipt && !hasUnifiedReceipt) {
    return null;
  }

  const appliedAt =
    normalizedIsoTime(source.applied_at) ||
    normalizedIsoTime(fallbackAppliedAt) ||
    new Date().toISOString();
  const promptContractVersion =
    textOrFallback(source.prompt_contract_version).trim() || null;
  const transport = textOrFallback(source.transport).trim() || null;
  const provider = textOrFallback(source.provider).trim() || null;
  const model = textOrFallback(source.model).trim() || null;

  const common = {
    promptContractVersion,
    backendRequestSent: source.backend_request_sent === true,
    transport,
    provider,
    model,
    systemInstructionBlocks: firstCharacterCount(source, [
      "system_instruction_blocks",
    ]),
    systemMessageCount: firstCharacterCount(source, [
      "system_message_count",
    ]),
    systemPayloadChars: firstCharacterCount(source, [
      "system_payload_chars",
    ]),
    conversationMessageCount: firstCharacterCount(source, [
      "conversation_message_count",
    ]),
    requestMessageCount: firstCharacterCount(source, [
      "request_message_count",
    ]),
    systemPromptChars,
    additionalPromptChars,
    personalityChars,
    settingsUpdatedAt: normalizedIsoTime(source.settings_updated_at),
    appliedAt,
  };

  if (!hasUnifiedReceipt) return common;

  const mainSystem = objectOrEmpty(rawDelivery.main_system);
  const stableMemory = objectOrEmpty(rawDelivery.stable_memory);
  const history = objectOrEmpty(rawDelivery.history);
  const dynamicContext = objectOrEmpty(rawDelivery.dynamic_context);

  return {
    ...common,
    promptArchitecture: optionalText(source.prompt_architecture),
    promptMode: optionalText(source.prompt_mode),
    unifiedSystemPromptChars,
    unifiedSystemPromptApplied:
      source.unified_system_prompt_applied === true,
    intimateExpressionEnabled:
      source.intimate_expression_enabled === true,
    delivery: {
      mainSystem: deliveryBlock(mainSystem, [
        ["applied", "applied", "boolean"],
        ["source", "source", "text"],
        ["chars", "chars", "count"],
      ]),
      stableMemory: deliveryBlock(stableMemory, [
        ["applied", "applied", "boolean"],
        ["count", "count", "count"],
        ["chars", "chars", "count"],
        ["position", "position", "text"],
      ]),
      history: deliveryBlock(history, [
        ["count", "count", "count"],
        ["position", "position", "text"],
      ]),
      dynamicContext: deliveryBlock(dynamicContext, [
        ["applied", "applied", "boolean"],
        ["chars", "chars", "count"],
        ["messageCount", "message_count", "count"],
        ["position", "position", "text"],
      ]),
    },
  };
}
