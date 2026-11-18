import assert from "node:assert/strict";
import test from "node:test";
import { createLiveGuard } from "../scripts/ios-business-live.mjs";

const AUTH = "https://nyyqizwrlmejpfdhgrnd.supabase.co";
const API = "https://dengta-home-backend-rkmq.onrender.com";
const USER = "11111111-1111-4111-8111-111111111111";
const COMPANION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const NONCE = "55555555-5555-4555-8555-555555555555";
const TITLE = `[iOS CI ${NONCE}]`;
const EDITS = { unified_system_prompt: " synthetic instruction\n", user_details: " synthetic detail\r\n" };
const SECRET = "fictional-sensitive-upstream-detail";

function fixture(options = {}) {
  const original = {
    id: OTHER, user_id: USER, companion_id: COMPANION, created_at: "2026-01-01", updated_at: "2026-01-01",
    ai_name: "Synthetic", account_role: "member", account_status: "active", prompt_mode: "legacy",
    unified_system_prompt: "", user_details: " original detail\r\n", system_prompt: " legacy system\n",
    additional_prompt: "legacy additional", personality: "legacy personality", intimate_expression_enabled: false,
    model: "synthetic-model", provider_private_setting: { enabled: true }, ...options.settings,
  };
  let settings = structuredClone(original), sessions = structuredClone(options.sessions || []), reads = 0;
  const calls = [];
  const mutationHeader = method => Object.hasOwn(options.mutationHeaders || {}, method) ? options.mutationHeaders[method] : COMPANION;
  const response = (body, status = 200, companion = COMPANION) => new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...(companion ? { "X-DengTa-Companion-Id": companion } : {}) },
  });
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url); calls.push({ ...init, url, path: parsed.pathname });
    assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.equal(init.cache, "no-store");
    if (options.fetchError) throw new Error(SECRET);
    if (parsed.pathname === "/auth/v1/token") {
      assert.equal(parsed.searchParams.get("grant_type"), "password");
      assert.deepEqual(JSON.parse(init.body), { email: "synthetic@example.invalid", password: "fictional-password" });
      return response({ access_token: "fictional-access-token", user: { id: options.loginId || USER } });
    }
    if (parsed.pathname === "/auth/v1/logout") {
      assert.equal(parsed.searchParams.get("scope"), "local");
      return response({}, options.revokeStatus || 204);
    }
    assert.equal(init.headers.Authorization, "Bearer fictional-access-token");
    if (parsed.pathname === "/api/v2/bootstrap") {
      reads++; await options.onRead?.(settings, sessions, reads);
      settings.updated_at = `server-read-${reads}`;
      return response({ settings, sessions, state: {} }, 200, options.companionAtRead ? options.companionAtRead(reads) : COMPANION);
    }
    assert.equal(init.headers["X-DengTa-Companion-Id"], COMPANION);
    if (parsed.pathname === "/api/v2/sessions" && init.method === "POST") {
      assert.deepEqual(JSON.parse(init.body), { title: TITLE });
      const session = { id: SESSION, title: TITLE }; sessions.push(session);
      if (options.lostCreate) throw new Error(SECRET);
      return response({ session: options.createReceipt || session }, 201, mutationHeader("POST"));
    }
    if (parsed.pathname === "/api/v2/settings" && init.method === "PUT") {
      if (options.restoreStatus) return response({ message: SECRET }, options.restoreStatus);
      settings = { ...settings, ...JSON.parse(init.body), updated_at: "server-write" };
      options.onRestore?.(settings);
      if (options.lostRestore) throw new Error(SECRET);
      return response({ settings }, 200, mutationHeader("PUT"));
    }
    if (parsed.pathname === `/api/v2/sessions/${SESSION}` && init.method === "DELETE") {
      if (options.deleteStatus) return response({ message: SECRET }, options.deleteStatus);
      sessions = sessions.filter(session => session.id !== SESSION);
      if (options.lostDelete) throw new Error(SECRET);
      return response(null, 204, mutationHeader("DELETE"));
    }
    throw new Error(SECRET);
  };
  const config = { authUrl: AUTH, apiUrl: API, anonKey: "fictional-anon-key", email: "synthetic@example.invalid",
    password: "fictional-password", expectedUserId: USER, runNonce: NONCE, fetchImpl };
  return { config, calls, original, guard: createLiveGuard(config),
    change: values => { settings = { ...settings, ...values }; },
    sessions: values => { sessions = structuredClone(values); }, current: () => structuredClone({ settings, sessions }) };
}
const code = expected => error => {
  assert.equal(error.name, "IOSBusinessLiveError"); assert.equal(error.code, expected); assert.equal(error.message, expected);
  assert.doesNotMatch(JSON.stringify(error), /fictional-sensitive|fictional-password|fictional-access-token|synthetic@example|legacy system/);
  return true;
};
const writes = f => f.calls.filter(call => ["PUT", "DELETE"].includes(call.method));
const creates = f => f.calls.filter(call => call.path === "/api/v2/sessions" && call.method === "POST");
const changePersona = f => f.change({ ...EDITS, prompt_mode: "unified" });

