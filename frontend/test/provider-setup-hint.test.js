import assert from "node:assert/strict";
import { providerSetupHint } from "../src/provider-setup-hint.js";

assert.equal(providerSetupHint(null), null, "unknown status must not show a banner");
assert.equal(providerSetupHint({ available: false }), null, "unavailable provider center must not show a banner");
assert.equal(providerSetupHint({ available: true, routable_profiles: 1 }), null, "a routable provider needs no hint");

const empty = providerSetupHint({ available: true, profiles: 0, routable_profiles: 0 });
assert.equal(empty.kind, "empty");
assert.match(empty.text, /自动读取模型并启用/);
assert.equal(empty.actionLabel, "去配置接口");

const disabled = providerSetupHint({ available: true, profiles: 2, routable_profiles: 0, needs_enable: true });
assert.equal(disabled.kind, "disabled");
assert.match(disabled.text, /只有启用的接口/);
assert.equal(disabled.actionLabel, "去启用接口");

const credential = providerSetupHint({
  available: true,
  profiles: 1,
  routable_profiles: 0,
  needs_enable: false,
  credential_reentry_required: true,
});
assert.equal(credential.kind, "credential");
assert.match(credential.text, /重新粘贴 API Key/);

const unroutable = providerSetupHint({ available: true, profiles: 1, routable_profiles: 0 });
assert.equal(unroutable.kind, "unroutable");
assert.match(unroutable.text, /已到期|凭据/);

console.log("provider setup hint tests passed");
