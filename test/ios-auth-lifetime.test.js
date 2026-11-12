import assert from "node:assert/strict";
import test from "node:test";
import { createAuthSessionManager } from "../src/auth-session.js";
import { apiFetch, apiRequest } from "../src/api.js";
import { coWatchRequestOptions } from "../src/co-watch-request-scope.js";
import { createScopedSettingsSession, settingsSaveScope } from "../src/settings-save-scope.js";
import { createImportRequestClient } from "../src/import-request-scope.js";

const KEY = "dengta_home_auth_v1";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const COMPANION = "33333333-3333-4333-8333-333333333333";
const sessionFor = (id, token = `fictional-${id}`) => ({ access_token: token, user: { id } });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function fixture({ initial = null, resolveStorage, signIn, getSession, setSession } = {}) {
  const values = new Map(), clients = [], calls = [];
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { calls.push(["remove", key]); values.delete(key); },
  };
  let resolutions = 0;
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-key", storage,
    resolveStorageFn: async () => { resolutions++; return resolveStorage ? resolveStorage(storage, resolutions) : storage; },
    createClientFn: (_url, _key, options) => {
      let session = clients.length === 0 ? initial : null, listener;
      const sdk = {
        lease: options.auth.storage,
        emit(event, next) { session = next; listener?.(event, next); },
        auth: {
          getSession: async () => getSession ? getSession(sdk) : { data: { session }, error: null },
          onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() { calls.push(["unsubscribe"]); } } } }; },
          stopAutoRefresh() { calls.push(["stop"]); },
          signOut: async () => { session = null; listener?.("SIGNED_OUT", null); return { error: null }; },
          async signInWithPassword(payload) {
            const next = signIn ? await signIn(sdk, payload) : sessionFor(payload.email.startsWith("b") ? B : A);
            listener?.("SIGNED_IN", next);
            return { data: { session: next, user: next.user }, error: null };
          },
          async setSession(tokens) {
            const next = setSession ? await setSession(sdk, tokens) : sessionFor(A, tokens.access_token);
            listener?.("SIGNED_IN", next);
            return { data: { session: next }, error: null };
          },
        },
      };
      clients.push(sdk);
      return sdk;
    },
  });
  return { manager, clients, values, storage, calls, resolutions: () => resolutions };
}

test("pending native storage resolution is single-flight across initialization and login", async () => {
  const gate = deferred(), f = fixture({ resolveStorage: async storage => { await gate.promise; return storage; } });
  try {
    const first = f.manager.initialize(), second = f.manager.initialize();
    const login = f.manager.signIn({ email: "a@example.invalid", password: "fictional" });
    await settle();
    assert.equal(f.resolutions(), 1); assert.equal(f.clients.length, 0);
    gate.resolve();
    await Promise.all([first, second, login]);
    assert.equal(f.clients.length, 1); assert.equal(f.manager.getSnapshot().user.id, A);
  } finally { f.manager.destroy(); }
});

test("logout during a pending resolver never creates the old client and blocks the next until clear", async () => {
  const gate = deferred(), f = fixture({ resolveStorage: async (storage, count) => { if (count === 1) await gate.promise; return storage; } });
  try {
    const old = f.manager.initialize(); old.catch(() => {});
    await settle();
    const exit = f.manager.signOut();
    assert.equal(f.manager.getSnapshot().user, null); assert.equal(f.manager.getSnapshot().cleanupState, "pending");
    const next = f.manager.initialize();
    await settle(); assert.equal(f.clients.length, 0); assert.equal(f.resolutions(), 1);
    gate.resolve();
    await exit; await assert.rejects(old, { code: "auth_operation_cancelled" }); await next;
    assert.equal(f.clients.length, 1); assert.equal(f.resolutions(), 2);
    assert.equal(f.calls.filter(([kind]) => kind === "remove").length, 3);
  } finally { f.manager.destroy(); }
});

