import assert from "node:assert/strict";
import {
  PROMPT_FIELD_LIMITS,
  createSettingsPayload,
  normalizePromptReceipt,
  normalizeSettingsDraft,
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

const payload = createSettingsPayload({
  ...legacy,
  system_prompt: "系".repeat(PROMPT_FIELD_LIMITS.system_prompt + 10),
  additional_prompt: "补".repeat(PROMPT_FIELD_LIMITS.additional_prompt + 10),
  personality: "人".repeat(PROMPT_FIELD_LIMITS.personality + 10),
});

assert.equal(payload.system_prompt.length, PROMPT_FIELD_LIMITS.system_prompt);
assert.equal(
  payload.additional_prompt.length,
  PROMPT_FIELD_LIMITS.additional_prompt,
);
assert.equal(payload.personality.length, PROMPT_FIELD_LIMITS.personality);

const receipt = normalizePromptReceipt({
  system_prompt_chars: 120,
  additional_prompt_chars: 45,
  personality_chars: 18,
  settings_updated_at: "2026-07-21T11:59:00.000Z",
  applied_at: "2026-07-21T12:00:00.000Z",
  system_prompt: "这个原文不应被复制进回执",
});

assert.deepEqual(receipt, {
  systemPromptChars: 120,
  additionalPromptChars: 45,
  personalityChars: 18,
  settingsUpdatedAt: "2026-07-21T11:59:00.000Z",
  appliedAt: "2026-07-21T12:00:00.000Z",
});
assert.equal("system_prompt" in receipt, false);

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

console.log("frontend settings tests passed");
