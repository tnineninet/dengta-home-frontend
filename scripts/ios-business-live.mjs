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
 */
export function createLiveGuard({ authUrl, anonKey, apiUrl, email, password, expectedUserId, fetchImpl = fetch } = {}) {
  const auth = productionOrigin(authUrl, AUTH_ORIGIN);
  const api = productionOrigin(apiUrl, API_ORIGIN);
  if (typeof expectedUserId !== "string" || !UUID.test(expectedUserId)) throw failure("dedicated_user_id_required");
  if (![anonKey, email, password].every(value => typeof value === "string" && value.length > 0) ||
      typeof fetchImpl !== "function") throw failure("dedicated_credentials_required");

  let accessToken = "", companionId = "", baseline = null, ready = false;
  let ownedSessionId = "", revoked = false, closed = false, busy = false;
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
    if (!accessToken) return receipt({ sessionRevoked: revoked });
    // Before acceptance, only this guard's session may be revoked. After the
    // dedicated-account checks, revoke all test sessions, including the native
    // UI login that cannot be revoked by deleting its Simulator alone.
    // A 401 means this token has already been revoked/expired.
    let response;
    try {
      response = await fetchImpl(`${auth}/auth/v1/logout?scope=${ready ? "global" : "local"}`, {
        method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
        redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(20_000),
      });
    } catch { throw failure("auth_revoke_failed"); }
    if (![200, 204, 401].includes(response?.status)) throw failure("auth_revoke_failed");
    accessToken = ""; revoked = true;
    return receipt({ sessionRevoked: true });
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
        const original = createSettingsPayload(first.settings);
        if (!isDeepStrictEqual(original, createSettingsPayload(second.settings))) throw failure("baseline_unstable");
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

  function captureSessions(data) {
    if (data.sessions.length > 1 || (ownedSessionId && data.sessions.some(session => session.id !== ownedSessionId))) {
      throw failure("created_session_ambiguous");
    }
    if (!ownedSessionId && data.sessions.length === 1) ownedSessionId = data.sessions[0].id;
    return receipt({ createdSessionRecorded: Boolean(ownedSessionId), createdSessionCount: ownedSessionId ? 1 : 0 });
  }

  async function recordCreatedSessions() {
    return exclusive(async () => { requireReady(); return captureSessions(await bootstrap()); });
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
      if (!isDeepStrictEqual(createSettingsPayload(data.settings), baseline)) throw failure("settings_baseline_mismatch");
      return receipt({ settingsRestored: true, settingsReadback: true, unrelatedSettingsUnchanged: true });
    });
  }

  async function verifySettings(expected) {
    return exclusive(async () => {
      requireReady();
      if (!object(expected) || Object.keys(expected).length === 0 ||
          Object.keys(expected).some(key => !PERSONALIZATION_FIELDS.has(key)) ||
          Object.entries(expected).some(([key, value]) => key === "intimate_expression_enabled"
            ? typeof value !== "boolean"
            : key === "prompt_mode" ? !["legacy", "unified"].includes(value) : typeof value !== "string")) {
        throw failure("personalization_expectation_invalid");
      }
      const target = { ...baseline, ...expected };
      if (Object.hasOwn(expected, "unified_system_prompt") && !Object.hasOwn(expected, "prompt_mode")) target.prompt_mode = "unified";
      const data = await bootstrap();
      const actual = createSettingsPayload(data.settings);
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
      const progress = { settingsRestored: false, sessionsCleaned: false, createdSessionDeleted: false, cleanupVerified: false };
      let current;
      // Recheck the role, status, and pinned companion before any write.
      try { current = await bootstrap(); }
      catch { throw failure("cleanup_preflight_failed", progress); }
      let capturePassed = true;
      try { captureSessions(current); } catch { capturePassed = false; }
      try {
        if (!isDeepStrictEqual(createSettingsPayload(current.settings), baseline)) {
          const response = await apiRequest("/api/v2/settings", { method: "PUT", body: baseline });
          const saved = await json(response, "settings_restore_failed");
          if (!object(saved.settings) || !isDeepStrictEqual(createSettingsPayload(saved.settings), baseline)) {
            throw failure("settings_restore_failed");
          }
        }
        progress.settingsRestored = isDeepStrictEqual(createSettingsPayload((await bootstrap()).settings), baseline);
      } catch { /* Session cleanup still runs; publish only bounded progress. */ }
      if (capturePassed) {
        try {
          if (ownedSessionId && current.sessions.some(session => session.id === ownedSessionId)) {
            const response = await apiRequest(`/api/v2/sessions/${encodeURIComponent(ownedSessionId)}`, { method: "DELETE" });
            if (response.status !== 204) throw failure("created_session_delete_failed");
            progress.createdSessionDeleted = true;
          }
          const final = await bootstrap();
          progress.sessionsCleaned = final.sessions.length === 0;
          progress.settingsRestored = progress.settingsRestored && isDeepStrictEqual(createSettingsPayload(final.settings), baseline);
        } catch { /* A failed delete/readback never counts as cleanup. */ }
      }
      progress.cleanupVerified = progress.settingsRestored && progress.sessionsCleaned;
      if (!progress.cleanupVerified) throw failure("cleanup_incomplete", progress);
      return receipt(progress);
    });
  }

  async function close() {
    return exclusive(async () => {
      const result = await revoke();
      closed = true; ready = false; baseline = null; companionId = ""; ownedSessionId = "";
      return result;
    });
  }

  return Object.freeze({ preflight, runtimeBaseline, verifyBaseline, verifySettings, recordCreatedSessions, restoreAndCleanup, close, revoke: close });
}
