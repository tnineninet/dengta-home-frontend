import { isDeepStrictEqual } from "node:util";
import { createSettingsPayload } from "../src/settings.js";

// Public production pins: src/service-status.js and verify-ios-build-policy.mjs.
// Credentials belong only in the caller's runtime environment. This module has
// no CLI, logging, credential-file lookup, exported snapshots, or content receipt.
const AUTH_ORIGIN = "https://nyyqizwrlmejpfdhgrnd.supabase.co";
const API_ORIGIN = "https://dengta-home-backend-rkmq.onrender.com";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PERSONALIZATION_FIELDS = new Set([
  "unified_system_prompt", "user_details", "prompt_mode", "intimate_expression_enabled",
]);
const SERVER_METADATA = new Set(["id", "user_id", "companion_id", "created_at", "updated_at"]);
const editableSettings = settings => Object.fromEntries(
  Object.entries(createSettingsPayload(settings)).filter(([key]) => !SERVER_METADATA.has(key)),
);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const receipt = value => Object.freeze({ schemaVersion: 1, ...value });
const failure = (code, progress) => Object.assign(new Error(code), {
  name: "IOSBusinessLiveError", code, ...(progress ? { receipt: receipt(progress) } : {}),
});

function productionOrigin(value, expected) {
  try {
    const url = new URL(value);
    if (url.origin === expected && url.protocol === "https:" && !url.username && !url.password &&
        url.pathname === "/" && !url.search && !url.hash) return expected;
  } catch { /* Expose a fixed enum only. */ }
  throw failure("production_origin_required");
}

/**
 * The expected UUID is the dedicated-account binding; it must never be inferred
 * from whichever credentials happen to be available. Empty sessions are checked
 * for the pinned companion, not claimed as proof that all account stores are
 * empty. The caller must use the approved dedicated account and serialize runs.
 * Stop the app before restoreAndCleanup: its autosave must not race restoration.
 * This helper is not a durable recovery service. The live driver stays closed.
 */
