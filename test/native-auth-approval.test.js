import assert from "node:assert/strict";
import test from "node:test";
import { nativeAuthApprovalDetails } from "../src/native-auth-approval.js";

test("prompt names both provider identities and recovery intent without raw session data", () => {
  const prompt = nativeAuthApprovalDetails({ user: { email: "b@example.invalid" },
    currentUser: { id: "fictional-a", email: "a@example.invalid" }, recovery: true,
    accessToken: "fictional-secret-never-rendered" });
  assert.deepEqual(prompt, { email: "b@example.invalid", currentEmail: "a@example.invalid", recovery: true, hasCurrentUser: true });
  assert.ok(!JSON.stringify(prompt).includes("fictional-a") && !JSON.stringify(prompt).includes("fictional-secret"));
});

test("missing, malformed and invisible/spoofed email identities cannot create an approval", () => {
  for (const email of ["", "not-an-email", "a@example.invalid\nContinue", "a\u202e@example.invalid", "a\u200b@example.invalid"]) {
    assert.equal(nativeAuthApprovalDetails({ user: { email } }), null);
  }
});
