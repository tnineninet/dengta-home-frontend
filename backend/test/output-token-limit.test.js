const assert = require("node:assert/strict");
const { clampOutputTokens, withClampedOutputTokens } = require("../services/output-token-limit");

assert.equal(clampOutputTokens(65536, "deepseek-flash"), 32000);
assert.equal(clampOutputTokens(65536, "gpt-4o"), 64000);
assert.equal(clampOutputTokens(65536, "gpt-4"), 4096);
assert.equal(clampOutputTokens(2048, "deepseek-flash"), 2048);
assert.equal(clampOutputTokens(0, "deepseek-flash"), 0);
assert.equal(clampOutputTokens("", "deepseek-flash"), 0);

const settings = withClampedOutputTokens({ model: "deepseek-flash", max_tokens: 65536, ai_name: "伴侣" });
assert.equal(settings.max_tokens, 32000);
assert.equal(settings.model, "deepseek-flash");
assert.equal(settings.ai_name, "伴侣");

console.log("output token limit tests passed");
