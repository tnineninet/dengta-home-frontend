import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { GoTrueClient } from "@supabase/auth-js";
import { createAuthSessionManager } from "../src/auth-session.js";
import { AUTH_WEB_LIFETIME_KEY } from "../src/auth-web-lifetime.js";

const KEY = "dengta_home_auth_v1";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const sessionFor = id => ({ access_token: `fictional-${id}`, refresh_token: "fictional-refresh", token_type: "bearer",
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: "fixture@example.invalid" } });
const settle = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };

function originFixture({ locks = true, fetchAuth } = {}) {
  const values = new Map([[KEY, JSON.stringify(sessionFor(A))]]), windows = [], events = [], clients = [];
  let lockQueue = Promise.resolve();
  const lock = { request(_name, _options, operation) {
    const run = lockQueue.then(operation); lockQueue = run.catch(() => {}); return run;
  } };
  const make = () => {
    const listeners = new Set();
    const windowObject = { navigator: { locks: locks ? lock : undefined }, crypto: { randomUUID },
      addEventListener(type, callback) { if (type === "storage") listeners.add(callback); },
      removeEventListener(type, callback) { if (type === "storage") listeners.delete(callback); } };
    const emit = (key, newValue) => {
      for (const other of windows) if (other.windowObject !== windowObject) events.push(() => {
        for (const callback of other.listeners) void callback({ key, newValue, storageArea: other.storage });
      });
    };
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem(key, value) { if (values.get(key) !== String(value)) { values.set(key, String(value)); emit(key, String(value)); } },
      removeItem(key) { if (values.delete(key)) emit(key, null); },
    };
    windowObject.localStorage = storage;
    const entry = { windowObject, storage, listeners };
    windows.push(entry);
    entry.manager = createAuthSessionManager({
      supabaseUrl: "https://fixture.example.test", supabaseAnonKey: "fictional-public-key", storage, windowObject,
      resolveStorageFn: async () => storage,
      createClientFn: (_url, _key, options) => {
        const auth = new GoTrueClient({ ...options.auth, url: "https://fixture.example.test/auth/v1",
          fetch: async (url, init) => {
            if (String(url).endsWith("/logout?scope=global")) return new Response("{}", { status: 200 });
            if (fetchAuth) return fetchAuth(url, init);
            throw new Error("fixture forbids unexpected network");
          } });
        const callbacks = [], subscribe = auth.onAuthStateChange.bind(auth);
        auth.onAuthStateChange = callback => { callbacks.push(callback); return subscribe(callback); };
        clients.push({ auth, lease: options.auth.storage, callbacks }); return { auth };
      },
    });
    return entry;
  };
  const deliver = async () => { for (let i = 0; i < 30 && events.length; i++) { const batch = events.splice(0); batch.forEach(send => send()); await settle(); } };
  const dispose = async () => { for (const entry of windows) entry.manager.destroy(); await Promise.all(clients.map(client => client.auth.dispose())); };
  return { make, values, events, clients, deliver, dispose };
}

for (const operation of ["logout", "invalidation"]) test(`real SDK peer loses cached bearer after ${operation} independently of SDK BroadcastChannel`, async () => {
  const f = originFixture(), one = f.make(), two = f.make();
  try {
    await Promise.all([one.manager.initialize(), two.manager.initialize()]); await f.deliver();
    assert.equal(two.manager.getSnapshot().user.id, A);
    if (operation === "logout") await one.manager.signOut();
    else await one.manager.invalidateSession("fictional expiry", await one.manager.getRequestContext());
    // Event delivery is deliberately paused: a late old refresh still cannot
    // repopulate durable credentials after the origin's verified clear.
    await assert.rejects(f.clients[1].lease.setItem(KEY, JSON.stringify(sessionFor(A))), { code: "auth_storage_retired" });
    assert.equal(f.values.has(KEY), false);
    assert.deepEqual(await two.manager.getRequestContext(), {});
    await f.deliver();
    assert.equal(two.manager.getSnapshot().user, null);
    assert.deepEqual(await two.manager.getRequestContext(), {});
    assert.ok(f.values.get(AUTH_WEB_LIFETIME_KEY));
  } finally { await f.dispose(); }
});

