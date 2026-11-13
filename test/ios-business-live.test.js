import assert from "node:assert/strict";
import test from "node:test";
import { createLiveGuard } from "../scripts/ios-business-live.mjs";
import { createSettingsPayload } from "../src/settings.js";

const AUTH = "https://nyyqizwrlmejpfdhgrnd.supabase.co";
const API = "https://dengta-home-backend-rkmq.onrender.com";
const USER = "11111111-1111-4111-8111-111111111111";
const COMPANION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const SECRET_TEXT = "fictional-sensitive-upstream-detail";

function fixture(options = {}) {
  const original = {
    ai_name: "Synthetic", account_role: "member", account_status: "active",
    prompt_mode: "legacy", unified_system_prompt: "", user_details: "  original detail\r\n",
    system_prompt: " legacy system\n", additional_prompt: "legacy additional", personality: "legacy personality",
    intimate_expression_enabled: false, provider: "custom", api_url: "https://synthetic-provider.example.test",
    model: "synthetic-model", timezone: "Asia/Shanghai", provider_private_setting: { enabled: true },
    storage_used_bytes: 0, storage_quota_bytes: 5000, context_reset_at: "2026-01-01T00:00:00.000Z",
    ...options.settings,
  };
  let settings = structuredClone(original), sessions = structuredClone(options.sessions || []), bootstrapReads = 0;
  const calls = [];
  const response = (data, status = 200, companion = COMPANION) => new Response(
    status === 204 ? null : JSON.stringify(data), {
      status, headers: { "Content-Type": "application/json", ...(companion ? { "X-DengTa-Companion-Id": companion } : {}) },
    },
  );
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url, path: parsed.pathname, ...init });
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    if (options.fetchError) throw new Error(SECRET_TEXT);
    if (parsed.pathname === "/auth/v1/token") {
      assert.equal(parsed.searchParams.get("grant_type"), "password");
      assert.equal(init.headers.apikey, "fictional-anon-key");
      assert.deepEqual(JSON.parse(init.body), { email: "synthetic@example.invalid", password: "fictional-password" });
      return response({ access_token: "fictional-access-token", refresh_token: "fictional-refresh-token", user: { id: options.loginId || USER } });
    }
    if (parsed.pathname === "/auth/v1/logout") {
      assert.ok(["local", "global"].includes(parsed.searchParams.get("scope")));
      return response({}, options.revokeStatus || 204);
    }
    assert.equal(init.headers.Authorization, "Bearer fictional-access-token");
    if (parsed.pathname === "/api/v2/bootstrap") {
      bootstrapReads++;
      const header = options.companionAtRead ? options.companionAtRead(bootstrapReads) : COMPANION;
      return response({ settings, sessions, state: {} }, 200, header);
    }
    assert.equal(init.headers["X-DengTa-Companion-Id"], COMPANION);
    if (parsed.pathname === "/api/v2/settings" && init.method === "PUT") {
      if (options.restoreStatus) return response({ message: SECRET_TEXT }, options.restoreStatus);
      settings = { ...settings, ...JSON.parse(init.body) };
      if (options.restoreCorrupt) settings.personality = "unexpected";
      return response({ settings });
    }
    if (parsed.pathname.startsWith("/api/v2/sessions/") && init.method === "DELETE") {
      assert.equal(parsed.pathname, `/api/v2/sessions/${SESSION}`);
      if (options.deleteStatus) return response({ message: SECRET_TEXT }, options.deleteStatus);
      sessions = sessions.filter(item => item.id !== SESSION);
      return response(null, 204);
    }
    throw new Error(SECRET_TEXT);
  };
  const config = {
    authUrl: AUTH, apiUrl: API, anonKey: "fictional-anon-key", email: "synthetic@example.invalid",
    password: "fictional-password", expectedUserId: USER, fetchImpl,
  };
  return {
    config, calls, original, guard: createLiveGuard(config),
    change: values => { settings = { ...settings, ...values }; },
    sessions: values => { sessions = structuredClone(values); },
    current: () => ({ settings: structuredClone(settings), sessions: structuredClone(sessions) }),
  };
}

const code = expected => error => {
  assert.equal(error.name, "IOSBusinessLiveError");
  assert.equal(error.code, expected);
  assert.equal(error.message, expected);
  assert.doesNotMatch(JSON.stringify(error), /fictional-sensitive|fictional-password|fictional-access-token|synthetic@example|legacy system/);
  return true;
};

test("requires the explicit dedicated UUID and exact HTTPS production origins before network access", () => {
  const f = fixture();
  for (const value of [undefined, "", "not-a-user"]) {
    assert.throws(() => createLiveGuard({ ...f.config, expectedUserId: value }), code("dedicated_user_id_required"));
  }
  for (const [key, value] of [
    ["authUrl", "http://nyyqizwrlmejpfdhgrnd.supabase.co"], ["authUrl", "https://other.supabase.co"],
    ["authUrl", `${AUTH}/auth/v1`], ["apiUrl", `${API}.untrusted.example`],
    ["apiUrl", "https://name:password@dengta-home-backend-rkmq.onrender.com"],
    ["apiUrl", `${API}/?redirect=secret`], ["apiUrl", `${API}/#fragment`],
  ]) assert.throws(() => createLiveGuard({ ...f.config, [key]: value }), code("production_origin_required"));
  assert.equal(f.calls.length, 0);
});

