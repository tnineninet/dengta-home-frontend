import assert from "node:assert/strict";
import {
  AUTH_STATUS,
  createAuthSessionManager,
} from "../src/auth-session.js";
import { apiRequest } from "../src/api.js";

const USER_A = "16f55997-2340-4d2b-b02e-8a1960f9863a";
const USER_B = "5bc81bf8-ab26-4a9b-badc-08dc98c70d24";
const COMPANION_A = "6ed80959-269f-46fd-805d-6685d4e7d6d6";
const COMPANION_B = "efae62e8-b84a-44b2-955b-4f1fc1eef810";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function sessionFor(userId, token) {
  return {
    access_token: token,
    user: {
      id: userId,
      email: `${userId.slice(0, 4)}@example.com`,
      email_confirmed_at: "2026-07-26T00:00:00.000Z",
    },
  };
}

function createFakeSupabase(initialSession = null, { signUpIdentities, signUpConfirmed = false, signUpError = null } = {}) {
  let session = initialSession;
  let listener = null;
  const calls = {
    getSession: 0,
    signUp: [],
    signIn: [],
    signOut: [],
    resend: [],
    resetPassword: [],
    updateUser: [],
    unsubscribe: 0,
  };
  const auth = {
    onAuthStateChange(callback) {
      listener = callback;
      return {
        data: {
          subscription: {
            unsubscribe() {
              calls.unsubscribe += 1;
            },
          },
        },
      };
    },
    async getSession() {
      calls.getSession += 1;
      return { data: { session }, error: null };
    },
    async signUp(payload) {
      calls.signUp.push(payload);
      if (signUpError) return { data: { user: null, session: null }, error: signUpError };
      return {
        data: {
          user: {
            id: USER_A,
            email: payload.email,
            ...(signUpConfirmed ? { email_confirmed_at: "2026-10-23T00:00:00.000Z" } : {}),
            ...(signUpIdentities === undefined ? {} : { identities: signUpIdentities }),
          },
          session: null,
        },
        error: null,
      };
    },
    async signInWithPassword(payload) {
      calls.signIn.push(payload);
      session = sessionFor(USER_A, "access-a");
      listener?.("SIGNED_IN", session);
      return { data: { user: session.user, session }, error: null };
    },
    async signOut(options) {
      calls.signOut.push(options);
      session = null;
      listener?.("SIGNED_OUT", null);
      return { error: null };
    },
    async resend(payload) {
      calls.resend.push(payload);
      return { error: null };
    },
    async resetPasswordForEmail(email, options) {
      calls.resetPassword.push({ email, options });
      return { error: null };
    },
    async updateUser(payload) {
      calls.updateUser.push(payload);
      return { data: { user: session?.user || null }, error: null };
    },
  };
  return {
    client: { auth },
    calls,
    setSession(nextSession) {
      const changedAccount = session?.user?.id !== nextSession?.user?.id;
      session = nextSession;
      listener?.(changedAccount ? "SIGNED_IN" : "TOKEN_REFRESHED", session);
    },
    enterPasswordRecovery(nextSession) {
      session = nextSession;
      listener?.("PASSWORD_RECOVERY", session);
    },
  };
}

{
  const storage = createStorage();
  const fake = createFakeSupabase(sessionFor(USER_A, "restored-token"));
  const factoryCalls = [];
  const manager = createAuthSessionManager({
    supabaseUrl: "https://example.supabase.co/",
    supabaseAnonKey: "public-anon-key",
    storage,
    createClientFn(url, key, options) {
      factoryCalls.push({ url, key, options });
      return fake.client;
    },
  });

  await manager.initialize();
  assert.equal(factoryCalls.length, 1);
  assert.equal(factoryCalls[0].url, "https://example.supabase.co");
  assert.equal(factoryCalls[0].key, "public-anon-key");
  assert.equal(factoryCalls[0].options.auth.persistSession, true);
  assert.equal(factoryCalls[0].options.auth.autoRefreshToken, true);
  assert.equal(factoryCalls[0].options.auth.detectSessionInUrl, true);
  const sdkStorage = factoryCalls[0].options.auth.storage;
  assert.notEqual(sdkStorage, storage, "each SDK owns a revocable lease");
  await sdkStorage.setItem("dengta_home_auth_v1", "fictional-persisted-session");
  assert.equal(storage.getItem("dengta_home_auth_v1"), "fictional-persisted-session");
  assert.equal(manager.getSnapshot().status, AUTH_STATUS.authenticated);
  assert.deepEqual(await manager.getRequestContext(), {
    accessToken: "restored-token",
    companionId: "",
  });

  manager.setActiveCompanionId(COMPANION_A);
  assert.deepEqual(await manager.getRequestContext(), {
    accessToken: "restored-token",
    companionId: COMPANION_A,
  });

  fake.setSession(sessionFor(USER_B, "access-b"));
  assert.deepEqual(await manager.getRequestContext(), {
    accessToken: "access-b",
    companionId: "",
  });
  manager.setActiveCompanionId(COMPANION_B);
  assert.deepEqual(await manager.getRequestContext(), {
    accessToken: "access-b",
    companionId: COMPANION_B,
  });

  fake.setSession(sessionFor(USER_A, "access-a"));
  assert.deepEqual(await manager.getRequestContext(), {
    accessToken: "access-a",
    companionId: COMPANION_A,
  });
  assert.equal(
    fake.calls.getSession,
    1,
    "authenticated API requests must reuse the in-memory session instead of reacquiring the Supabase lock",
  );

  const captured = manager.captureCompanionFromResponse({
    headers: { get: () => COMPANION_B },
  });
  assert.equal(captured, COMPANION_B);
  assert.equal(manager.getSnapshot().activeCompanionId, COMPANION_B);

  await manager.signOut();
  assert.deepEqual(fake.calls.signOut, [undefined]);
  assert.equal(manager.getSnapshot().status, AUTH_STATUS.anonymous);
  assert.deepEqual(await manager.getRequestContext(), {});
  manager.destroy();
  assert.equal(fake.calls.unsubscribe, 1);
}

