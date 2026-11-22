import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";

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
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test",
    supabaseAnonKey: "fictional-public-placeholder",
    storage: storage(),
    createClientFn: () => ({
      auth: {
        getSession: () => pending.promise,
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    }),
  });
  try {
    const initializing = manager.initialize();
    initializing.catch(() => {});
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
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