test("delayed old exit events cannot retire a newly restored identity", async () => {
  const f = originFixture(), one = f.make(), two = f.make();
  try {
    await Promise.all([one.manager.initialize(), two.manager.initialize()]); await f.deliver();
    await one.manager.signOut();
    const delayed = f.events.splice(0);
    // A fresh tab commits/loads a later identity while old exit events wait.
    await two.manager.getRequestContext();
    one.storage.setItem(KEY, JSON.stringify(sessionFor(B)));
    await two.manager.initialize();
    assert.equal(two.manager.getSnapshot().user.id, B);
    delayed.forEach(send => send()); await f.deliver(); await settle();
    assert.equal(two.manager.getSnapshot().user.id, B);
    assert.equal((await two.manager.getRequestContext()).accessToken, `fictional-${B}`);
  } finally { await f.dispose(); }
});

test("without Web Locks a real storage removal still propagates logout", async () => {
  const f = originFixture({ locks: false }), one = f.make(), two = f.make();
  try {
    await Promise.all([one.manager.initialize(), two.manager.initialize()]);
    await one.manager.signOut(); await f.deliver();
    assert.equal(two.manager.getSnapshot().user, null);
    assert.deepEqual(await two.manager.getRequestContext(), {});
    assert.equal(f.values.has(AUTH_WEB_LIFETIME_KEY), false);
  } finally { await f.dispose(); }
});

test("SDK expired-refresh rejection fences every peer before storage-event delivery", async () => {
  const f = originFixture({ fetchAuth: async () => new Response(JSON.stringify({ code: "refresh_token_not_found", msg: "fictional rejection" }), { status: 400 }) });
  const one = f.make(), two = f.make();
  try {
    await Promise.all([one.manager.initialize(), two.manager.initialize()]); await f.deliver();
    f.values.set(KEY, JSON.stringify({ ...sessionFor(A), expires_at: 1 }));
    const result = await f.clients[0].auth.refreshSession();
    assert.ok(result.error); await settle();
    assert.equal(f.values.has(KEY), false);
    await assert.rejects(f.clients[1].lease.setItem(KEY, JSON.stringify(sessionFor(A))), { code: "auth_storage_retired" });
    assert.deepEqual(await two.manager.getRequestContext(), {});
    await f.deliver();
    assert.equal(one.manager.getSnapshot().user, null);
    assert.equal(two.manager.getSnapshot().user, null);
  } finally { await f.dispose(); }
});

test("uncoordinated real storage removal is verified and fences an old lease on the next request", async () => {
  const f = originFixture(), one = f.make(), two = f.make();
  try {
    await Promise.all([one.manager.initialize(), two.manager.initialize()]); await f.deliver();
    one.storage.removeItem(KEY);
    assert.deepEqual(await two.manager.getRequestContext(), {});
    await assert.rejects(f.clients[0].lease.setItem(KEY, JSON.stringify(sessionFor(A))), { code: "auth_storage_retired" });
    await f.deliver(); assert.equal(one.manager.getSnapshot().user, null);
  } finally { await f.dispose(); }
});

test("an invalid session removed during SDK initialization recovers anonymously", async () => {
  const f = originFixture(), one = f.make();
  try {
    f.values.set(KEY, JSON.stringify({ invalid: true }));
    await one.manager.initialize();
    assert.equal(one.manager.getSnapshot().status, "anonymous");
    assert.equal(one.manager.getSnapshot().user, null);
    assert.equal(f.values.has(KEY), false);
    assert.deepEqual(await one.manager.getRequestContext(), {});
  } finally { await f.dispose(); }
});

