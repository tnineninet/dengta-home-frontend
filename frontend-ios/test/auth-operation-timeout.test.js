import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const fictionalSession = { access_token: "fictional-session", user: { id: ACCOUNT } };
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

for (const [action, sdkMethod, payload] of [
  ["signUp", "signUp", { email: "fictional@example.test", password: "fictional-password" }],
  ["resendVerification", "resend", { email: "fictional@example.test" }],
  ["requestPasswordReset", "resetPasswordForEmail", { email: "fictional@example.test" }],
  ["updatePassword", "updateUser", { password: "fictional-new-password" }],
]) test(`${action} recovers from an unresponsive SDK and fences its late result`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const values = new Map(), clients = [];
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  let finish, entered;
  const blocked = new Promise(resolve => { finish = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage,
    createClientFn: (_url, _key, options) => {
      const first = clients.length === 0;
      const sdk = { lease: options.auth.storage, auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange(callback) { sdk.emit = callback; return { data: { subscription: { unsubscribe() {} } } }; },
        [sdkMethod]() { if (first) { entered(); return blocked; } return Promise.resolve({ data: { session: null }, error: null }); },
      } };
      clients.push(sdk); return sdk;
    },
  });
  let pending;
  try {
    await manager.initialize();
    if (action === "updatePassword") await clients[0].emit("PASSWORD_RECOVERY", fictionalSession);
    let outcome = "pending";
    pending = manager[action](payload);
    pending.then(() => { outcome = "fulfilled"; }, () => { outcome = "rejected"; });
    await started;
    t.mock.timers.tick(20_000); await settle();
    assert.equal(outcome, "rejected", "the UI finally handler must be able to release busy after 20 seconds");
    await assert.rejects(pending, { code: "auth_timeout" });
    assert.equal(manager.getSnapshot().status, AUTH_STATUS.error);
    assert.equal(manager.getSnapshot().user, null);

    finish({ data: { session: fictionalSession, user: fictionalSession.user }, error: null });
    await settle();
    await clients[0].emit("SIGNED_IN", fictionalSession);
    await assert.rejects(clients[0].lease.setItem("dengta_home_auth_v1", "fictional-late-result"), { code: "auth_storage_retired" });
    assert.equal(manager.getSnapshot().user, null);
    await manager.initialize();
    assert.equal(clients.length, 2, "retry uses a fresh SDK after the timed-out identity operation");
    assert.equal(manager.getSnapshot().status, AUTH_STATUS.anonymous);
  } finally {
    finish({ data: { session: null }, error: null });
    await pending?.catch(() => {});
    manager.destroy();
  }
});