test("failed native clear retains the sealed lease, blocks new clients and retries after unlock", async () => {
  const f = fixture({ initial: sessionFor(A) });
  let locked = true;
  const remove = f.storage.removeItem;
  f.storage.removeItem = key => { if (locked && key === KEY) throw new Error("fictional-provider-secret"); remove(key); };
  try {
    await f.manager.initialize(); f.values.set(KEY, "fictional-session");
    await assert.rejects(f.manager.signOut(), error => error.code === "auth_cleanup_failed" && !error.cause && !error.message.includes("fictional"));
    assert.equal(f.manager.getSnapshot().user, null); assert.equal(f.manager.getSnapshot().cleanupState, "failed");
    await assert.rejects(f.clients[0].lease.setItem(KEY, "fictional-stale"), { code: "auth_storage_retired" });
    await assert.rejects(f.manager.initialize(), { code: "auth_cleanup_failed" });
    assert.equal(f.clients.length, 1);
    locked = false;
    await f.manager.retryAuthCleanup(); await f.manager.initialize();
    assert.equal(f.clients.length, 2); assert.equal(f.values.has(KEY), false);
  } finally { f.manager.destroy(); }
});

test("old delayed login result, SDK event, write and remove cannot affect a later login", async () => {
  const entered = deferred(), finish = deferred();
  const f = fixture({ signIn: async (sdk, payload) => {
    if (payload.email.startsWith("a")) { entered.resolve(); await finish.promise; }
    return sessionFor(payload.email.startsWith("a") ? A : B);
  } });
  try {
    const old = f.manager.signIn({ email: "a@example.invalid", password: "fictional" }); old.catch(() => {});
    await entered.promise;
    await f.manager.signOut();
    await f.manager.signIn({ email: "b@example.invalid", password: "fictional" });
    await f.clients[1].lease.setItem(KEY, "fictional-account-b");
    finish.resolve();
    await assert.rejects(old, { code: "auth_operation_cancelled" });
    f.clients[0].emit("SIGNED_IN", sessionFor(A));
    await assert.rejects(f.clients[0].lease.removeItem(KEY), { code: "auth_storage_retired" });
    await assert.rejects(f.clients[0].lease.setItem(KEY, "fictional-late-a"), { code: "auth_storage_retired" });
    assert.equal(f.manager.getSnapshot().user.id, B); assert.equal(f.values.get(KEY), "fictional-account-b");
  } finally { f.manager.destroy(); }
});

test("restoration result cannot overwrite a newer account event", async () => {
  const entered = deferred(), finish = deferred();
  const f = fixture({ getSession: async () => { entered.resolve(); return finish.promise; } });
  try {
    const restoring = f.manager.initialize();
    await entered.promise; f.clients[0].emit("SIGNED_IN", sessionFor(B));
    finish.resolve({ data: { session: sessionFor(A) }, error: null });
    await restoring;
    assert.equal(f.manager.getSnapshot().user.id, B);
    f.clients[0].emit("TOKEN_REFRESHED", sessionFor(A));
    assert.equal(f.manager.getSnapshot().user.id, B);
  } finally { f.manager.destroy(); }
});

test("a login timeout retires the SDK so its late success cannot authenticate", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = deferred(), finish = deferred();
  const f = fixture({ signIn: async () => { entered.resolve(); await finish.promise; return sessionFor(A); } });
  try {
    const login = f.manager.signIn({ email: "a@example.invalid", password: "fictional" }); login.catch(() => {});
    await entered.promise; t.mock.timers.tick(20_000);
    await assert.rejects(login, { code: "auth_timeout" });
    finish.resolve(); await settle();
    assert.equal(f.manager.getSnapshot().user, null);
    assert.equal(f.manager.getSnapshot().status, "error");
    assert.equal(f.manager.getSnapshot().error.code, "auth_timeout");
  } finally { f.manager.destroy(); }
});

