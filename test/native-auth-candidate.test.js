import assert from "node:assert/strict";
import test from "node:test";
import { GoTrueClient } from "@supabase/auth-js";
import { createAuthSessionManager } from "../src/auth-session.js";

const KEY = "dengta_home_auth_v1";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const jwt = (id, exp = Math.floor(Date.now() / 1000) + 3600) => `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, exp })).toString("base64url")}.ZmljdGlvbmFsLXNpZ25hdHVyZQ`;
const session = id => ({ access_token: jwt(id), refresh_token: "fictional-refresh", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id } });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

function fixture(fetchUser) {
  const values = new Map([[KEY, JSON.stringify(session(A))]]), clients = [], requests = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fixture.example.test", supabaseAnonKey: "fictional-public-key", storage,
    createClientFn: (_url, _key, options) => {
      const auth = new GoTrueClient({ ...options.auth, url: "https://fixture.example.test/auth/v1", fetch: async (url, init) => {
        requests.push(new URL(url).pathname);
        if (String(url).includes("/logout")) return new Response("{}", { status: 200 });
        return fetchUser(url, init);
      } });
      clients.push({ auth, options }); return { auth };
    },
  });
  return { manager, storage, values, clients, requests, async dispose() { manager.destroy(); await Promise.all(clients.map(c => c.auth.dispose())); } };
}
const callback = token => `dengta://auth#access_token=${token}&refresh_token=fictional-refresh`;

test("real SDK rejects malformed native tokens without erasing the active account", async () => {
  const f = fixture(() => { throw new Error("malformed JWT must not contact provider"); });
  try {
    await f.manager.initialize(); const before = f.values.get(KEY);
    await assert.rejects(f.manager.handleAuthCallbackUrl(callback("garbage")));
    assert.equal(f.manager.getSnapshot().status, "authenticated");
    assert.equal(f.manager.getSnapshot().user.id, A); assert.equal(f.values.get(KEY), before);
    assert.deepEqual(f.requests, []);
    assert.equal(f.clients[1].options.auth.persistSession, false);
    assert.equal(f.clients[1].options.auth.autoRefreshToken, false);
    assert.equal(f.clients[1].options.auth.detectSessionInUrl, false);
    assert.equal(f.clients[1].options.auth.storage, undefined);
  } finally { await f.dispose(); }
});

test("rejected provider callback leaves the existing durable login intact", async () => {
  const f = fixture(async () => new Response(JSON.stringify({ msg: "fictional rejection", code: "bad_jwt" }), { status: 401 }));
  try {
    await f.manager.initialize(); const before = f.values.get(KEY);
    await assert.rejects(f.manager.handleAuthCallbackUrl(callback(jwt(B))));
    assert.equal(f.manager.getSnapshot().user.id, A); assert.equal(f.values.get(KEY), before);
  } finally { await f.dispose(); }
});

test("candidate timeout preserves A and late provider success cannot commit", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = deferred(), finish = deferred();
  const f = fixture(async () => { entered.resolve(); await finish.promise; return new Response(JSON.stringify({ id: B }), { status: 200 }); });
  try {
    await f.manager.initialize(); const before = f.values.get(KEY);
    const pending = f.manager.handleAuthCallbackUrl(callback(jwt(B))); pending.catch(() => {});
    await entered.promise; t.mock.timers.tick(20_000);
    await assert.rejects(pending, { code: "auth_timeout" });
    finish.resolve(); for (let i = 0; i < 100; i++) await Promise.resolve();
    assert.equal(f.manager.getSnapshot().user.id, A); assert.equal(f.values.get(KEY), before);
    assert.equal(f.clients.length, 2);
  } finally { finish.resolve(); await f.dispose(); }
});

test("logout during candidate validation cancels commit and keeps credentials absent", async () => {
  const entered = deferred(), finish = deferred();
  const f = fixture(async () => { entered.resolve(); await finish.promise; return new Response(JSON.stringify({ id: B }), { status: 200 }); });
  try {
    await f.manager.initialize();
    const pending = f.manager.handleAuthCallbackUrl(callback(jwt(B))); pending.catch(() => {});
    await entered.promise; await f.manager.signOut(); finish.resolve();
    await assert.rejects(pending, { code: "auth_operation_cancelled" });
    assert.equal(f.manager.getSnapshot().user, null); assert.equal(f.values.has(KEY), false);
    assert.equal(f.clients.length, 2);
  } finally { finish.resolve(); await f.dispose(); }
});

test("valid candidate is committed once then restored without a second provider lookup", async () => {
  const f = fixture(async () => new Response(JSON.stringify({ id: B }), { status: 200 }));
  try {
    await f.manager.initialize();
    assert.deepEqual(await f.manager.handleAuthCallbackUrl(callback(jwt(B)) + "&type=recovery"), { ok: true });
    assert.equal(f.manager.getSnapshot().user.id, B); assert.equal(f.manager.getSnapshot().status, "recovery");
    assert.equal(JSON.parse(f.values.get(KEY)).user.id, B);
    assert.equal(f.requests.filter(path => path.endsWith("/user")).length, 1);
    assert.equal(f.clients.length, 3);
    await assert.rejects(f.manager.handleAuthCallbackUrl(callback("garbage")));
    assert.equal(f.manager.getSnapshot().status, "recovery");
    assert.equal(f.manager.getSnapshot().user.id, B);
  } finally { await f.dispose(); }
});