export function createLiveGuard({ authUrl, anonKey, apiUrl, email, password, expectedUserId, runNonce, fetchImpl = fetch } = {}) {
  const auth = productionOrigin(authUrl, AUTH_ORIGIN);
  const api = productionOrigin(apiUrl, API_ORIGIN);
  if (typeof expectedUserId !== "string" || !UUID.test(expectedUserId)) throw failure("dedicated_user_id_required");
  if (![anonKey, email, password].every(value => typeof value === "string" && value.length > 0) ||
      typeof fetchImpl !== "function") throw failure("dedicated_credentials_required");

  let accessToken = "", companionId = "", baseline = null, ready = false;
  let ownedSessionId = "", ownedSessionTitle = "", sessionCreationAttempted = false, sessionCreationUncertain = false;
  let ownedSessionVerified = false;
  let plannedSettings = null, revoked = false, closed = false, busy = false;
  const expectedId = expectedUserId.toLowerCase();

  // Prevent a cleanup and a verification from racing within this guard.
  async function exclusive(operation) {
    if (busy) throw failure("live_operation_in_progress");
    busy = true;
    try { return await operation(); }
    catch (error) {
      if (error?.name === "IOSBusinessLiveError") throw error;
      throw failure("live_operation_failed");
    } finally { busy = false; }
  }

  async function request(url, options, code) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options, redirect: "error", credentials: "omit", cache: "no-store",
        referrerPolicy: "no-referrer", signal: AbortSignal.timeout(20_000),
      });
    } catch { throw failure(code); }
    if (!response || typeof response.status !== "number" || !response.ok) throw failure(code);
    return response;
  }

  async function json(response, code) {
    try {
      const value = await response.json();
      if (object(value)) return value;
    } catch { /* Never attach a response or parser error. */ }
    throw failure(code);
  }

  function requireReady() {
    if (!ready || closed || !accessToken || !baseline || !companionId) throw failure("live_preflight_required");
  }

  async function apiRequest(route, { method = "GET", body, requireCompanionHeader = false } = {}) {
    const response = await request(`${api}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json",
        ...(companionId ? { "X-DengTa-Companion-Id": companionId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, "live_api_request_failed");
    let header;
    try { header = response.headers.get("X-DengTa-Companion-Id"); }
    catch { throw failure("companion_binding_invalid"); }
    if ((requireCompanionHeader && !UUID.test(header || "")) ||
        (header && (!UUID.test(header) || (companionId && header !== companionId)))) {
      throw failure("companion_binding_invalid");
    }
    if (!companionId && requireCompanionHeader) companionId = header;
    return response;
  }

  async function bootstrap() {
    const response = await apiRequest("/api/v2/bootstrap", { requireCompanionHeader: true });
    const data = await json(response, "bootstrap_receipt_invalid");
    if (!object(data.settings) || !Array.isArray(data.sessions) ||
        data.sessions.some(session => !object(session) || !UUID.test(session.id || "")) ||
        new Set(data.sessions.map(session => session.id)).size !== data.sessions.length) {
      throw failure("bootstrap_receipt_invalid");
    }
    if (data.settings.account_role !== "member" || data.settings.account_status !== "active") {
      throw failure("dedicated_member_required");
    }
    return data;
  }

  async function revoke() {
    if (!accessToken) return receipt({ guardSessionRevoked: revoked, nativeSessionRevoked: false });
    // This token belongs only to this guard. It cannot authorize revoking the
    // owner's other sessions or prove revocation of the separate native login.
    let response;
    try {
      response = await fetchImpl(`${auth}/auth/v1/logout?scope=local`, {
        method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
        redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(20_000),
      });
    } catch { throw failure("auth_revoke_failed"); }
    // A 401 proves neither server-side session revocation nor native cleanup.
    if (![200, 204].includes(response?.status)) throw failure("auth_revoke_failed");
    accessToken = ""; revoked = true;
    return receipt({ guardSessionRevoked: true, nativeSessionRevoked: false });
  }

  async function preflight() {
    return exclusive(async () => {
      if (ready || closed || accessToken) throw failure("live_preflight_already_started");
      const response = await request(`${auth}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }, "dedicated_login_failed");
      const login = await json(response, "dedicated_login_failed");
      if (typeof login.access_token === "string" && login.access_token) accessToken = login.access_token;
      try {
        if (!accessToken || typeof login.user?.id !== "string" || login.user.id.toLowerCase() !== expectedId) {
          throw failure("dedicated_identity_mismatch");
        }
        const first = await bootstrap();
        if (first.sessions.length !== 0) throw failure("dedicated_history_not_empty");
        // The second request is already companion-pinned. Do not accept a
        // changing/default companion or changing baseline during preflight.
        const second = await bootstrap();
        if (second.sessions.length !== 0) throw failure("dedicated_history_not_empty");
        const original = editableSettings(first.settings);
        if (!isDeepStrictEqual(original, editableSettings(second.settings))) throw failure("baseline_unstable");
        baseline = structuredClone(original);
        ready = true;
        return receipt({ dedicatedIdentityMatched: true, memberActive: true, companionPinned: true, emptySessionBaseline: true });
      } catch (error) {
        try { await revoke(); } catch { /* Caller close() can retry revocation. */ }
        closed = !accessToken;
        throw error;
      }
    });
  }

  function checkOwnedSession(data) {
    if (sessionCreationUncertain) throw failure("owned_session_creation_uncertain");
    if (ownedSessionId) {
      ownedSessionVerified = false;
      const session = data.sessions.find(item => item.id === ownedSessionId);
      if (!session) throw failure("owned_session_missing");
      if (session.title !== ownedSessionTitle) throw failure("owned_session_conflict");
      ownedSessionVerified = true;
    }
    return receipt({ createdSessionRecorded: Boolean(ownedSessionId), createdSessionCount: ownedSessionId ? 1 : 0 });
  }

  async function createOwnedSession() {
    return exclusive(async () => {
      requireReady();
      if (!UUID.test(runNonce || "")) throw failure("owned_session_nonce_required");
      if (sessionCreationAttempted) throw failure("owned_session_creation_already_attempted");
      ownedSessionTitle = `[iOS CI ${runNonce.toLowerCase()}]`;
      const before = await bootstrap();
      if (before.sessions.some(session => session.title === ownedSessionTitle)) throw failure("owned_session_marker_conflict");
      // The ordinary API has no idempotency key. A lost response must not cause
      // another POST or an inferred claim over a matching/unfamiliar session.
      sessionCreationAttempted = true; sessionCreationUncertain = true;
      const response = await apiRequest("/api/v2/sessions", {
        method: "POST", body: { title: ownedSessionTitle }, requireCompanionHeader: true,
      });
      const data = await json(response, "owned_session_receipt_invalid");
      if (response.status !== 201 || !object(data.session) || !UUID.test(data.session.id || "") ||
          data.session.title !== ownedSessionTitle || before.sessions.some(session => session.id === data.session.id)) {
        throw failure("owned_session_receipt_invalid");
      }
      ownedSessionId = data.session.id; sessionCreationUncertain = false;
      return checkOwnedSession(await bootstrap());
    });
  }

  async function recordCreatedSessions() {
    // Verification only; never infer ownership from count, ordering or a diff.
    return exclusive(async () => {
      requireReady(); ownedSessionVerified = false;
      return checkOwnedSession(await bootstrap());
    });
  }

  function runtimeSession() {
    requireReady();
    if (busy) throw failure("live_operation_in_progress");
    if (!ownedSessionId || !ownedSessionVerified || sessionCreationUncertain) throw failure("owned_session_required");
    return { id: ownedSessionId, title: ownedSessionTitle };
  }

  // Private runtime input only: never serialize this into published evidence.
  function runtimeBaseline() {
    requireReady();
    return { unified_system_prompt: baseline.unified_system_prompt || "", user_details: baseline.user_details || "" };
  }

  async function verifyBaseline() {
    return exclusive(async () => {
      requireReady();
      const data = await bootstrap();
      if (!isDeepStrictEqual(editableSettings(data.settings), baseline)) throw failure("settings_baseline_mismatch");
      return receipt({ settingsRestored: true, settingsReadback: true, unrelatedSettingsUnchanged: true });
    });
  }

  function personalizationTarget(expected) {
    if (!object(expected) || Object.keys(expected).length === 0 ||
          Object.keys(expected).some(key => !PERSONALIZATION_FIELDS.has(key)) ||
          Object.entries(expected).some(([key, value]) => key === "intimate_expression_enabled"
            ? typeof value !== "boolean"
            : key === "prompt_mode" ? !["legacy", "unified"].includes(value) : typeof value !== "string")) {
        throw failure("personalization_expectation_invalid");
    }
    const target = structuredClone(expected);
    if (Object.hasOwn(expected, "unified_system_prompt") && !Object.hasOwn(expected, "prompt_mode")) target.prompt_mode = "unified";
    if (Object.entries(target).every(([key, value]) => isDeepStrictEqual(value, baseline[key]))) throw failure("settings_change_missing");
    return target;
  }

  async function planPersonalization(expected) {
    return exclusive(async () => {
      requireReady();
      const target = personalizationTarget(expected);
      if (plannedSettings) {
        if (!isDeepStrictEqual(plannedSettings, target)) throw failure("personalization_plan_already_set");
        return receipt({ personalizationPlanned: true });
      }
      const current = editableSettings((await bootstrap()).settings);
      if ([...PERSONALIZATION_FIELDS].some(key => !isDeepStrictEqual(current[key], baseline[key]))) {
        throw failure("personalization_baseline_changed");
      }
      plannedSettings = target;
      return receipt({ personalizationPlanned: true });
    });
  }

  async function verifySettings(expected) {
    return exclusive(async () => {
      requireReady();
      const edits = personalizationTarget(expected);
      if (!plannedSettings || !isDeepStrictEqual(plannedSettings, edits)) throw failure("personalization_plan_required");
      const target = { ...baseline, ...edits };
      const data = await bootstrap();
      const actual = editableSettings(data.settings);
      if (!Object.entries(expected).every(([key, value]) => isDeepStrictEqual(actual[key], value)) ||
          actual.prompt_mode !== target.prompt_mode) throw failure("settings_readback_mismatch");
      if (!isDeepStrictEqual(actual, target)) throw failure("settings_unexpected_change");
      if (isDeepStrictEqual(actual, baseline)) throw failure("settings_change_missing");
      return receipt({ settingsSaved: true, settingsChanged: true, settingsReadback: true, unrelatedSettingsUnchanged: true });
    });
  }

  async function restoreAndCleanup({ appStopped = false } = {}) {
    return exclusive(async () => {
      requireReady();
      if (appStopped !== true) throw failure("app_stop_required");
      ownedSessionVerified = false;
      const progress = { settingsRestored: false, ownedSessionAbsent: false, createdSessionDeleted: false, cleanupVerified: false, settingsConflict: false };
      let current;
      // Recheck the role, status, and pinned companion before any write.
      try { current = await bootstrap(); }
      catch { throw failure("cleanup_preflight_failed", progress); }
      const fresh = editableSettings(current.settings);
      const restore = {};
      // Register exact edits before UI mutation. Without that plan, a changed
      // personalization value cannot be attributed to this test.
      for (const key of PERSONALIZATION_FIELDS) {
        const value = fresh[key];
        if (isDeepStrictEqual(value, baseline[key])) continue;
        if (!plannedSettings || !Object.hasOwn(plannedSettings, key)) {
          progress.settingsConflict = true;
        } else if (isDeepStrictEqual(value, plannedSettings[key])) {
          restore[key] = baseline[key];
        } else {
          progress.settingsConflict = true;
        }
      }
      const expectedRestored = { ...fresh, ...restore };
      try {
        if (progress.settingsConflict) throw failure("cleanup_conflict");
        if (Object.keys(restore).length > 0) {
          // The API accepts partial bodies. Never send stale identity/provider
          // fields or server metadata. Its server-side read/write has no CAS.
          const response = await apiRequest("/api/v2/settings", { method: "PUT", body: restore, requireCompanionHeader: true });
          const saved = await json(response, "settings_restore_failed");
          if (!object(saved.settings) || !isDeepStrictEqual(editableSettings(saved.settings), expectedRestored)) {
            throw failure("settings_restore_failed");
          }
        }
        progress.settingsRestored = isDeepStrictEqual(editableSettings((await bootstrap()).settings), expectedRestored);
      } catch { /* Session cleanup still runs; publish only bounded progress. */ }
      if (!sessionCreationUncertain) {
        try {
          const latest = await bootstrap();
          const owned = latest.sessions.find(session => session.id === ownedSessionId);
          if (owned) {
            checkOwnedSession(latest);
            ownedSessionVerified = false;
            const response = await apiRequest(`/api/v2/sessions/${encodeURIComponent(ownedSessionId)}`, { method: "DELETE", requireCompanionHeader: true });
            if (response.status !== 204) throw failure("created_session_delete_failed");
            progress.createdSessionDeleted = true;
          }
          const final = await bootstrap();
          progress.ownedSessionAbsent = ownedSessionId
            ? !final.sessions.some(session => session.id === ownedSessionId)
            : final.sessions.length === 0;
          progress.settingsRestored = progress.settingsRestored && isDeepStrictEqual(editableSettings(final.settings), expectedRestored);
        } catch { /* A failed delete/readback never counts as cleanup. */ }
      }
      progress.cleanupVerified = progress.settingsRestored && progress.ownedSessionAbsent;
      if (!progress.cleanupVerified) throw failure(progress.settingsConflict ? "cleanup_conflict" : "cleanup_incomplete", progress);
      return receipt(progress);
    });
  }

  async function close() {
    return exclusive(async () => {
      const result = await revoke();
      closed = true; ready = false; baseline = null; plannedSettings = null; companionId = "";
      ownedSessionId = ""; ownedSessionTitle = ""; ownedSessionVerified = false;
      return result;
    });
  }

  return Object.freeze({ preflight, runtimeBaseline, runtimeSession, planPersonalization, verifyBaseline, verifySettings,
    createOwnedSession, recordCreatedSessions, restoreAndCleanup, close, revoke: close });
}