test("destroy while resolver pending prevents a late client and preserves durable data", async () => {
  const gate = deferred(), f = fixture({ resolveStorage: async storage => { await gate.promise; return storage; } });
  f.values.set(KEY, "fictional-durable");
  const old = f.manager.initialize(); old.catch(() => {});
  await settle(); f.manager.destroy(); gate.resolve();
  await assert.rejects(old, { code: "auth_operation_cancelled" });
  assert.equal(f.clients.length, 0); assert.equal(f.values.get(KEY), "fictional-durable");
});

for (const mode of ["new-account", "new-token"]) test(`late whitelisted API 401 cannot expire ${mode}`, async t => {
  const f = fixture({ initial: sessionFor(A, "fictional-a1") }), entered = deferred(), response = deferred();
  t.mock.method(globalThis, "fetch", async () => { entered.resolve(); return response.promise; });
  const oldWindow = globalThis.window; globalThis.window = { setTimeout, clearTimeout };
  try {
    await f.manager.initialize();
    const old = apiFetch("/fixture/late-401", { retry: false, authSession: f.manager });
    await entered.promise;
    if (mode === "new-account") {
      await f.manager.signOut(); await f.manager.signIn({ email: "b@example.invalid", password: "fictional" });
    } else f.clients[0].emit("TOKEN_REFRESHED", sessionFor(A, "fictional-a2"));
    response.resolve(new Response(JSON.stringify({ code: "token_expired" }), { status: 401 }));
    await old;
    assert.equal(f.manager.getSnapshot().status, "authenticated");
    assert.equal(f.manager.getSnapshot().user.id, mode === "new-account" ? B : A);
    assert.equal((await f.manager.getRequestContext()).accessToken, mode === "new-account" ? `fictional-${B}` : "fictional-a2");
  } finally { globalThis.window = oldWindow; f.manager.destroy(); }
});

test("concurrent 401s clear once and requestJson does not invalidate twice", async t => {
  const f = fixture({ initial: sessionFor(A) });
  const gate = deferred(), entered = deferred(); let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { if (++requests === 2) entered.resolve(); await gate.promise; return new Response(JSON.stringify({ code: "invalid_session" }), { status: 401 }); });
  const oldWindow = globalThis.window; globalThis.window = { setTimeout, clearTimeout };
  try {
    await f.manager.initialize();
    const first = apiRequest("/fixture/one", { retry: false, authSession: f.manager }); first.catch(() => {});
    const second = apiRequest("/fixture/two", { retry: false, authSession: f.manager }); second.catch(() => {});
    await entered.promise; gate.resolve();
    await Promise.allSettled([first, second]);
    assert.equal(f.manager.getSnapshot().status, "expired");
    assert.equal(f.calls.filter(([kind]) => kind === "remove").length, 3);
  } finally { globalThis.window = oldWindow; f.manager.destroy(); }
});

test("a stale companion header cannot select a companion for the next identity", async () => {
  const f = fixture({ initial: sessionFor(A) });
  try {
    await f.manager.initialize(); const old = await f.manager.getRequestContext();
    await f.manager.signOut(); await f.manager.signIn({ email: "b@example.invalid", password: "fictional" });
    f.manager.captureCompanionFromResponse(new Response("{}", { headers: { "X-DengTa-Companion-Id": COMPANION } }), old);
    assert.equal(f.manager.getSnapshot().activeCompanionId, "");
    assert.equal(f.values.has(`dengta_active_companion_id_v1:${B}`), false);
  } finally { f.manager.destroy(); }
});

test("direct untrusted callback is rejected before resolving native storage", async () => {
  const f = fixture();
  assert.deepEqual(await f.manager.handleAuthCallbackUrl("https://evil.example/auth#access_token=x&refresh_token=y"), { ok: false, reason: "invalid_callback" });
  assert.equal(f.resolutions(), 0); assert.equal(f.clients.length, 0); f.manager.destroy();
});

