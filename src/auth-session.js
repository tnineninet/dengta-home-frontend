import { GoTrueClient } from "@supabase/auth-js";
import { resolveAuthStorage } from "./auth-native-storage.js";
import { createAuthStorageLease } from "./auth-storage-lease.js";
import { parseNativeAuthCallback } from "./native-app-runtime.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANION_STORAGE_PREFIX = "dengta_active_companion_id_v1:";
const AUTH_STORAGE_KEY = "dengta_home_auth_v1";

const DEFAULT_SUPABASE_URL = String(
  import.meta.env?.VITE_SUPABASE_URL || "",
).trim();
const DEFAULT_SUPABASE_ANON_KEY = String(
  import.meta.env?.VITE_SUPABASE_ANON_KEY || "",
).trim();

function createAuthOnlyClient(supabaseUrl, supabaseAnonKey, options = {}) {
  return {
    auth: new GoTrueClient({
      url: `${supabaseUrl}/auth/v1`,
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
        "X-Client-Info": "dengta-home/auth-js",
      },
      ...options.auth,
    }),
  };
}

export const AUTH_STATUS = Object.freeze({
  unconfigured: "unconfigured",
  loading: "loading",
  anonymous: "anonymous",
  authenticating: "authenticating",
  recovery: "recovery",
  authenticated: "authenticated",
  expired: "expired",
  error: "error",
});

export class AuthSessionError extends Error {
  constructor(message, { code = "auth_error", status = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AuthSessionError";
    this.code = code;
    this.status = status;
  }
}

function withAuthTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = globalThis.setTimeout(() => {
        reject(new AuthSessionError(message, { code: "auth_timeout" }));
      }, milliseconds);
    }),
  ]).finally(() => globalThis.clearTimeout(timer));
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function storageForBrowser(candidate) {
  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  ) {
    return candidate;
  }
  return undefined;
}

function companionStorageKey(userId) {
  return `${COMPANION_STORAGE_PREFIX}${userId}`;
}