{
  const fake = createFakeSupabase();
  const manager = createAuthSessionManager({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    storage: createStorage(),
    createClientFn: () => fake.client,
  });
  const registration = await manager.signUp({
    email: "  TAOTAO@Example.com ",
    password: "not-a-real-password",
    displayName: " 桃桃 ",
    emailRedirectTo: "https://app.example.com/auth",
  });
  assert.equal(registration.emailVerificationRequired, true);
  assert.deepEqual(fake.calls.signUp[0], {
    email: "taotao@example.com",
    password: "not-a-real-password",
    options: {
      data: { display_name: "桃桃" },
      emailRedirectTo: "https://app.example.com/auth",
    },
  });

  await manager.resendVerification({
    email: " TAOTAO@example.com ",
    emailRedirectTo: "https://app.example.com/auth",
  });
  assert.equal(fake.calls.resend[0].email, "taotao@example.com");

  await manager.requestPasswordReset({
    email: " TAOTAO@example.com ",
    redirectTo: "https://app.example.com/",
  });
  assert.deepEqual(fake.calls.resetPassword[0], {
    email: "taotao@example.com",
    options: { redirectTo: "https://app.example.com/" },
  });

  await manager.signIn({
    email: " TAOTAO@example.com ",
    password: "not-a-real-password",
  });
  assert.equal(fake.calls.signIn[0].email, "taotao@example.com");
  assert.equal(manager.getSnapshot().status, AUTH_STATUS.authenticated);

  fake.enterPasswordRecovery(sessionFor(USER_A, "recovery-token"));
  assert.equal(manager.getSnapshot().status, AUTH_STATUS.recovery);
  await manager.updatePassword({ password: "new-private-password" });
  assert.deepEqual(fake.calls.updateUser[0], {
    password: "new-private-password",
  });
  assert.equal(manager.getSnapshot().status, AUTH_STATUS.authenticated);
}

{
  const cases = [
    { label: "wrong password", error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" }, expected: "invalid_credentials", text: "邮箱或密码不正确" },
    { label: "network blocked", error: Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 }), expected: "auth_network_unavailable", text: "不是密码错误" },
    { label: "paused service", error: { code: "unexpected_failure", status: 503, message: "Service unavailable" }, expected: "auth_service_unavailable", text: "不是密码错误" },
    { label: "rate limited", error: { code: "over_request_rate_limit", status: 429, message: "Too many requests" }, expected: "auth_rate_limited", text: "不是密码错误" },
  ];
  for (const item of cases) {
    const manager = createAuthSessionManager({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-anon-key",
      storage: createStorage(),
      createClientFn: () => ({ auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithPassword: async () => ({ data: { session: null }, error: item.error }),
      } }),
    });
    await assert.rejects(manager.signIn({ email: "user@example.com", password: "password" }), error => {
      assert.equal(error.code, item.expected, item.label);
      assert.match(error.message, new RegExp(item.text));
      return true;
    });
  }
}

{
  const manager = createAuthSessionManager({
    supabaseUrl: "",
    supabaseAnonKey: "",
    storage: createStorage(),
  });
  assert.equal(manager.isConfigured(), false);
  assert.deepEqual(await manager.getRequestContext(), {});
  await assert.rejects(
    manager.signIn({ email: "a@example.com", password: "password" }),
    (error) => error.code === "auth_not_configured",
  );
  await assert.rejects(
    manager.requestPasswordReset({ email: "a@example.com" }),
    (error) => error.code === "auth_not_configured",
  );
}