test("pins explicit UUID and exact HTTPS origins before network access", () => {
  const f = fixture();
  for (const value of [undefined, "", "not-a-user"]) assert.throws(() => createLiveGuard({ ...f.config, expectedUserId: value }), code("dedicated_user_id_required"));
  for (const [key, value] of [["authUrl", "http://nyyqizwrlmejpfdhgrnd.supabase.co"], ["authUrl", `${AUTH}/auth/v1`],
    ["apiUrl", `${API}.evil.example`], ["apiUrl", `${API}/?secret=1`], ["apiUrl", `${API}/#secret`],
    ["apiUrl", "https://name:password@dengta-home-backend-rkmq.onrender.com"]]) {
    assert.throws(() => createLiveGuard({ ...f.config, [key]: value }), code("production_origin_required"));
  }
  assert.equal(f.calls.length, 0);
});

test("preflight ignores server metadata changes but pins the editable baseline and companion", async () => {
  const f = fixture();
  assert.deepEqual(await f.guard.preflight(), { schemaVersion: 1, dedicatedIdentityMatched: true, memberActive: true, companionPinned: true, emptySessionBaseline: true });
  const reads = f.calls.filter(call => call.path === "/api/v2/bootstrap");
  assert.equal(reads.length, 2); assert.equal(reads[0].headers["X-DengTa-Companion-Id"], undefined);
  assert.equal(reads[1].headers["X-DengTa-Companion-Id"], COMPANION);
  await f.guard.verifyBaseline(); await f.guard.close();
});
for (const settings of [{ account_role: "owner" }, { account_role: "admin" }, { account_role: undefined },
  { account_status: "suspended" }, { account_status: undefined }]) {
  test(`keeps current role/status restriction ${JSON.stringify(settings)}`, async () => {
    const f = fixture({ settings }); await assert.rejects(f.guard.preflight(), code("dedicated_member_required"));
    assert.equal(f.calls.filter(call => call.path === "/auth/v1/logout").length, 1);
    assert.equal(writes(f).length + creates(f).length, 0);
  });
}
test("close is idempotent and revokes only this guard, never the separate native login", async () => {
  const f = fixture(); assert.throws(() => f.guard.runtimeBaseline(), code("live_preflight_required")); await f.guard.preflight();
  const baseline = f.guard.runtimeBaseline(); baseline.user_details = "mutated copy";
  assert.equal(f.guard.runtimeBaseline().user_details, f.original.user_details);
  assert.deepEqual(await f.guard.close(), { schemaVersion: 1, guardSessionRevoked: true, nativeSessionRevoked: false });
  await f.guard.close(); assert.equal(f.calls.filter(call => call.path === "/auth/v1/logout").length, 1);
});
test("401 never proves server revocation, including rejected preflight", async () => {
  const accepted = fixture({ revokeStatus: 401 }); await accepted.guard.preflight();
  await assert.rejects(accepted.guard.close(), code("auth_revoke_failed"));
  const rejected = fixture({ revokeStatus: 401, settings: { account_role: "owner" } });
  await assert.rejects(rejected.guard.preflight(), code("dedicated_member_required"));
  await assert.rejects(rejected.guard.close(), code("auth_revoke_failed"));
});
test("rejects wrong identity and existing history before business writes", async () => {
  const mismatch = fixture({ loginId: OTHER }); await assert.rejects(mismatch.guard.preflight(), code("dedicated_identity_mismatch"));
  assert.equal(mismatch.calls.some(call => call.path.startsWith("/api/")), false);
  const history = fixture({ sessions: [{ id: SESSION, title: SECRET }] });
  await assert.rejects(history.guard.preflight(), code("dedicated_history_not_empty")); assert.equal(writes(history).length, 0);
});
test("rejects missing/changing companion and unstable editable settings", async () => {
  for (const companionAtRead of [() => null, index => index === 1 ? COMPANION : OTHER]) {
    const f = fixture({ companionAtRead }); await assert.rejects(f.guard.preflight(), code("companion_binding_invalid")); assert.equal(writes(f).length, 0);
  }
  const f = fixture({ onRead: (settings, sessions, index) => { if (index === 2) settings.model = "peer"; } });
  await assert.rejects(f.guard.preflight(), code("baseline_unstable"));
});
test("deletes only an acknowledged created ID/marker and preserves concurrent foreign sessions", async () => {
  const f = fixture(); await f.guard.preflight(); await f.guard.createOwnedSession();
  assert.deepEqual(f.guard.runtimeSession(), { id: SESSION, title: TITLE });
  f.sessions([{ id: SESSION, title: TITLE }, { id: OTHER, title: "Concurrent unrelated session" }]);
  assert.equal((await f.guard.recordCreatedSessions()).createdSessionCount, 1);
  const cleaned = await f.guard.restoreAndCleanup({ appStopped: true });
  assert.equal(cleaned.cleanupVerified, true); assert.equal(cleaned.createdSessionDeleted, true);
  assert.throws(() => f.guard.runtimeSession(), code("owned_session_required"));
  assert.deepEqual(f.current().sessions, [{ id: OTHER, title: "Concurrent unrelated session" }]);
  assert.equal(creates(f).length, 1); assert.equal(writes(f).filter(call => call.method === "DELETE").length, 1);
  assert.doesNotMatch(JSON.stringify(cleaned), /11111111|22222222|33333333|44444444|55555555|iOS CI/); await f.guard.close();
});
test("never infers ownership even for a sole unfamiliar session", async () => {
  const f = fixture(); await f.guard.preflight(); f.sessions([{ id: SESSION, title: TITLE }]);
  assert.equal((await f.guard.recordCreatedSessions()).createdSessionCount, 0);
  assert.throws(() => f.guard.runtimeSession(), code("owned_session_required"));
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete"));
  assert.equal(writes(f).length + creates(f).length, 0); await f.guard.close();
});
test("lost/malformed creation responses remain uncertain, without retry or inferred deletion", async () => {
  for (const options of [{ lostCreate: true }, { createReceipt: { id: SESSION, title: "wrong marker" } }]) {
    const f = fixture(options); await f.guard.preflight();
    await assert.rejects(f.guard.createOwnedSession(), code(options.lostCreate ? "live_api_request_failed" : "owned_session_receipt_invalid"));
    await assert.rejects(f.guard.createOwnedSession(), code("owned_session_creation_already_attempted"));
    await assert.rejects(f.guard.recordCreatedSessions(), code("owned_session_creation_uncertain"));
    await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete"));
    assert.equal(creates(f).length, 1); assert.equal(writes(f).length, 0); await f.guard.close();
  }
});
test("creation requires a valid nonce and a fresh absent marker", async () => {
  const f = fixture(); const guard = createLiveGuard({ ...f.config, runNonce: "" }); await guard.preflight();
  await assert.rejects(guard.createOwnedSession(), code("owned_session_nonce_required")); assert.equal(creates(f).length, 0); await guard.close();
  const duplicate = fixture(); await duplicate.guard.preflight(); duplicate.sessions([{ id: OTHER, title: TITLE }]);
  await assert.rejects(duplicate.guard.createOwnedSession(), code("owned_session_marker_conflict")); assert.equal(creates(duplicate).length, 0); await duplicate.guard.close();
});
test("invalid/baseline create IDs or unbound POST responses remain uncertain without deletion", async () => {
  for (const options of [{ createReceipt: { id: "invalid", title: TITLE } },
    { createReceipt: { id: OTHER, title: TITLE } }, { mutationHeaders: { POST: null } }, { mutationHeaders: { POST: OTHER } }]) {
    const f = fixture(options); await f.guard.preflight(); f.sessions([{ id: OTHER, title: "Existing foreign metadata" }]);
    await assert.rejects(f.guard.createOwnedSession(), code(options.mutationHeaders ? "companion_binding_invalid" : "owned_session_receipt_invalid"));
    await assert.rejects(f.guard.createOwnedSession(), code("owned_session_creation_already_attempted"));
    await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete"));
    assert.equal(creates(f).length, 1); assert.equal(writes(f).length, 0); await f.guard.close();
  }
});
test("an acknowledged create followed by a failed first read retains only that ID for later cleanup", async () => {
  const f = fixture({ onRead: (settings, sessions, index) => { if (index === 4) throw new Error(SECRET); } });
  await f.guard.preflight(); await assert.rejects(f.guard.createOwnedSession(), code("live_api_request_failed"));
  assert.throws(() => f.guard.runtimeSession(), code("owned_session_required"));
  await assert.rejects(f.guard.createOwnedSession(), code("owned_session_creation_already_attempted"));
  f.sessions([{ id: SESSION, title: TITLE }, { id: OTHER, title: "Concurrent unrelated session" }]);
  assert.equal((await f.guard.restoreAndCleanup({ appStopped: true })).cleanupVerified, true);
  assert.equal(creates(f).length, 1); assert.deepEqual(f.current().sessions, [{ id: OTHER, title: "Concurrent unrelated session" }]);
  await f.guard.close();
});
test("unbound restoration/delete responses cannot produce successful cleanup receipts", async () => {
  for (const method of ["PUT", "DELETE"]) {
    const f = fixture({ mutationHeaders: { [method]: null } }); await f.guard.preflight(); await f.guard.createOwnedSession();
    await f.guard.planPersonalization(EDITS); changePersona(f);
    await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), error => {
      code("cleanup_incomplete")(error); assert.equal(error.receipt.cleanupVerified, false); return true;
    }); await f.guard.close();
  }
});
test("a failed fresh marker readback cannot expose a runtime selection target", async () => {
  const f = fixture({ onRead: (settings, sessions, index) => { if (index === 4) sessions[0].title = "Unexpected rename"; } });
  await f.guard.preflight(); await assert.rejects(f.guard.createOwnedSession(), code("owned_session_conflict"));
  assert.throws(() => f.guard.runtimeSession(), code("owned_session_required"));
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete"));
  assert.equal(writes(f).length, 0); await f.guard.close();
});
test("a failed fresh bootstrap invalidates a previously verified runtime target", async () => {
  const f = fixture({ onRead: (settings, sessions, index) => { if (index === 5) throw new Error(SECRET); } });
  await f.guard.preflight(); await f.guard.createOwnedSession(); assert.equal(f.guard.runtimeSession().id, SESSION);
  await assert.rejects(f.guard.recordCreatedSessions(), code("live_api_request_failed"));
  assert.throws(() => f.guard.runtimeSession(), code("owned_session_required"));
  await f.guard.recordCreatedSessions(); assert.equal(f.guard.runtimeSession().id, SESSION);
  await f.guard.restoreAndCleanup({ appStopped: true });
  assert.throws(() => f.guard.runtimeSession(), code("owned_session_required")); await f.guard.close();
});
test("lost DELETE response can be rechecked without deleting a new foreign session", async () => {
  const f = fixture({ lostDelete: true }); await f.guard.preflight(); await f.guard.createOwnedSession();
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete"));
  f.sessions([{ id: OTHER, title: "Concurrent unrelated session" }]);
  const checked = await f.guard.restoreAndCleanup({ appStopped: true });
  assert.equal(checked.cleanupVerified, true); assert.equal(checked.createdSessionDeleted, false);
  assert.equal(writes(f).filter(call => call.method === "DELETE").length, 1);
  assert.deepEqual(f.current().sessions, [{ id: OTHER, title: "Concurrent unrelated session" }]); await f.guard.close();
});
test("lost restoration response is rechecked without a second PUT of old values", async () => {
  const f = fixture({ lostRestore: true }); await f.guard.preflight(); await f.guard.planPersonalization(EDITS); changePersona(f);
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete"));
  assert.equal((await f.guard.restoreAndCleanup({ appStopped: true })).cleanupVerified, true);
  assert.equal(writes(f).filter(call => call.method === "PUT").length, 1); await f.guard.close();
});
test("renamed owned conversations are preserved and cannot pass cleanup", async () => {
  const f = fixture(); await f.guard.preflight(); await f.guard.createOwnedSession(); f.sessions([{ id: SESSION, title: "Legitimate rename" }]);
  await assert.rejects(f.guard.recordCreatedSessions(), code("owned_session_conflict"));
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete")); assert.equal(writes(f).length, 0); await f.guard.close();
});
test("plans exact edits before UI mutation and restores only changed fields, excluding all metadata", async () => {
  const f = fixture(); await f.guard.preflight(); await f.guard.createOwnedSession();
  const edits = structuredClone(EDITS); await f.guard.planPersonalization(edits); edits.user_details = "mutated copy"; changePersona(f);
  assert.equal((await f.guard.verifySettings(EDITS)).settingsReadback, true);
  await assert.rejects(f.guard.restoreAndCleanup(), code("app_stop_required")); assert.equal(writes(f).length, 0);
  assert.deepEqual(await f.guard.restoreAndCleanup({ appStopped: true }), { schemaVersion: 1, settingsRestored: true,
    ownedSessionAbsent: true, createdSessionDeleted: true, cleanupVerified: true, settingsConflict: false });
  const body = JSON.parse(writes(f).find(call => call.method === "PUT").body);
  assert.deepEqual(body, { unified_system_prompt: "", user_details: f.original.user_details, prompt_mode: "legacy" });
  assert.equal(f.current().settings.system_prompt, f.original.system_prompt);
  assert.deepEqual(f.current().settings.provider_private_setting, f.original.provider_private_setting);
  await f.guard.verifyBaseline(); await f.guard.close();
});
test("invalid/changed plans and verification without prior planning fail closed", async () => {
  const f = fixture(); await f.guard.preflight();
  await assert.rejects(f.guard.planPersonalization({ provider: "other" }), code("personalization_expectation_invalid"));
  await assert.rejects(f.guard.planPersonalization({ user_details: f.original.user_details }), code("settings_change_missing"));
  changePersona(f); await assert.rejects(f.guard.verifySettings(EDITS), code("personalization_plan_required"));
  await assert.rejects(f.guard.planPersonalization(EDITS), code("personalization_baseline_changed"));
  f.change(f.original);
  await f.guard.planPersonalization(EDITS);
  changePersona(f);
  await assert.rejects(f.guard.planPersonalization({ user_details: "new plan" }), code("personalization_plan_already_set"));
  f.change({ model: "unexpected" }); await assert.rejects(f.guard.verifySettings(EDITS), code("settings_unexpected_change")); await f.guard.close();
});
test("unregistered writes are never restored, while independently owned session cleanup still runs", async () => {
  const f = fixture(); await f.guard.preflight(); await f.guard.createOwnedSession(); changePersona(f);
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), error => {
    code("cleanup_conflict")(error); assert.equal(error.receipt.settingsConflict, true); assert.equal(error.receipt.createdSessionDeleted, true); return true;
  });
  assert.equal(writes(f).some(call => call.method === "PUT"), false); assert.equal(f.current().settings.user_details, EDITS.user_details); await f.guard.close();
});
test("a third-party touched-field conflict prevents every restore PUT", async () => {
  const f = fixture(); await f.guard.preflight(); await f.guard.planPersonalization(EDITS); changePersona(f); f.change({ user_details: "Peer edit" });
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_conflict"));
  assert.equal(writes(f).length, 0); assert.equal(f.current().settings.unified_system_prompt, EDITS.unified_system_prompt);
  assert.equal(f.current().settings.user_details, "Peer edit"); await f.guard.close();
});
test("partial UI failure restores applied fields and preserves fresh unrelated settings", async () => {
  const f = fixture(); await f.guard.preflight(); await f.guard.planPersonalization(EDITS);
  f.change({ unified_system_prompt: EDITS.unified_system_prompt, prompt_mode: "unified", model: "peer-model",
    ai_name: "Peer name", provider_private_setting: { enabled: false } });
  assert.equal((await f.guard.restoreAndCleanup({ appStopped: true })).cleanupVerified, true);
  assert.deepEqual(JSON.parse(writes(f).find(call => call.method === "PUT").body), { unified_system_prompt: "", prompt_mode: "legacy" });
  assert.equal(f.current().settings.model, "peer-model"); assert.equal(f.current().settings.ai_name, "Peer name");
  assert.deepEqual(f.current().settings.provider_private_setting, { enabled: false }); await f.guard.close();
});
test("an edit during restoration is detected without resending a stale settings object", async () => {
  const f = fixture({ onRestore: settings => { settings.model = "Changed during PUT"; } });
  await f.guard.preflight(); await f.guard.planPersonalization(EDITS); changePersona(f);
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete"));
  assert.equal(f.current().settings.model, "Changed during PUT"); assert.equal(writes(f).filter(call => call.method === "PUT").length, 1); await f.guard.close();
});
test("failed restoration or deletion never claims cleanup; only owned sessions may be deleted", async () => {
  for (const options of [{ restoreStatus: 500 }, { onRestore: settings => { settings.personality = "Corrupt response"; } }, { deleteStatus: 500 }]) {
    const f = fixture(options); await f.guard.preflight(); await f.guard.createOwnedSession(); await f.guard.planPersonalization(EDITS); changePersona(f);
    await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), error => {
      code("cleanup_incomplete")(error); assert.equal(error.receipt.cleanupVerified, false);
      assert.equal(error.receipt.createdSessionDeleted, !options.deleteStatus); return true;
    }); await f.guard.close();
  }
});
test("changed companion stops cleanup before any write", async () => {
  const f = fixture({ companionAtRead: index => index <= 2 ? COMPANION : OTHER }); await f.guard.preflight();
  await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_preflight_failed")); assert.equal(writes(f).length, 0); await f.guard.close();
});
test("operations cannot race or replace a personalization plan during readback", async () => {
  let release, entered; const started = new Promise(resolve => { entered = resolve; }); const hold = new Promise(resolve => { release = resolve; });
  const f = fixture({ onRead: async (settings, sessions, index) => { if (index === 3) { entered(); await hold; } } });
  await f.guard.preflight(); const operation = f.guard.recordCreatedSessions(); await started;
  await assert.rejects(f.guard.planPersonalization(EDITS), code("live_operation_in_progress"));
  await assert.rejects(f.guard.close(), code("live_operation_in_progress")); release(); await operation; await f.guard.close();
});
test("upstream failures expose only fixed enum errors", async () => {
  const network = fixture({ fetchError: true }); await assert.rejects(network.guard.preflight(), code("dedicated_login_failed"));
  const revoke = fixture({ revokeStatus: 500 }); await revoke.guard.preflight(); await assert.rejects(revoke.guard.close(), code("auth_revoke_failed"));
});
