import assert from "node:assert/strict";
import { describeOperationError } from "../src/operation-error-help.js";
assert.match(describeOperationError({ error_code: "provider_balance_insufficient" }).reason, /余额不足/);
assert.equal(describeOperationError({ code: "provider_balance_insufficient" }).settingsCategory, "services");
assert.match(describeOperationError({ code: "provider_quota_exhausted" }).reason, /不一定是余额不足/);
assert.match(describeOperationError({ code: "provider_context_exceeded" }).reason, /上游/);
assert.match(describeOperationError({ status: 413 }).action, /保留原文/);
assert.match(describeOperationError({ status: 401 }).action, /重新登录/);
assert.match(describeOperationError({ code: "private_media_refresh_failed" }).action, /避免重复/);
assert.match(describeOperationError({ code: "unknown", message: "secret private upstream body" }).reason, /尚未指出具体原因/);
assert.equal(JSON.stringify(describeOperationError({ code: "unknown", message: "secret private upstream body" })).includes("secret"), false);
assert.equal(describeOperationError({ code: "sb_secret_fictional_not_a_real_key" }).code, "unknown");
for (const code of ["constructor", "__proto__", "toString"]) {
  assert.match(describeOperationError({ code }).reason, /尚未指出具体原因/);
  assert.match(describeOperationError({ code }).action, /展开技术详情/);
}
console.log("Operation error explanations keep causes separate, preserve unknowns and never expose upstream text.");