test("preflight binds the expected user, active member role and a stable empty companion", async () => {
  const f = fixture();
  assert.deepEqual(await f.guard.preflight(), {
    schemaVersion: 1, dedicatedIdentityMatched: true, memberActive: true, companionPinned: true, emptySessionBaseline: true,
  });
  const reads = f.calls.filter(call => call.path === "/api/v2/bootstrap");
  assert.equal(reads.length, 2);
  assert.equal(reads[0].headers["X-DengTa-Companion-Id"], undefined);
  assert.equal(reads[1].headers["X-DengTa-Companion-Id"], COMPANION);
  await f.guard.close();
});

for (const settings of [
  { account_role: "owner" }, { account_role: "admin" }, { account_role: undefined },
  { account_status: "suspended" }, { account_status: undefined },
]) test(`rejects non-dedicated role/status ${JSON.stringify(settings)}`, async () => {
  const f = fixture({ settings });
  await assert.rejects(f.guard.preflight(), code("dedicated_member_required"));
  assert.equal(f.calls.filter(call => call.path === "/auth/v1/logout").length, 1);
  assert.equal(f.calls.some(call => call.method === "PUT" || call.method === "DELETE"), false);
  assert.equal(new URL(f.calls.find(call => call.path === "/auth/v1/logout").url).searchParams.get("scope"), "local");
});

test("private baseline input and fresh restored readback are guarded, and accepted account sessions are revoked globally", async () => {
  const f = fixture();
  assert.throws(() => f.guard.runtimeBaseline(), code("live_preflight_required"));
  await f.guard.preflight();
  const first = f.guard.runtimeBaseline();
  assert.deepEqual(first, { unified_system_prompt: f.original.unified_system_prompt, user_details: f.original.user_details });
  first.user_details = "mutated copy";
  assert.equal(f.guard.runtimeBaseline().user_details, f.original.user_details);
  assert.deepEqual(await f.guard.verifyBaseline(), { schemaVersion: 1, settingsRestored: true, settingsReadback: true, unrelatedSettingsUnchanged: true });
  f.change({ personality: "other" });
  await assert.rejects(f.guard.verifyBaseline(), code("settings_baseline_mismatch"));
  await f.guard.close();
  assert.equal(new URL(f.calls.find(call => call.path === "/auth/v1/logout").url).searchParams.get("scope"), "global");
  assert.throws(() => f.guard.runtimeBaseline(), code("live_preflight_required"));
});

test("rejects another user and existing sessions without changing account data", async () => {
  const mismatch = fixture({ loginId: OTHER });
  await assert.rejects(mismatch.guard.preflight(), code("dedicated_identity_mismatch"));
  assert.equal(mismatch.calls.some(call => call.path.startsWith("/api/")), false);
  const history = fixture({ sessions: [{ id: SESSION, title: SECRET_TEXT }] });
  await assert.rejects(history.guard.preflight(), code("dedicated_history_not_empty"));
  assert.equal(history.calls.some(call => call.method === "DELETE" || call.method === "PUT"), false);
});

test("requires the bootstrap companion header and rejects companion changes", async () => {
  for (const companionAtRead of [() => null, index => index === 1 ? COMPANION : OTHER]) {
    const f = fixture({ companionAtRead });
    await assert.rejects(f.guard.preflight(), code("companion_binding_invalid"));
    assert.equal(f.calls.some(call => call.method === "PUT" || call.method === "DELETE"), false);
  }
});

