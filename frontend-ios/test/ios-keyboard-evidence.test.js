import assert from "node:assert/strict";
import test from "node:test";
import { validateKeyboardEvidence } from "../scripts/ios-keyboard-evidence.mjs";

const phases = ["login-email", "login-password", "login-submit", "register-confirmation", "register-submit", "forgot-email", "forgot-submit"];
const native = { safeAreaTop: 62, safeAreaBottom: 34 };
const fixture = () => ({ schemaVersion: 1, runNonce: "A0000000-0000-4000-8000-000000000000", submitted: false,
  phases: phases.map(phase => ({ phase, keyboardVisible: true, controlVisible: true, control: [20, 100, 360, 48], keyboard: [0, 530, 402, 344], window: [0, 0, 402, 874] })) });
const output = receipt => `DENGTA_KEYBOARD_EVIDENCE:${JSON.stringify(receipt)}\nTest Case '-[AppUITests.KeyboardSmokeTests testAnonymousKeyboardLayout]' passed (40.0 seconds).\nExecuted 1 test, with 0 failures (0 unexpected)\n`;

test("keyboard evidence requires every real UI phase and safe frame containment", () => {
  assert.equal(validateKeyboardEvidence(output(fixture()), native).phases.length, 7);
  for (const control of [[20, 500, 360, 48], [20, 20, 360, 48], [390, 100, 360, 48], [0, 0, 0, 0]]) {
    const receipt = fixture(); receipt.phases[0].control = control;
    assert.throws(() => validateKeyboardEvidence(output(receipt), native));
  }
});
test("real Simulator keyboard accessibility frame may exclude the bottom system area", () => {
  const receipt = fixture();
  receipt.phases.forEach(phase => { phase.keyboard = [0, 583, 402, 233]; });
  assert.equal(validateKeyboardEvidence(output(receipt), native).phases.length, 7);
  receipt.phases[0].control = [20, 560, 360, 48];
  assert.throws(() => validateKeyboardEvidence(output(receipt), native));
});
test("a skipped/empty UI selection, unobserved keyboard or private field never passes", () => {
  assert.throws(() => validateKeyboardEvidence(output(fixture()).replace("Executed 1 test", "Executed 0 tests"), native));
  assert.throws(() => validateKeyboardEvidence(output(fixture()).replace("passed (", "failed ("), native));
  for (const patch of [{ submitted: true }, { token: "fictional-private" }, { phases: [] }]) {
    assert.throws(() => validateKeyboardEvidence(output({ ...fixture(), ...patch }), native));
  }
  const receipt = fixture(); receipt.phases[1].keyboardVisible = false;
  assert.throws(() => validateKeyboardEvidence(output(receipt), native));
});
