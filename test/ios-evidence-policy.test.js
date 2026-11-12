import assert from "node:assert/strict";
import test from "node:test";
import { validateKeychainReceipt, validateUiReceipt, mayCaptureAnonymousScreen } from "../scripts/ios-evidence-policy.mjs";

const nonce = "A0000000-0000-4000-8000-000000000000";
const keychain = () => ({ schemaVersion: 1, runNonce: nonce, events: [
  { stage: "bridge-created" }, { stage: "bridge-keychain-available" }, { stage: "protected-data-available" },
  { stage: "probe-add", status: 0 }, { stage: "probe-read", status: 0 }, { stage: "probe-roundtrip", verified: true },
  { stage: "probe-delete", status: 0 }, { stage: "probe-deleted-read", status: -25300 },
] });
const ui = () => ({ schemaVersion: 2, runNonce: nonce, sample: 12, state: "anonymous", ready: true, controls: true, blocked: false,
  keyboardOpen: false, androidMarker: false, apkEntry: false, viewportHeight: 844, viewportOffsetTop: 0, innerHeight: 844, safeAreaTop: 59, safeAreaBottom: 34 });

test("native probe requires real add/read/delete/read-after-delete and verified bytes", () => {
  assert.equal(validateKeychainReceipt(keychain(), nonce).passed, true);
  for (const stage of ["probe-add", "probe-read", "probe-delete", "probe-deleted-read", "probe-roundtrip", "protected-data-available", "bridge-keychain-available"]) {
    const receipt = keychain(); receipt.events = receipt.events.filter(event => event.stage !== stage);
    assert.equal(validateKeychainReceipt(receipt, nonce).passed, false, stage);
  }
  const missingEntitlement = keychain(); missingEntitlement.events.find(event => event.stage === "probe-add").status = -34018;
  assert.equal(validateKeychainReceipt(missingEntitlement, nonce).passed, false);
  const noRoundtrip = keychain(); noRoundtrip.events.find(event => event.stage === "probe-roundtrip").verified = false;
  assert.equal(validateKeychainReceipt(noRoundtrip, nonce).passed, false);
});

test("receipt parser rejects stale launches and any extra potentially private fields", () => {
  for (const validate of [validateKeychainReceipt, validateUiReceipt]) {
    const receipt = validate === validateKeychainReceipt ? keychain() : ui();
    assert.throws(() => validate(receipt, "different-launch"));
    assert.throws(() => validate({ ...receipt, token: "fictional-private-value" }, nonce), error => !error.message.includes("fictional"));
  }
  for (const event of [{ stage: "keychain-read", value: "fictional-private" }, { stage: "unknown" }, { stage: "probe-add", status: "0" }]) {
    const receipt = keychain(); receipt.events.push(event); assert.throws(() => validateKeychainReceipt(receipt, nonce));
  }
});

test("login readiness excludes error/loading/unknown/account states and malformed geometry", () => {
  assert.equal(validateUiReceipt(ui(), nonce).passed, true);
  for (const state of ["loading", "unconfigured", "error", "expired", "unknown", "authenticated", "recovery", "authenticating"]) {
    assert.equal(validateUiReceipt({ ...ui(), state }, nonce).passed, false);
  }
  for (const patch of [{ ready: false }, { controls: false }, { blocked: true }, { androidMarker: true }, { apkEntry: true }, { viewportHeight: 0 }]) {
    assert.equal(validateUiReceipt({ ...ui(), ...patch }, nonce).passed, false);
  }
  for (const patch of [{ viewportHeight: NaN }, { viewportHeight: -1 }, { safeAreaTop: "59" }, { ready: "true" }]) assert.throws(() => validateUiReceipt({ ...ui(), ...patch }, nonce));
});

test("screenshots are refused for unknown or possibly authenticated state", () => {
  for (const state of ["authenticated", "recovery", "authenticating", "unknown"]) assert.equal(mayCaptureAnonymousScreen({ state }), false);
  assert.equal(mayCaptureAnonymousScreen(null), false);
  assert.equal(mayCaptureAnonymousScreen({ state: "anonymous" }), true);
});