test("verifies personalization then restores complete editable baseline, deletes only captured session and revokes", async () => {
  const f = fixture();
  const before = createSettingsPayload(f.original);
  await f.guard.preflight();
  const expected = { unified_system_prompt: " synthetic instruction\n", user_details: " synthetic detail\r\n" };
  f.change({ ...expected, prompt_mode: "unified" });
  f.sessions([{ id: SESSION, title: "Synthetic test" }]);
  const saved = await f.guard.verifySettings(expected);
  assert.equal(saved.settingsReadback, true);
  assert.equal(saved.unrelatedSettingsUnchanged, true);
  assert.equal((await f.guard.recordCreatedSessions()).createdSessionCount, 1);
  await assert.rejects(f.guard.restoreAndCleanup(), code("app_stop_required"));
  assert.equal(f.calls.some(call => call.method === "PUT"), false);
  const cleaned = await f.guard.restoreAndCleanup({ appStopped: true });
  assert.deepEqual(cleaned, {
    schemaVersion: 1, settingsRestored: true, sessionsCleaned: true, createdSessionDeleted: true, cleanupVerified: true,
  });
  assert.deepEqual(createSettingsPayload(f.current().settings), before);
  const restored = JSON.parse(f.calls.find(call => call.method === "PUT").body);
  assert.equal(restored.prompt_mode, "legacy");
  assert.equal(restored.system_prompt, f.original.system_prompt);
  assert.equal(restored.additional_prompt, f.original.additional_prompt);
  assert.equal(restored.personality, f.original.personality);
  assert.deepEqual(restored.provider_private_setting, before.provider_private_setting);
  for (const field of ["account_role", "account_status", "storage_used_bytes", "storage_quota_bytes", "context_reset_at"]) {
    assert.equal(Object.hasOwn(restored, field), false);
  }
  assert.deepEqual(f.current().sessions, []);
  assert.deepEqual(await f.guard.close(), { schemaVersion: 1, sessionRevoked: true });
  await f.guard.close();
  assert.equal(f.calls.filter(call => call.path === "/auth/v1/logout").length, 1);
  assert.equal(f.calls.filter(call => call.method === "DELETE").length, 1);
  for (const call of f.calls.filter(call => call.path.startsWith("/api/")).slice(1)) {
    assert.equal(call.headers["X-DengTa-Companion-Id"], COMPANION);
  }
  const exported = JSON.stringify({ saved, cleaned });
  assert.doesNotMatch(exported, /synthetic instruction|synthetic detail|11111111|22222222|44444444|legacy|fictional/);
});

test("rejects unrelated settings changes, invalid expectation fields and unchanged saves", async () => {
  const f = fixture();
  await f.guard.preflight();
  await assert.rejects(f.guard.verifySettings({ provider: "other" }), code("personalization_expectation_invalid"));
  await assert.rejects(f.guard.verifySettings({ user_details: f.original.user_details }), code("settings_change_missing"));
  f.change({ user_details: "synthetic change", model: "unexpected-model" });
  await assert.rejects(f.guard.verifySettings({ user_details: "synthetic change" }), code("settings_unexpected_change"));
  await f.guard.restoreAndCleanup({ appStopped: true });
  await f.guard.close();
});

test("does not delete ambiguous sessions or a different later session", async () => {
  for (const captureFirst of [false, true]) {
    const f = fixture();
    await f.guard.preflight();
    f.sessions([{ id: SESSION }]);
    if (captureFirst) await f.guard.recordCreatedSessions();
    f.sessions(captureFirst ? [{ id: OTHER }] : [{ id: SESSION }, { id: OTHER }]);
    await assert.rejects(f.guard.recordCreatedSessions(), code("created_session_ambiguous"));
    await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), error => {
      code("cleanup_incomplete")(error);
      assert.equal(error.receipt.sessionsCleaned, false);
      return true;
    });
    assert.equal(f.calls.some(call => call.method === "DELETE"), false);
    await f.guard.close();
  }
});

test("cleanup captures the sole after-snapshot session even after a failed UI run", async () => {
  const f = fixture();
  await f.guard.preflight();
  f.sessions([{ id: SESSION }]);
  const cleaned = await f.guard.restoreAndCleanup({ appStopped: true });
  assert.equal(cleaned.createdSessionDeleted, true);
  assert.equal(cleaned.cleanupVerified, true);
  assert.equal(f.calls.some(call => call.method === "PUT"), false);
  await f.guard.close();
});

test("failed or corrupt restoration cannot claim cleanup, but still deletes its own session", async () => {
  for (const options of [{ restoreStatus: 500 }, { restoreCorrupt: true }]) {
    const f = fixture(options);
    await f.guard.preflight();
    f.change({ user_details: "synthetic change" });
    f.sessions([{ id: SESSION }]);
    await assert.rejects(f.guard.restoreAndCleanup({ appStopped: true }), error => {
      code("cleanup_incomplete")(error);
      assert.equal(error.receipt.settingsRestored, false);
      assert.equal(error.receipt.createdSessionDeleted, true);
      assert.equal(error.receipt.cleanupVerified, false);
      return true;
    });
    await f.guard.close();
  }
});

test("a failed deletion or changed companion cannot claim cleanup", async () => {
  const deletion = fixture({ deleteStatus: 500 });
  await deletion.guard.preflight();
  deletion.sessions([{ id: SESSION }]);
  await assert.rejects(deletion.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_incomplete"));
  await deletion.guard.close();
  const changed = fixture({ companionAtRead: index => index <= 2 ? COMPANION : OTHER });
  await changed.guard.preflight();
  await assert.rejects(changed.guard.restoreAndCleanup({ appStopped: true }), code("cleanup_preflight_failed"));
  assert.equal(changed.calls.some(call => call.method === "PUT" || call.method === "DELETE"), false);
  await changed.guard.close();
});

test("upstream exceptions and revocation failures expose fixed enums only", async () => {
  const network = fixture({ fetchError: true });
  await assert.rejects(network.guard.preflight(), code("dedicated_login_failed"));
  const revoke = fixture({ revokeStatus: 500 });
  await revoke.guard.preflight();
  await assert.rejects(revoke.guard.close(), code("auth_revoke_failed"));
});
