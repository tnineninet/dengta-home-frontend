import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";
import { GoTrueClient } from "@supabase/auth-js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const COMPANION = "33333333-3333-4333-8333-333333333333";
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("auth initialize times out instead of leaving the app in loading forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred();
  const entered = deferred();
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test",
    supabaseAnonKey: "fictional-public-placeholder",
    storage: storage(),
    createClientFn: () => ({
      auth: {
        getSession: () => { entered.resolve(); return pending.promise; },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    }),
  });
  try {
    const initializing = manager.initialize();
    initializing.catch(() => {});
    await entered.promise;
    t.mock.timers.tick(20_000);
    await assert.rejects(initializing, (error) => error.code === "auth_timeout");
    assert.equal(manager.getSnapshot().status, AUTH_STATUS.error);
  } finally {
    manager.destroy();
  }
});

test("offline signOut still clears the in-memory session", async () => {
  let session = {
    access_token: "fictional-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: ACCOUNT, email: "fictional@example.test" },
  };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test",
    supabaseAnonKey: "fictional-public-placeholder",
    storage: storage(),
    createClientFn: () => ({
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => { throw new Error("fictional offline network failure"); },
      },
    }),
  });
  try {
    await manager.initialize();
    manager.setActiveCompanionId(COMPANION);
    await manager.signOut();
    assert.equal(manager.getSnapshot().status, AUTH_STATUS.anonymous);
    assert.equal(manager.getSnapshot().user, null);
    assert.deepEqual(await manager.getRequestContext(), {});
  } finally {
    manager.destroy();
  }
});

test("restoration timeout fences the old SDK but preserves durable login for retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = deferred(), pending = deferred(), durable = storage(), clients = [];
  durable.setItem("dengta_home_auth_v1", "fictional-durable-session");
  const session = { access_token: "fictional-restored-token", user: { id: ACCOUNT } };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage: durable,
    createClientFn: (_url, _key, options) => {
      const first = clients.length === 0;
      const sdk = { lease: options.auth.storage, auth: {
        getSession: async () => { if (first) { entered.resolve(); return pending.promise; } return { data: { session }, error: null }; },
        onAuthStateChange: callback => { sdk.emit = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      } };
      clients.push(sdk); return sdk;
    },
  });
  try {
    const initialization = manager.initialize(); initialization.catch(() => {});
    await entered.promise; t.mock.timers.tick(20_000);
    await assert.rejects(initialization, { code: "auth_timeout" });
    assert.equal(durable.getItem("dengta_home_auth_v1"), "fictional-durable-session");
    await manager.initialize();
    pending.resolve({ data: { session: { access_token: "fictional-stale", user: { id: COMPANION } } }, error: null });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    await assert.rejects(clients[0].lease.setItem("dengta_home_auth_v1", "fictional-stale"), { code: "auth_storage_retired" });
    clients[0].emit("SIGNED_IN", { access_token: "fictional-stale", user: { id: COMPANION } });
    assert.equal(manager.getSnapshot().user.id, ACCOUNT);
    assert.equal(durable.getItem("dengta_home_auth_v1"), "fictional-durable-session");
  } finally { pending.resolve({ data: { session: null }, error: null }); manager.destroy(); }
});

test("explicit logout upgrades a pending timeout drain to verified credential removal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = deferred(), finish = deferred(), durable = storage();
  const key = "dengta_home_auth_v1";
  durable.setItem(key, "fictional-durable-session");
  const get = durable.getItem; let first = true;
  durable.getItem = async name => { if (first) { first = false; entered.resolve(); await finish.promise; } return get(name); };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage: durable,
    createClientFn: (_url, _key, options) => ({ auth: {
      getSession: async () => { await options.auth.storage.getItem(key); return { data: { session: null }, error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }),
  });
  try {
    const initialization = manager.initialize(); initialization.catch(() => {});
    await entered.promise; t.mock.timers.tick(20_000);
    await assert.rejects(initialization, { code: "auth_timeout" });
    let cleared = false;
    const exit = manager.signOut().then(() => { cleared = true; });
    await Promise.resolve(); assert.equal(cleared, false);
    finish.resolve(); await exit;
    assert.equal(await durable.getItem(key), null);
    await manager.initialize(); assert.equal(manager.getSnapshot().user, null);
  } finally { finish.resolve(); manager.destroy(); }
});

test("real GoTrue delayed initialization cannot revive a retired client's browser resources", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const names = ["window", "document", "BroadcastChannel"];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const entered = deferred(), finish = deferred(), listeners = new Set(), channels = [];
  let visibilityAdds = 0, requests = 0, auth;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { href: "https://fixture.example.test/" },
    addEventListener(type, listener) { if (type === "visibilitychange") { visibilityAdds++; listeners.add(listener); } },
    removeEventListener(type, listener) { if (type === "visibilitychange") listeners.delete(listener); },
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible" } });
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: class {
    constructor() { this.closed = false; channels.push(this); }
    addEventListener() {}
    postMessage() {}
    close() { this.closed = true; }
  } });
  const durable = storage(); const get = durable.getItem; let first = true;
  durable.getItem = async key => { if (first) { first = false; entered.resolve(); await finish.promise; } return get(key); };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage: durable,
    resolveStorageFn: async () => durable,
    createClientFn: (_url, _key, options) => {
      auth = new GoTrueClient({ ...options.auth, url: "https://fictional.example.test/auth/v1",
        fetch: async () => { requests++; throw new Error("fixture forbids network"); } });
      return { auth };
    },
  });
  try {
    const initialization = manager.initialize(); initialization.catch(() => {});
    await entered.promise;
    for (let i = 0; i < 40; i++) await Promise.resolve();
    t.mock.timers.tick(20_000);
    await assert.rejects(initialization, { code: "auth_timeout" });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    assert.equal(channels.length, 1); assert.equal(channels[0].closed, true);
    finish.resolve(); await auth.initialize();
    for (let i = 0; i < 60; i++) await Promise.resolve();
    assert.ok(visibilityAdds > 0, "real SDK finally installed its visibility listener");
    assert.equal(listeners.size, 0);
    assert.equal(auth.broadcastChannel, null);
    assert.equal(auth.visibilityChangedCallback, null);
    assert.equal(auth.autoRefreshTicker, null);
    assert.equal(auth.autoRefreshTickTimeout, null);
    assert.equal(requests, 0);
  } finally {
    finish.resolve(); manager.destroy(); await auth?.dispose();
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});
