import assert from "node:assert/strict";
import {
  PROMPT_FIELD_LIMITS,
  createSettingsPayload,
  mergeLegacyPromptFields,
  normalizePromptReceipt,
  normalizeSettingsDraft,
  settingsNeedsUnifiedPromptMigration,
  settingsPayloadFingerprint,
} from "../src/settings.js";

const legacy = normalizeSettingsDraft({
  ai_name: "测试昵称",
  system_prompt: "旧版系统规则",
  personality: "旧版人设",
  model: "test-model",
});

assert.equal(legacy.ai_name, "测试昵称");
assert.equal(legacy.system_prompt, "旧版系统规则");
assert.equal(legacy.additional_prompt, "");
assert.equal(legacy.personality, "旧版人设");
assert.equal(legacy.model, "test-model");
assert.equal(legacy.prompt_mode, "unified");
assert.equal(settingsNeedsUnifiedPromptMigration(legacy), false);
assert.equal(
  legacy.unified_system_prompt,
  "【原最高优先级系统提示词】\n旧版系统规则\n\n【原独立人设词】\n旧版人设",
);
assert.equal(
  mergeLegacyPromptFields({
    system_prompt: " 第一层\n",
    additional_prompt: "第二层",
    personality: "第三层 ",
  }),
  "【原最高优先级系统提示词】\n 第一层\n\n\n【原普通补充提示词】\n第二层\n\n【原独立人设词】\n第三层 ",
  "迁移必须保留旧字段中的空格和换行",
);

const alreadyUnified = normalizeSettingsDraft({
  system_prompt: "不能再次合并",
  unified_system_prompt: "已经迁移完成",
  prompt_mode: "unified",
});
assert.equal(alreadyUnified.unified_system_prompt, "已经迁移完成");

const payload = createSettingsPayload({
  ...legacy,
  system_prompt: "系".repeat(PROMPT_FIELD_LIMITS.system_prompt + 10),
  additional_prompt: "补".repeat(PROMPT_FIELD_LIMITS.additional_prompt + 10),
  personality: "人".repeat(PROMPT_FIELD_LIMITS.personality + 10),
  unified_system_prompt: "主".repeat(
    PROMPT_FIELD_LIMITS.unified_system_prompt + 10,
  ),
  intimate_expression_enabled: true,
});

assert.equal(payload.system_prompt.length, PROMPT_FIELD_LIMITS.system_prompt);
assert.equal(
  payload.additional_prompt.length,
  PROMPT_FIELD_LIMITS.additional_prompt,
);
assert.equal(payload.personality.length, PROMPT_FIELD_LIMITS.personality);
assert.equal(
  payload.unified_system_prompt.length,
  PROMPT_FIELD_LIMITS.unified_system_prompt,
);
assert.equal(payload.prompt_mode, "unified");
assert.equal(payload.intimate_expression_enabled, true);

const receipt = normalizePromptReceipt({
  prompt_contract_version: "dengta-prompt-contract-v2",
  backend_request_sent: true,
  transport: "openai-chat-completions",
  provider: "openai-compatible",
  model: "test-model",
  system_instruction_blocks: 7,
  system_message_count: 1,
  system_payload_chars: 560,
  conversation_message_count: 6,
  request_message_count: 7,
  system_prompt_chars: 120,
  additional_prompt_chars: 45,
  personality_chars: 18,
  settings_updated_at: "2026-07-21T11:59:00.000Z",
  applied_at: "2026-07-21T12:00:00.000Z",
  system_prompt: "这个原文不应被复制进回执",
});

assert.deepEqual(receipt, {
  promptContractVersion: "dengta-prompt-contract-v2",
  backendRequestSent: true,
  transport: "openai-chat-completions",
  provider: "openai-compatible",
  model: "test-model",
  systemInstructionBlocks: 7,
  systemMessageCount: 1,
  systemPayloadChars: 560,
  conversationMessageCount: 6,
  requestMessageCount: 7,
  systemPromptChars: 120,
  additionalPromptChars: 45,
  personalityChars: 18,
  settingsUpdatedAt: "2026-07-21T11:59:00.000Z",
  appliedAt: "2026-07-21T12:00:00.000Z",
});
assert.equal("system_prompt" in receipt, false);

const unifiedReceipt = normalizePromptReceipt({
  prompt_architecture: "unified-v1",
  prompt_mode: "unified",
  unified_system_prompt_chars: 4321,
  unified_system_prompt_applied: true,
  intimate_expression_enabled: true,
  backend_request_sent: true,
  delivery: {
    main_system: {
      applied: true,
      source: "unified_system_prompt",
      chars: 4321,
      prompt_text: "不得进入前端回执",
    },
    stable_memory: {
      applied: true,
      count: 8,
      chars: 760,
      position: "after_main_system",
    },
    history: { count: 14, position: "after_stable_memory" },
    dynamic_context: {
      applied: true,
      chars: 92,
      message_count: 1,
      position: "after_history",
    },
  },
});
assert.equal(unifiedReceipt.promptMode, "unified");
assert.equal(unifiedReceipt.unifiedSystemPromptChars, 4321);
assert.equal(unifiedReceipt.unifiedSystemPromptApplied, true);
assert.equal(unifiedReceipt.intimateExpressionEnabled, true);
assert.deepEqual(unifiedReceipt.delivery.stableMemory, {
  applied: true,
  count: 8,
  chars: 760,
  position: "after_main_system",
});
assert.deepEqual(unifiedReceipt.delivery.dynamicContext, {
  applied: true,
  chars: 92,
  messageCount: 1,
  position: "after_history",
});
assert.equal("prompt_text" in unifiedReceipt.delivery.mainSystem, false);

assert.equal(
  normalizePromptReceipt({
    system_prompt_chars: 1,
    additional_prompt_chars: 2,
  }),
  null,
);

const legacyReceipt = normalizePromptReceipt(
  {
    system_prompt_length: 7,
    additional_prompt_length: 8,
    personality_length: 9,
  },
  "2026-07-21T13:00:00.000Z",
);
assert.equal(legacyReceipt.systemPromptChars, 7);
assert.equal(legacyReceipt.additionalPromptChars, 8);
assert.equal(legacyReceipt.personalityChars, 9);
assert.equal(legacyReceipt.settingsUpdatedAt, null);
assert.equal(legacyReceipt.appliedAt, "2026-07-21T13:00:00.000Z");

const preservedConnection = createSettingsPayload({
  ...legacy,
  provider: "openai-compatible",
  api_url: "https://example.invalid/v1",
  model: "test-model",
});
assert.equal(preservedConnection.provider, "openai-compatible");
assert.equal(preservedConnection.api_url, "https://example.invalid/v1");
assert.equal(preservedConnection.model, "test-model");

assert.equal(
  settingsPayloadFingerprint(preservedConnection),
  settingsPayloadFingerprint({ ...preservedConnection }),
);
assert.notEqual(
  settingsPayloadFingerprint(preservedConnection),
  settingsPayloadFingerprint({
    ...preservedConnection,
    unified_system_prompt: "新的输入必须形成新的自动保存版本",
  }),
);

console.log("frontend settings tests passed");