{
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let receivedHeaders = null;
  let capturedResponse = false;
  const requestAuthSession = {
    async getRequestContext() {
      return {
        accessToken: "session-token",
        companionId: COMPANION_A,
      };
    },
    captureCompanionFromResponse() {
      capturedResponse = true;
    },
  };
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async (_url, options) => {
    receivedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() {
        return { ok: true };
      },
    };
  };
  try {
    assert.deepEqual(
      await apiRequest("/api/v2/account", {
        authSession: requestAuthSession,
      }),
      { ok: true },
    );
    assert.equal(
      receivedHeaders.get("Authorization"),
      "Bearer session-token",
    );
    assert.equal(
      receivedHeaders.get("X-DengTa-Companion-Id"),
      COMPANION_A,
    );
    assert.equal(receivedHeaders.get("Content-Type"), "application/json");
    assert.equal(capturedResponse, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

{
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let invalidatedMessage = "";
  const requestAuthSession = {
    async getRequestContext() {
      return { accessToken: "expired-token" };
    },
    invalidateSession(message) {
      invalidatedMessage = message;
    },
  };
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    headers: { get: () => null },
    async json() {
      return {
        code: "invalid_session",
        message: "登录状态已失效，请重新登录。",
      };
    },
  });
  try {
    await assert.rejects(
      apiRequest("/api/v2/account", {
        retry: false,
        authSession: requestAuthSession,
      }),
      (error) =>
        error.status === 401 &&
        error.code === "invalid_session" &&
        error.message === "登录状态已失效，请重新登录。",
    );
    assert.equal(invalidatedMessage, "登录状态已失效，请重新登录。");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

{
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let fetchCalls = 0;
  const hangingAuthSession = {
    getRequestContext() {
      return new Promise(() => {});
    },
  };
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not start before the auth context is ready");
  };
  try {
    await assert.rejects(
      Promise.race([
        apiRequest("/api/v2/settings", {
          retry: false,
          timeoutMs: 25,
          authSession: hangingAuthSession,
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("test_deadlock")), 250);
        }),
      ]),
      (error) => error.code === "request_timeout",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

{
  const fake = createFakeSupabase(null, { signUpIdentities: [] });
  const manager = createAuthSessionManager({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    storage: createStorage(),
    createClientFn: () => fake.client,
  });
  const registration = await manager.signUp({
    email: "already-registered@example.com",
    password: "not-a-real-password",
  });
  assert.equal(
    registration.existingAccount,
    true,
    "Supabase returns an obfuscated user with empty identities when the email already exists",
  );
  assert.equal(registration.emailVerificationRequired, false);
  assert.equal(manager.getSnapshot().status, AUTH_STATUS.anonymous);
  manager.destroy();
}

{
  const fake = createFakeSupabase(null, { signUpIdentities: [{ id: "identity-a" }] });
  const manager = createAuthSessionManager({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    storage: createStorage(),
    createClientFn: () => fake.client,
  });
  const registration = await manager.signUp({
    email: "fresh@example.com",
    password: "not-a-real-password",
  });
  assert.equal(registration.existingAccount, false);
  assert.equal(registration.emailVerificationRequired, true);
  manager.destroy();
}

{
  const originalFetch = globalThis.fetch;
  const fake = createFakeSupabase();
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://example.supabase.co/auth/v1/settings");
      assert.equal(options.headers.apikey, "public-anon-key");
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const manager = createAuthSessionManager({
      supabaseUrl: "https://example.supabase.co/",
      supabaseAnonKey: "public-anon-key",
      storage: createStorage(),
      createClientFn: () => fake.client,
    });
    const reachable = await manager.checkConnectivity();
    assert.equal(reachable.ok, true);
    assert.equal(reachable.status, 200);
    assert.equal(typeof reachable.ms, "number");

    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const blocked = await manager.checkConnectivity();
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "network");
    manager.destroy();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const fake = createFakeSupabase(null, { signUpConfirmed: true });
  const manager = createAuthSessionManager({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    storage: createStorage(),
    createClientFn: () => fake.client,
  });
  const registration = await manager.signUp({
    email: "confirmed@example.com",
    password: "not-a-real-password",
  });
  assert.equal(registration.emailConfirmed, true);
  assert.equal(registration.emailVerificationRequired, false);
  assert.equal(registration.existingAccount, false);
  manager.destroy();
}

{
  const fake = createFakeSupabase(null, {
    signUpError: { code: "user_already_exists", status: 422, message: "User already registered" },
  });
  const manager = createAuthSessionManager({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    storage: createStorage(),
    createClientFn: () => fake.client,
  });
  const registration = await manager.signUp({
    email: "duplicate@example.com",
    password: "not-a-real-password",
  });
  assert.equal(registration.existingAccount, true);
  assert.equal(registration.emailVerificationRequired, false);
  assert.equal(manager.getSnapshot().status, AUTH_STATUS.anonymous);
  manager.destroy();
}

console.log("Supabase 认证会话与统一 API 请求头测试通过。");
