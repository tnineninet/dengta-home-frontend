import test from "node:test";
import assert from "node:assert/strict";
import { parseBusinessEvidence, runtimeXctestrun, validateBusinessEvidence } from "../scripts/ios-business-policy.mjs";

const runNonce = "b47eb9ef-34c0-4d5f-8ef5-cdca48b27e80";
const options = { runNonce, mode: "synthetic", safeAreaTop: 59, safeAreaBottom: 34 };
function evidence() {
  return { schemaVersion: 1, runNonce, mode: "synthetic", login: true, restoredSession: true, chatSent: true,
    streamedBeforeTerminal: true, streamComplete: true, personaSaved: true, personaReadBack: true, personaRestored: true,
    memoryOpened: true, settingsOpened: true, composerGeometry: true, logout: true, screenshotCaptured: true,
    phases: ["composer", "send"].map(phase => ({ phase, control: [16, 450, 90, 40], keyboard: [0, 510, 393, 342], window: [0, 0, 393, 852] })) };
}

test("business evidence binds the run and rejects private/unexpected fields", () => {
  assert.deepEqual(validateBusinessEvidence(evidence(), options), evidence());
  for (const change of [e => { e.email = "private@example.invalid"; }, e => { e.phases[0].text = "private"; },
    e => { e.runNonce = "00000000-0000-4000-8000-000000000000"; }, e => { e.chatSent = false; },
    e => { e.streamedBeforeTerminal = false; }, e => { e.screenshotCaptured = false; }, e => { e.login = "true"; }]) {
    const value = evidence(); change(value); assert.throws(() => validateBusinessEvidence(value, options));
  }
});

test("native keyboard evidence rejects clipped, nonnumeric and duplicate phases", () => {
  for (const change of [e => { e.phases[0].control[1] = 490; }, e => { e.phases[1].control[1] = 2; },
    e => { e.phases[1].control[0] = -2; }, e => { e.phases[0].control[2] = NaN; }, e => { e.phases[1].phase = "composer"; }]) {
    const value = evidence(); change(value); assert.throws(() => validateBusinessEvidence(value, options));
  }
});

test("missing and duplicated XCTest receipt cannot pass", () => {
  const line = "DENGTA_BUSINESS_EVIDENCE:" + JSON.stringify(evidence());
  assert.deepEqual(parseBusinessEvidence(`ordinary test activity\n${line}\n`, options), evidence());
  assert.throws(() => parseBusinessEvidence("no receipt", options));
  assert.throws(() => parseBusinessEvidence(`${line}\n${line}`, options));
});

test("live evidence forbids screenshots/global logout and retains streaming gap", () => {
  const value = { ...evidence(), mode: "live", streamedBeforeTerminal: false, logout: false, screenshotCaptured: false };
  assert.equal(validateBusinessEvidence(value, { ...options, mode: "live" }).streamedBeforeTerminal, false);
  for (const key of ["logout", "screenshotCaptured"]) assert.throws(() => validateBusinessEvidence({ ...value, [key]: true }, { ...options, mode: "live" }));
});

test("runtime-only XCTest injection leaves app environment and original document untouched", () => {
  const doc = { TestConfigurations: [{ TestTargets: [{ BlueprintName: "AppUITests", TestBundlePath: "__TESTROOT__/AppUITests.xctest", EnvironmentVariables: { LANG: "en_US" }, UITargetAppEnvironmentVariables: { PUBLIC: "ok" } }] }] };
  const result = runtimeXctestrun(doc, { DENGTA_BUSINESS_PASSWORD: "fixture-secret" });
  const target = result.TestConfigurations[0].TestTargets[0];
  assert.equal(target.EnvironmentVariables.DENGTA_BUSINESS_PASSWORD, "fixture-secret");
  assert.deepEqual(target.UITargetAppEnvironmentVariables, { PUBLIC: "ok" });
  assert.equal(JSON.stringify(doc).includes("fixture-secret"), false);
  assert.throws(() => runtimeXctestrun(doc, { VITE_PASSWORD: "no" }));
  assert.throws(() => runtimeXctestrun({}, {}));
});