test("internal client rotation keeps callback and subsequent password login serialized", async () => {
  const entered = deferred(), finish = deferred(), sdkCalls = [];
  const f = fixture({ initial: sessionFor(A),
    setSession: async () => { sdkCalls.push("callback-start"); entered.resolve(); await finish.promise; sdkCalls.push("callback-end"); return sessionFor(A, "fictional-callback"); },
    signIn: async () => { sdkCalls.push("password"); return sessionFor(B); },
  });
  try {
    await f.manager.initialize();
    const callback = f.manager.handleAuthCallbackUrl("dengta://auth#access_token=fictional-access&refresh_token=fictional-refresh");
    await entered.promise;
    const login = f.manager.signIn({ email: "b@example.invalid", password: "fictional" });
    await settle();
    assert.deepEqual(sdkCalls, ["callback-start"]);
    finish.resolve(); await callback; await login;
    assert.deepEqual(sdkCalls, ["callback-start", "callback-end", "password"]);
    assert.equal(f.manager.getSnapshot().user.id, B);
    assert.equal(f.clients.length, 3);
  } finally { finish.resolve(); f.manager.destroy(); }
});

test("explicit logout during internal client cleanup cancels the queued identity", async () => {
  const entered = deferred(), finish = deferred(), f = fixture({ initial: sessionFor(A) });
  const remove = f.storage.removeItem; let first = true;
  f.storage.removeItem = async key => { if (first) { first = false; entered.resolve(); await finish.promise; } remove(key); };
  try {
    await f.manager.initialize();
    const login = f.manager.signIn({ email: "b@example.invalid", password: "fictional" }); login.catch(() => {});
    await entered.promise;
    const staleInitialization = f.manager.initialize(); staleInitialization.catch(() => {});
    await settle();
    const exit = f.manager.signOut();
    finish.resolve(); await exit;
    await assert.rejects(login, { code: "auth_operation_cancelled" });
    await assert.rejects(staleInitialization, { code: "auth_operation_cancelled" });
    assert.equal(f.manager.getSnapshot().user, null);
    assert.equal(f.clients.length, 1);
    await f.manager.signIn({ email: "b@example.invalid", password: "fictional" });
    assert.equal(f.manager.getSnapshot().user.id, B);
  } finally { finish.resolve(); f.manager.destroy(); }
});

for (const facade of ["settings", "co-watch", "import"]) {
  for (const responseKind of ["expired-token", "companion-header"]) test(`${facade} facade preserves originating context for late ${responseKind}`, async t => {
    const f = fixture({ initial: sessionFor(A, "fictional-a1") }), entered = deferred(), response = deferred();
    t.mock.method(globalThis, "fetch", async () => { entered.resolve(); return response.promise; });
    const oldWindow = globalThis.window; globalThis.window = { setTimeout, clearTimeout };
    try {
      await f.manager.initialize(); f.manager.setActiveCompanionId(COMPANION);
      let request;
      if (facade === "import") {
        request = createImportRequestClient({ accountScope: A, companionScope: COMPANION, auth: f.manager }).apiFetch("/fixture/scoped", { retry: false });
      } else {
        const auth = facade === "settings" ? createScopedSettingsSession(f.manager, settingsSaveScope(f.manager.getSnapshot()))
          : coWatchRequestOptions({ accountScope: A, companionScope: COMPANION }, f.manager).authSession;
        request = apiFetch("/fixture/scoped", { retry: false, authSession: auth });
      }
      await entered.promise;
      f.clients[0].emit("TOKEN_REFRESHED", sessionFor(A, "fictional-a2"));
      response.resolve(responseKind === "expired-token" ? new Response(JSON.stringify({ code: "token_expired" }), { status: 401 })
        : new Response("{}", { headers: { "X-DengTa-Companion-Id": B } }));
      await request;
      assert.equal(f.manager.getSnapshot().status, "authenticated");
      assert.equal(f.manager.getSnapshot().activeCompanionId, COMPANION);
      assert.equal((await f.manager.getRequestContext()).accessToken, "fictional-a2");
    } finally { globalThis.window = oldWindow; f.manager.destroy(); }
  });
}