test("an expired callback commits the candidate's rotated refresh token", async () => {
  const f = fixture(async url => {
    assert.match(String(url), /\/token\?grant_type=refresh_token$/);
    return new Response(JSON.stringify({ ...session(B), refresh_token: "fictional-rotated-refresh" }), { status: 200 });
  });
  try {
    await f.manager.initialize();
    assert.deepEqual(await f.manager.handleAuthCallbackUrl(callback(jwt(B, 1))), { ok: true });
    assert.equal(JSON.parse(f.values.get(KEY)).refresh_token, "fictional-rotated-refresh");
    assert.equal(f.requests.length, 1);
  } finally { await f.dispose(); }
});

test("a cleanup subscriber cannot occupy the validated recovery candidate's commit slot", async () => {
  const f = fixture(async () => new Response(JSON.stringify({ id: B }), { status: 200 }));
  let armed = false, racedInitialization;
  const unsubscribe = f.manager.subscribe(snapshot => {
    if (armed && snapshot.cleanupState === "" && !snapshot.user) {
      armed = false;
      racedInitialization = f.manager.initialize();
      racedInitialization.catch(() => {});
    }
  });
  try {
    await f.manager.initialize(); armed = true;
    assert.deepEqual(await f.manager.handleAuthCallbackUrl(callback(jwt(B)) + "&type=recovery"), { ok: true });
    assert.ok(racedInitialization); await racedInitialization;
    assert.equal(f.manager.getSnapshot().user.id, B);
    assert.equal(f.manager.getSnapshot().status, "recovery");
    assert.equal(JSON.parse(f.values.get(KEY)).user.id, B);
    assert.equal(f.clients.length, 3);
    assert.equal(f.requests.filter(path => path.endsWith("/user")).length, 1);
  } finally { unsubscribe(); await f.dispose(); }
});

test("a partial candidate persistence failure clears the seed and fails closed", async () => {
  const f = fixture(async () => new Response(JSON.stringify({ id: B }), { status: 200 }));
  try {
    await f.manager.initialize();
    const write = f.storage.setItem; let failOnce = true;
    f.storage.setItem = (key, value) => {
      write(key, value);
      if (key === KEY && failOnce && JSON.parse(value).user?.id === B) {
        failOnce = false; throw new Error("fictional-provider-secret");
      }
    };
    await assert.rejects(f.manager.handleAuthCallbackUrl(callback(jwt(B))), error => {
      assert.doesNotMatch(error.message, /fictional-provider-secret/); return true;
    });
    assert.equal(f.values.has(KEY), false);
    assert.equal(f.manager.getSnapshot().user, null);
    assert.equal(f.manager.getSnapshot().cleanupState, "");
    await f.manager.initialize();
    assert.equal(f.manager.getSnapshot().status, "anonymous");
    assert.deepEqual(await f.manager.getRequestContext(), {});
  } finally { await f.dispose(); }
});

test("real SDK refresh completing a storage write during exit has no orphaned rejection", async () => {
  const f = fixture(async () => new Response(JSON.stringify(session(A)), { status: 200 }));
  const entered = deferred(), finish = deferred();
  try {
    await f.manager.initialize();
    const write = f.storage.setItem;
    f.storage.setItem = async (key, value) => { entered.resolve(); await finish.promise; write(key, value); };
    const refresh = f.clients[0].auth.refreshSession(); refresh.catch(() => {});
    await entered.promise;
    const exit = f.manager.signOut(); finish.resolve();
    await exit;
    const result = await refresh;
    assert.equal(result.error?.code, "auth_storage_retired");
    assert.equal(f.values.has(KEY), false);
    assert.equal(f.manager.getSnapshot().user, null);
  } finally { finish.resolve(); await f.dispose(); }
});

test("a seed rejected during SDK restoration fails instead of reporting callback success", async () => {
  const f = fixture(async () => new Response(JSON.stringify({ id: B }), { status: 200 }));
  try {
    await f.manager.initialize(); const write = f.storage.setItem;
    f.storage.setItem = (key, value) => write(key, key === KEY && JSON.parse(value).user?.id === B ? JSON.stringify({ invalid: true }) : value);
    await assert.rejects(f.manager.handleAuthCallbackUrl(callback(jwt(B))), { code: "invalid_session" });
    assert.equal(f.manager.getSnapshot().user, null);
    assert.equal(f.values.has(KEY), false);
    assert.equal(f.clients.length, 3);
    await f.manager.initialize();
    assert.equal(f.manager.getSnapshot().user, null);
  } finally { await f.dispose(); }
});