function readCompanionId(storage, userId) {
  if (!storage || !userId) return "";
  try {
    const value = String(storage.getItem(companionStorageKey(userId)) || "");
    return UUID_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}

function storeCompanionId(storage, userId, companionId) {
  if (!storage || !userId || !UUID_PATTERN.test(companionId)) return;
  try {
    storage.setItem(companionStorageKey(userId), companionId);
  } catch {
    // A blocked storage backend only disables companion persistence.
  }
}

function authFailure(error, fallbackMessage) {
  const rawCode = String(error?.details?.code || error?.code || "");
  const status = Number(error?.status || 0);
  const messageText = String(error?.message || "");
  // 网络不可达时 Supabase SDK 往往不带业务 code，旧逻辑会退化成 auth_error，
  // 看起来像"密码错误"。这里把网络/服务端故障和真正的凭据错误分开。
  const networkCode = !rawCode || rawCode === "request_failed" || rawCode === "unexpected_failure";
  const networkFailure = networkCode && (error?.name === "AuthRetryableFetchError" || status === 0 ||
    /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(messageText));
  const rateLimited = status === 429 || rawCode === "over_request_rate_limit" || rawCode === "over_email_send_rate_limit";
  const code = networkFailure ? "auth_network_unavailable"
    : status >= 500 ? "auth_service_unavailable"
      : rawCode === "over_email_send_rate_limit" ? "over_email_send_rate_limit"
        : rateLimited ? "auth_rate_limited"
          : rawCode || "auth_error";
  const messages = {
    invalid_credentials: "邮箱或密码不正确。",
    auth_network_unavailable: "暂时连不上登录服务（不是密码错误）。请先切换 Wi-Fi/移动网络再试；在中国大陆网络下登录服务常被阻断，需要开启网络加速。",
    auth_service_unavailable: "登录服务暂时不可用（不是密码错误），请稍后再试。",
    auth_rate_limited: "尝试太频繁（不是密码错误），请等几分钟再试。",
    over_email_send_rate_limit: "验证邮件发送太频繁（服务商每小时限制少量邮件）。请不要再连续点重发，等一段时间后再试；也可以先用已收到的旧邮件完成验证。",
    email_not_confirmed: "邮箱尚未验证。请打开最新的验证邮件；链接失效时可在这里重新发送，不需要重新注册。",
    email_not_verified: "邮箱尚未验证。请打开最新的验证邮件；链接失效时可在这里重新发送，不需要重新注册。",
    otp_expired: "邮箱验证链接已过期或已使用。若已完成验证，请用注册时的邮箱和密码登录；否则重新发送验证邮件并打开最新一封。",
    access_denied: "邮箱验证未完成，请重新发送验证邮件并打开最新链接。",
    user_already_exists: "这个邮箱已经注册，请直接登录。",
    user_already_registered: "这个邮箱已经注册，请直接登录。",
    weak_password: "密码强度不足，请换一个更长、更难猜的密码。",
    validation_failed: "邮箱或密码格式不正确。",
    signup_disabled: "登录服务当前关闭了自助注册，请稍后再试或联系管理员。",
  };
  return new AuthSessionError(
    `${messages[code] || fallbackMessage || "账号操作失败，请稍后再试。"}（错误代码：${/^[a-z0-9_]{1,80}$/i.test(code) ? code : "auth_error"}）`,
    {
      code,
      status: Number(error?.status || 0),
      cause: error,
    },
  );
}

function publicUser(session) {
  const user = session?.user;
  if (!user?.id) return null;
  return Object.freeze({
    id: user.id,
    email: user.email || "",
    displayName: String(user.user_metadata?.display_name || "")
      .trim()
      .slice(0, 80),
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
  });
}

function configured(supabaseUrl, supabaseAnonKey) {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function createAuthSessionManager({
  supabaseUrl = DEFAULT_SUPABASE_URL,
  supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY,
  storage = globalThis.localStorage,
  createClientFn = createAuthOnlyClient,
  resolveStorageFn = resolveAuthStorage,
} = {}) {
  const normalizedUrl = String(supabaseUrl || "").trim().replace(/\/$/, "");
  const normalizedKey = String(supabaseAnonKey || "").trim();
  const persistentStorage = storageForBrowser(storage);
  const listeners = new Set();
  let client = null;
  let clientRecord = null;
  let lifecycle = 0;
  let cleanupRecord = null;
  let cleanupPromise = null;
  let identityQueue = Promise.resolve();
  const requestContexts = new WeakMap();
  let initialization = null;
  let authSubscription = null;
  let session = null;
  let sessionRevision = 0;
  let scopeRevision = 0;
  let passwordRecovery = false;
  let callbackInitializationChecked = false;
  let snapshot = Object.freeze({
    status: configured(normalizedUrl, normalizedKey)
      ? AUTH_STATUS.loading
      : AUTH_STATUS.unconfigured,
    user: null,
    activeCompanionId: "",
    error: null,
    cleanupState: "",
  });

  function publish(next) {
    const previous = snapshot;
    snapshot = Object.freeze({ ...snapshot, ...next });
    if (previous.user?.id !== snapshot.user?.id || previous.activeCompanionId !== snapshot.activeCompanionId) scopeRevision += 1;
    listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  function applySession(nextSession, status) {
    session = nextSession || null;
    sessionRevision += 1;
    const user = publicUser(session);
    return publish({
      status:
        status ||
        (session ? AUTH_STATUS.authenticated : AUTH_STATUS.anonymous),
      user,
      activeCompanionId: readCompanionId(persistentStorage, user?.id),
      error: null,
    });
  }

  function applyRecoverySession(nextSession) {
    passwordRecovery = true;
    session = nextSession || null;
    sessionRevision += 1;
    const user = publicUser(session);
    return publish({
      status: AUTH_STATUS.recovery,
      user,
      activeCompanionId: readCompanionId(persistentStorage, user?.id),
      error: null,
    });
  }

  function requireConfiguration() {
    if (!configured(normalizedUrl, normalizedKey)) {
      throw new AuthSessionError(
        "DengTa Home 尚未配置 Supabase 登录服务。",
        { code: "auth_not_configured" },
      );
    }
  }

  function staleOperation() {
    return new AuthSessionError("账号操作已取消，请重新操作。", { code: "auth_operation_cancelled" });
  }

  function isCurrent(record) {
    return record && clientRecord === record && !record.retired && record.generation === lifecycle;
  }

  function assertCurrent(record) {
    if (!isCurrent(record)) throw staleOperation();
  }

  function resolveLease(record) {
    return Promise.resolve().then(() => resolveStorageFn({ storage: persistentStorage }))
      .then(storage => {
        record.lease = createAuthStorageLease(storage);
        return record.lease;
      });
  }

  function newRecord() {
    const record = { generation: lifecycle, retired: false, lease: null, client: null };
    record.ready = resolveLease(record);
    return record;
  }

  function cleanupFailure() {
    return new AuthSessionError("安全登录存储尚未清理。请解锁设备后重试清理，再重新登录。", { code: "auth_cleanup_failed" });
  }

  function clearRetiredRecord(record, retry = false) {
    if (cleanupPromise) return cleanupPromise;
    if (retry && !record.lease) record.ready = resolveLease(record);
    const clear = (record.lease
      ? record.lease.retireAndClear()
      : record.ready.then(lease => lease?.retireAndClear()))
      .then(() => {
        if (cleanupRecord === record) {
          cleanupRecord = null;
          publish({ cleanupState: "" });
        }
      }).catch(() => {
        if (cleanupRecord === record) publish({ status: AUTH_STATUS.error, cleanupState: "failed", error: cleanupFailure() });
        throw cleanupFailure();
      }).finally(() => {
        if (cleanupPromise === clear) cleanupPromise = null;
      });
    cleanupPromise = clear;
    return clear;
  }

  function retireCurrent({ status = AUTH_STATUS.anonymous, error = null, revoke = false } = {}) {
    if (cleanupRecord) return cleanupPromise || Promise.reject(cleanupFailure());
    const record = clientRecord || newRecord();
    record.retired = true;
    lifecycle += 1;
    clientRecord = null;
    client = null;
    initialization = null;
    identityQueue = Promise.resolve();
    callbackInitializationChecked = false;
    authSubscription?.unsubscribe?.();
    authSubscription = null;
    try { Promise.resolve(record.client?.auth.stopAutoRefresh?.()).catch(() => {}); } catch { /* Already stopped. */ }
    // Revoke directly with the captured token where the SDK supports it. The
    // sealed SDK storage must never be reopened to perform server logout.
    if (revoke && record.client) {
      try {
        const auth = record.client.auth;
        const operation = auth.admin?.signOut && session?.access_token
          ? auth.admin.signOut(session.access_token, "global")
          : auth.signOut?.();
        Promise.resolve(operation).catch(() => {});
      } catch { /* Local revocation is authoritative when offline. */ }
    }
    passwordRecovery = false;
    session = null;
    sessionRevision += 1;
    scopeRevision += 1;
    cleanupRecord = record;
    // retireAndClear is called synchronously when the lease already exists.
    const clear = clearRetiredRecord(record);
    if (!revoke && record.client) {
      // Best-effort SDK-local disposal runs through its already sealed lease;
      // it cannot read/write/remove credentials belonging to the next client.
      try { Promise.resolve(record.client.auth.signOut?.({ scope: "local" })).catch(() => {}); } catch { /* Already detached. */ }
    }
    publish({ status, user: null, activeCompanionId: "", error, cleanupState: "pending" });
    return clear;
  }

  async function retryAuthCleanup() {
    if (!cleanupRecord) return snapshot;
    publish({ cleanupState: "pending", error: null });
    await clearRetiredRecord(cleanupRecord, true);
    return publish({ status: AUTH_STATUS.anonymous, error: null });
  }

  async function ensureClient() {
    requireConfiguration();
    if (cleanupRecord) {
      if (!cleanupPromise) throw cleanupFailure();
      await cleanupPromise;
    }
    if (!clientRecord) {
      const record = newRecord();
      clientRecord = record;
      record.creation = record.ready.then(lease => {
        assertCurrent(record);
        record.client = createClientFn(normalizedUrl, normalizedKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: lease,
            storageKey: AUTH_STORAGE_KEY,
          },
        });
        client = record.client;
        return client;
      }).catch(error => {
        if (isCurrent(record)) clientRecord = null;
        throw error;
      });
    }
    return clientRecord.creation;
  }

  async function initialize() {
    if (!configured(normalizedUrl, normalizedKey)) return snapshot;
    if (initialization) return initialization;

    const generation = lifecycle;
    initialization = (async () => {
      const authClient = await withAuthTimeout(ensureClient(), 20_000, "登录服务响应超时，请检查网络后重试。");
      if (generation !== lifecycle) throw staleOperation();
      const record = clientRecord;
      assertCurrent(record);
      publish({ status: AUTH_STATUS.loading, error: null });

      // getSession() awaits SDK initialization but does not return its callback error.
      // Consume that result once so a failed email link cannot block password login.
      if (!callbackInitializationChecked && authClient.auth.initialize) {
        callbackInitializationChecked = true;
        const { error } = await withAuthTimeout(
          authClient.auth.initialize(),
          20_000,
          "登录服务响应超时，请检查网络后重试。",
        );
        assertCurrent(record);
        if (error) {
          const restored = await withAuthTimeout(
            authClient.auth.getSession(),
            20_000,
            "登录服务响应超时，请检查网络后重试。",
          );
          assertCurrent(record);
          if (!restored.data?.session?.user?.id) {
            throw authFailure(error, "邮箱链接验证失败，请重新发送验证邮件，或使用已验证的邮箱和密码登录。");
          }
        }
      }

      if (!authSubscription) {
        const result = authClient.auth.onAuthStateChange(
          (event, nextSession) => {
            if (!isCurrent(record)) return;
            if (["TOKEN_REFRESHED", "USER_UPDATED", "INITIAL_SESSION"].includes(event) && session?.user?.id && nextSession?.user?.id && session.user.id !== nextSession.user.id) return;
            if (event === "PASSWORD_RECOVERY") {
              applyRecoverySession(nextSession);
              return;
            }
            if (event === "SIGNED_OUT") passwordRecovery = false;
            applySession(
              nextSession,
              passwordRecovery ? AUTH_STATUS.recovery : undefined,
            );
          },
        );
        authSubscription = result?.data?.subscription || null;
      }

      const restoreRevision = sessionRevision;
      const { data, error } = await withAuthTimeout(
        authClient.auth.getSession(),
        20_000,
        "登录服务响应超时，请检查网络后重试。",
      );
      assertCurrent(record);
      if (restoreRevision !== sessionRevision) return snapshot;
      if (error) {
        throw authFailure(error, "无法恢复登录状态，请重新登录。");
      }
      return passwordRecovery
        ? applyRecoverySession(data?.session || null)
        : applySession(data?.session || null);
    })().catch((error) => {
      if (generation !== lifecycle) throw staleOperation();
      initialization = null;
      if (error?.code === "auth_timeout") void retireCurrent().catch(() => {});
      publish({
        status: AUTH_STATUS.error,
        error:
          error instanceof AuthSessionError
            ? error
            : authFailure(error, "无法恢复登录状态，请重新登录。"),
      });
      throw error;
    });

    return initialization;
  }

  async function initializedRecord() {
    const generation = lifecycle;
    await initialize();
    if (generation !== lifecycle) throw staleOperation();
    const record = clientRecord;
    assertCurrent(record);
    return record;
  }

  function invokeAuth(record, method, ...args) {
    assertCurrent(record);
    return record.client.auth[method](...args);
  }

  async function freshIdentityRecord() {
    const record = await initializedRecord();
    assertCurrent(record);
    if (!session?.user?.id) return record;
    // Changing identity must not share persistence with an in-flight refresh
    // from the previous account, even if that refresh's event is ignored.
    await retireCurrent();
    return initializedRecord();
  }

  function serializeIdentity(operation) {
    return (...args) => {
      const generation = lifecycle;
      const run = identityQueue.then(() => {
        if (generation !== lifecycle) throw staleOperation();
        return operation(...args);
      });
      identityQueue = run.catch(() => {});
      return run;
    };
  }

  async function identityDeadline(record, operation, milliseconds, message) {
    try {
      return await withAuthTimeout(operation, milliseconds, message);
    } catch (error) {
      if (isCurrent(record) && error?.code === "auth_timeout") {
        void retireCurrent({ status: AUTH_STATUS.error, error }).catch(() => {});
      }
      throw error;
    }
  }

  async function signUp({
    email,
    password,
    displayName = "",
    emailRedirectTo,
  } = {}) {
    requireConfiguration();
    const record = await freshIdentityRecord();
    publish({ status: AUTH_STATUS.authenticating, error: null });
    const options = {};
    const normalizedDisplayName = String(displayName || "").trim().slice(0, 80);
    if (normalizedDisplayName) {
      options.data = { display_name: normalizedDisplayName };
    }
    if (emailRedirectTo) {
      options.emailRedirectTo = String(emailRedirectTo);
    }
    const { data, error } = await invokeAuth(record, "signUp", {
      email: cleanEmail(email),
      password: String(password || ""),
      ...(Object.keys(options).length ? { options } : {}),
    });
    assertCurrent(record);
    if (error) {
      const failure = authFailure(error, "注册失败，请稍后再试。");
      publish({ status: AUTH_STATUS.anonymous, error: failure });
      const alreadyRegistered =
        failure.code === "user_already_exists" ||
        failure.code === "user_already_registered" ||
        /already registered|already exists/i.test(String(error?.message || ""));
      if (alreadyRegistered) {
        return {
          user: null,
          session: null,
          existingAccount: true,
          emailConfirmed: false,
          emailVerificationRequired: false,
        };
      }
      throw failure;
    }
    applySession(data?.session || null);
    // Supabase 在邮箱已注册时不会报错，而是返回一个 identities 为空的占位用户，
    // 也不会真正发送新的验证邮件。必须区分出来，不能提示"验证邮件已发出"。
    const existingAccount =
      !data?.session &&
      Array.isArray(data?.user?.identities) &&
      data.user.identities.length === 0;
    const emailConfirmed = Boolean(
      data?.user?.email_confirmed_at || data?.user?.confirmed_at
    );
    return {
      user: data?.user || null,
      session: data?.session || null,
      emailConfirmed,
      emailVerificationRequired:
        !data?.session && !existingAccount && !emailConfirmed,
      existingAccount,
    };
  }

  async function signIn({ email, password } = {}) {
    requireConfiguration();
    const record = await freshIdentityRecord();
    publish({ status: AUTH_STATUS.authenticating, error: null });
    const { data, error } = await identityDeadline(record,
      invokeAuth(record, "signInWithPassword", {
        email: cleanEmail(email),
        password: String(password || ""),
      }),
      20_000,
      "登录请求超时，请检查网络后重试。",
    );
    assertCurrent(record);
    if (error || !data?.session?.user?.id || !data.session.access_token) {
      const failure = authFailure(
        error || { code: "invalid_session" },
        "登录失败，请检查邮箱和密码。",
      );
      publish({ status: AUTH_STATUS.anonymous, error: failure });
      throw failure;
    }
    applySession(data.session);
    return { user: data.user || data.session.user, session: data.session };
  }

  async function resendVerification({ email, emailRedirectTo } = {}) {
    requireConfiguration();
    const record = await initializedRecord();
    const options = emailRedirectTo
      ? { emailRedirectTo: String(emailRedirectTo) }
      : undefined;
    const { error } = await invokeAuth(record, "resend", {
      type: "signup",
      email: cleanEmail(email),
      ...(options ? { options } : {}),
    });
    assertCurrent(record);
    if (error) {
      throw authFailure(error, "验证邮件发送失败，请稍后再试。");
    }
  }

  async function requestPasswordReset({ email, redirectTo } = {}) {
    requireConfiguration();
    const record = await initializedRecord();
    const options = redirectTo
      ? { redirectTo: String(redirectTo) }
      : undefined;
    const { error } = await invokeAuth(record, "resetPasswordForEmail",
      cleanEmail(email),
      options,
    );
    assertCurrent(record);
    if (error) {
      throw authFailure(error, "密码重置邮件发送失败，请稍后再试。");
    }
  }

  async function verifyRegistrationLink(rawLink) {
    requireConfiguration();
    let tokenHash;
    let type;
    try {
      const link = new URL(String(rawLink || "").trim());
      const project = new URL(normalizedUrl);
      type = link.searchParams.get("type");
      tokenHash = link.searchParams.get("token_hash") || link.searchParams.get("token");
      if (link.origin !== project.origin || link.pathname !== `${project.pathname.replace(/\/$/, "")}/auth/v1/verify` ||
          link.username || link.password || !["email", "signup"].includes(type) ||
          !/^[a-z0-9_-]{16,256}$/i.test(tokenHash || "")) throw new Error();
    } catch {
      throw new AuthSessionError("请粘贴本次灯塔注册邮件中“Confirm email address”按钮的原始链接；不要粘贴网页地址、其他网站或重置密码链接。", { code: "invalid_registration_link" });
    }
    const record = await freshIdentityRecord();
    const { data, error } = await identityDeadline(record, invokeAuth(record, "verifyOtp", { token_hash: tokenHash, type }), 20_000, "邮箱验证响应超时，请重新登录。");
    assertCurrent(record);
    if (error || !data?.session?.user?.id) {
      throw authFailure(error || { code: "invalid_session" }, "邮箱验证未完成，请重新发送验证邮件并复制最新链接。");
    }
    applySession(data.session);
    return { ok: true };
  }

  async function updatePassword({ password } = {}) {
    requireConfiguration();
    const record = await initializedRecord();
    if (!session?.user?.id || !passwordRecovery) {
      throw new AuthSessionError("密码重置链接已失效，请重新申请。", {
        code: "password_recovery_required",
        status: 401,
      });
    }
    const { data, error } = await invokeAuth(record, "updateUser", {
      password: String(password || ""),
    });
    assertCurrent(record);
    if (error) {
      throw authFailure(error, "新密码保存失败，请重新申请重置邮件。");
    }
    passwordRecovery = false;
    applySession(session, AUTH_STATUS.authenticated);
    return { user: data?.user || session.user };
  }

  async function signOut() {
    await retireCurrent({ revoke: true });
  }

  async function getRequestContext() {
    if (!configured(normalizedUrl, normalizedKey)) return {};
    if (!session && [AUTH_STATUS.anonymous, AUTH_STATUS.expired].includes(snapshot.status)) return {};
    const startingScope = snapshot.user?.id ? scopeRevision : null;
    await initialize();
    const requestScope = startingScope ?? scopeRevision;
    function assertRequestScope() {
      if (requestScope === scopeRevision && session?.user?.id === snapshot.user?.id) return;
      throw new AuthSessionError("账号或伴侣已切换，本次请求已取消。", { code: "settings_scope_changed" });
    }
    assertRequestScope();
    if (!session?.access_token) return {};
    // 缺陷 5 修复：主动检查 token 是否临近/已过期，避免仅依赖后台定时器刷新。
    // 后台标签页定时器可能被节流，回前台时携带过期 token 导致 401 强制登出。
    if (
      session.expires_at &&
      client?.auth &&
      typeof client.auth.refreshSession === "function"
    ) {
      const expiresAt = Number(session.expires_at) * 1000;
      const now = Date.now();
      // 剩余有效期不足 30 秒时主动刷新一次
      if (expiresAt - now < 30_000) {
        const refreshRevision = sessionRevision;
        const refreshUserId = session.user?.id;
        try {
          const refreshed = await withAuthTimeout(
            client.auth.refreshSession(),
            15_000,
            "刷新登录状态超时。",
          );
          // SDK events can publish a newer session before this promise settles.
          if (requestScope === scopeRevision && refreshRevision === sessionRevision && refreshed?.data?.session?.user?.id === refreshUserId && refreshed.data.session.access_token) {
            session = refreshed.data.session;
            sessionRevision += 1;
            publish({ status: AUTH_STATUS.authenticated });
          }
        } catch {
          // 刷新失败保持现状，让请求层的 401 处理兜底
        }
      }
    }
    assertRequestScope();
    const context = {
      accessToken: session.access_token,
      companionId: snapshot.activeCompanionId,
    };
    requestContexts.set(context, { generation: lifecycle, scope: scopeRevision, revision: sessionRevision });
    return context;
  }

  function setActiveCompanionId(companionId) {
    const normalized = String(companionId || "").trim();
    if (!UUID_PATTERN.test(normalized)) {
      throw new AuthSessionError("伴侣编号格式不正确。", {
        code: "invalid_companion_id",
      });
    }
    if (!session?.user?.id) {
      throw new AuthSessionError("请先登录后再切换 AI 伴侣。", {
        code: "authentication_required",
        status: 401,
      });
    }
    storeCompanionId(persistentStorage, session.user.id, normalized);
    publish({ activeCompanionId: normalized });
    return normalized;
  }

  function contextIsCurrent(context) {
    const ticket = requestContexts.get(context);
    return Boolean(ticket && ticket.generation === lifecycle && ticket.scope === scopeRevision && ticket.revision === sessionRevision);
  }

  function captureCompanionFromResponse(response, context) {
    if (context !== undefined && !contextIsCurrent(context)) return "";
    const companionId = String(
      response?.headers?.get?.("X-DengTa-Companion-Id") || "",
    ).trim();
    if (!session?.user?.id || !UUID_PATTERN.test(companionId)) return "";
    storeCompanionId(persistentStorage, session.user.id, companionId);
    if (snapshot.activeCompanionId !== companionId) {
      publish({ activeCompanionId: companionId });
    }
    return companionId;
  }

  async function invalidateSession(message = "登录状态已经失效，请重新登录。", context) {
    if (context !== undefined && !contextIsCurrent(context)) return snapshot;
    await retireCurrent({
      status: AUTH_STATUS.expired,
      error: new AuthSessionError(message, {
        code: "invalid_session",
        status: 401,
      }),
    });
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot);
    return () => listeners.delete(listener);
  }

  function destroy() {
    lifecycle += 1;
    if (clientRecord) {
      clientRecord.retired = true;
      if (clientRecord.lease) void clientRecord.lease.retire().catch(() => {});
      else void clientRecord.ready.then(lease => lease?.retire()).catch(() => {});
      try { Promise.resolve(clientRecord.client?.auth.stopAutoRefresh?.()).catch(() => {}); } catch { /* Already stopped. */ }
    }
    clientRecord = null;
    client = null;
    initialization = null;
    authSubscription?.unsubscribe?.();
    authSubscription = null;
    listeners.clear();
  }

  // 缺陷 1 修复：处理 dengta://auth#access_token=... 深度链接回跳。
  // 用户点击邮箱验证/密码重置链接后回跳到 App，把 fragment 里的 token
  // 交给 GoTrueClient 换成正式会话。
  async function handleAuthCallbackUrl(rawUrl) {
    const callback = parseNativeAuthCallback(rawUrl);
    if (!callback) return { ok: false, reason: "invalid_callback" };
    requireConfiguration();
    const record = await freshIdentityRecord();
    try {
      passwordRecovery = callback.recovery;
      const { data, error } = await identityDeadline(record, invokeAuth(record, "setSession", {
        access_token: callback.accessToken,
        refresh_token: callback.refreshToken,
      }), 20_000, "回跳登录响应超时，请重新登录。");
      assertCurrent(record);
      if (error || !data?.session?.user?.id || !data.session.access_token) {
        throw authFailure(error || { code: "invalid_session" }, "回跳登录失败，请重新登录。");
      }
      passwordRecovery = callback.recovery;
      applySession(
        data?.session || null,
        passwordRecovery ? AUTH_STATUS.recovery : undefined,
      );
      return { ok: true };
    } catch (error) {
      if (!isCurrent(record)) throw error;
      passwordRecovery = false;
      publish({
        status: AUTH_STATUS.error,
        error:
          error instanceof AuthSessionError
            ? error
            : authFailure(error, "回跳登录失败，请重新登录。"),
      });
      throw error;
    }
  }

  async function checkConnectivity({ timeoutMs = 8000 } = {}) {
    if (!configured(normalizedUrl, normalizedKey)) {
      return { ok: false, status: 0, ms: 0, reason: "auth_not_configured" };
    }
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(2000, Number(timeoutMs) || 8000));
    try {
      const response = await fetch(`${normalizedUrl}/auth/v1/settings`, {
        headers: { apikey: normalizedKey, Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      return {
        ok: response.ok,
        status: response.status,
        ms: Date.now() - started,
        reason: response.ok ? "" : `http_${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        ms: Date.now() - started,
        reason: error?.name === "AbortError" ? "timeout" : "network",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    initialize,
    signUp: serializeIdentity(signUp),
    signIn: serializeIdentity(signIn),
    signOut,
    retryAuthCleanup,
    resendVerification,
    verifyRegistrationLink: serializeIdentity(verifyRegistrationLink),
    requestPasswordReset,
    updatePassword: serializeIdentity(updatePassword),
    handleAuthCallbackUrl: serializeIdentity(handleAuthCallbackUrl),
    checkConnectivity,
    getRequestContext,
    setActiveCompanionId,
    captureCompanionFromResponse,
    invalidateSession,
    subscribe,
    destroy,
    getSnapshot: () => snapshot,
    isConfigured: () => configured(normalizedUrl, normalizedKey),
  });
}

export const authSession = createAuthSessionManager();