test("a stale anonymous tab signing into B fences the previously committed A lease", async () => {
  const f = originFixture({ fetchAuth: async (_url, init) => {
    const id = JSON.parse(init.body).email === "a@example.invalid" ? A : B;
    return new Response(JSON.stringify(sessionFor(id)), { status: 200 });
  } });
  const one = f.make(), two = f.make();
  try {
    f.values.delete(KEY);
    await Promise.all([one.manager.initialize(), two.manager.initialize()]); await f.deliver();
    await one.manager.signIn({ email: "a@example.invalid", password: "fictional" });
    const old = f.clients.at(-1);
    // Hold storage events/SDK BroadcastChannel so tab 2 is still anonymous.
    assert.equal(two.manager.getSnapshot().user, null);
    await two.manager.signIn({ email: "b@example.invalid", password: "fictional" });
    assert.equal(two.manager.getSnapshot().user.id, B);
    assert.equal(JSON.parse(f.values.get(KEY)).user.id, B);
    await assert.rejects(old.lease.setItem(KEY, JSON.stringify(sessionFor(A))), { code: "auth_storage_retired" });
    await assert.rejects(old.lease.removeItem(KEY), { code: "auth_storage_retired" });
    await f.deliver();
    assert.equal(two.manager.getSnapshot().user.id, B);
  } finally { await f.dispose(); }
});

test("delayed SDK identity/null notifications cannot replace the current persisted B session", async () => {
  const f = originFixture(), one = f.make(), two = f.make();
  try {
    await Promise.all([one.manager.initialize(), two.manager.initialize()]); await f.deliver();
    await one.manager.signOut();
    await two.manager.getRequestContext();
    one.storage.setItem(KEY, JSON.stringify(sessionFor(B)));
    await two.manager.initialize();
    const current = f.clients.at(-1);
    for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "PASSWORD_RECOVERY", "INITIAL_SESSION"]) {
      await current.callbacks[0](event, sessionFor(A));
      assert.equal(two.manager.getSnapshot().user.id, B);
    }
    await current.callbacks[0]("SIGNED_OUT", null); await settle();
    assert.equal(two.manager.getSnapshot().user.id, B);
    assert.equal((await two.manager.getRequestContext()).accessToken, `fictional-${B}`);
  } finally { await f.dispose(); }
});

test("SDK session writes rotate the origin epoch when a Web callback changes identity", async () => {
  const f = originFixture(), one = f.make(), two = f.make();
  try {
    await Promise.all([one.manager.initialize(), two.manager.initialize()]); await f.deliver();
    const old = f.values.get(AUTH_WEB_LIFETIME_KEY);
    await f.clients[0].lease.setItem(KEY, JSON.stringify(sessionFor(B)));
    assert.notEqual(f.values.get(AUTH_WEB_LIFETIME_KEY), old);
    await assert.rejects(f.clients[1].lease.setItem(KEY, JSON.stringify(sessionFor(A))), { code: "auth_storage_retired" });
    await assert.rejects(f.clients[1].lease.removeItem(KEY), { code: "auth_storage_retired" });
    assert.equal(JSON.parse(f.values.get(KEY)).user.id, B);
  } finally { await f.dispose(); }
});

test("a stale anonymous replacement cannot refresh restored A while password login B waits", async () => {
  let enterB, finishB;
  const entered = new Promise(resolve => { enterB = resolve; });
  const finish = new Promise(resolve => { finishB = resolve; });
  const f = originFixture({ fetchAuth: async (url, init) => {
    if (String(url).includes("grant_type=refresh_token")) throw new Error("a replacement for B must not refresh A");
    const id = JSON.parse(init.body).email === "a@example.invalid" ? A : B;
    if (id === B) { enterB(); await finish; }
    return new Response(JSON.stringify({ ...sessionFor(id), expires_at: Math.floor(Date.now() / 1000) + 100 }), { status: 200 });
  } });
  const one = f.make(), two = f.make();
  try {
    f.values.delete(KEY);
    await Promise.all([one.manager.initialize(), two.manager.initialize()]); await f.deliver();
    await one.manager.signIn({ email: "a@example.invalid", password: "fictional" });
    await f.clients.at(-1).auth.stopAutoRefresh();
    const loginB = two.manager.signIn({ email: "b@example.invalid", password: "fictional" }); loginB.catch(() => {});
    await entered;
    assert.equal(f.values.has(KEY), false);
    assert.equal((await f.clients.at(-1).auth.getSession()).data.session, null);
    await new Promise(resolve => setTimeout(resolve, 10));
    finishB(); await loginB;
    assert.equal(two.manager.getSnapshot().user.id, B);
    assert.equal(JSON.parse(f.values.get(KEY)).user.id, B);
  } finally { finishB(); await f.dispose(); }
});
