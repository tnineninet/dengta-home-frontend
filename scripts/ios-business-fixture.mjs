import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

// These values identify an isolated loopback fixture, never a cloud account.
export const BUSINESS_FIXTURE_IDENTITY = Object.freeze({
  email: "dengta-ios-ci@example.invalid",
  password: "local-synthetic-only-2026",
  displayName: "本地验证",
  anonKey: "dengta-ios-ci-public-local-only",
});

const firstToken = "DengTa 合成流式第一段 🧭";
const secondToken = "\nDengTa 合成流式第二段，回复已完成。";
export const BUSINESS_FIXTURE_TEXT = Object.freeze({
  firstToken,
  secondToken,
  finalReply: firstToken + secondToken,
  baselineMemory: "这是一条仅用于本地验证的合成记忆。",
});

const ACCOUNT_ID = "13572468-1234-4567-8123-123456789abc";
const COMPANION_ID = "24681357-1234-4567-8123-123456789abc";
const BASE_SESSION_ID = "35792468-1234-4567-8123-123456789abc";
const MEMORY_ID = "46813579-1234-4567-8123-123456789abc";
const MODEL_ID = "dengta-local-synthetic-model";
const MAX_BODY_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const copy = value => structuredClone(value);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const BASE_SETTINGS = Object.freeze({
  ai_name: "小灯", user_display_name: "本地验证", system_prompt: "",
  additional_prompt: "", personality: "", prompt_mode: "unified",
  unified_system_prompt: "", user_details: "", intimate_expression_enabled: false,
  provider: "custom", api_url: "", model: MODEL_ID, reasoning_effort: "",
  temperature: 0.7, context_turns: 0, max_tokens: 0,
  compression_threshold: 8000, compression_keep: 20, timezone: "Asia/Shanghai",
  push_enabled: false, max_push_per_day: 7, context_reset_at: "",
  account_role: "member", account_status: "active", storage_used_bytes: 0,
  storage_quota_bytes: 0,
});
const READONLY_SETTINGS = new Set([
  "context_reset_at", "account_role", "account_status", "storage_used_bytes", "storage_quota_bytes",
]);
const SKIN = Object.freeze({
  skin: "taotao-cream", ornament_activity: "quiet", dynamic_composer_hint: false,
  reduce_motion: true, hide_generation_process: true, show_error_details: false,
});

function sameNonce(left, right) {
  if (typeof left !== "string") return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function localOrigin(origin) {
  if (["capacitor://localhost", "http://localhost", "https://localhost"].includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname)
      && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch { return false; }
}

async function bodyBytes(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new Error("fixture_body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new Error("fixture_json_required");
  }
  const value = JSON.parse((await bodyBytes(request)).toString("utf8"));
  if (!isObject(value)) throw new Error("fixture_object_required");
  return value;
}

/** A transport fixture for the real App/AuthGate; it imports no product bypass. */
export async function createBusinessFixture({ runNonce } = {}) {
  if (typeof runNonce !== "string" || runNonce.length < 16 || runNonce.length > 256) {
    throw new TypeError("A runner-generated runNonce of 16–256 characters is required.");
  }
  const createdAt = new Date().toISOString();
  const user = {
    id: ACCOUNT_ID, aud: "authenticated", role: "authenticated",
    email: BUSINESS_FIXTURE_IDENTITY.email, email_confirmed_at: createdAt,
    confirmed_at: createdAt, created_at: createdAt,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { display_name: BUSINESS_FIXTURE_IDENTITY.displayName },
  };
  const baseSession = {
    id: BASE_SESSION_ID, title: "本地验证对话", model_id: MODEL_ID,
    created_at: createdAt, updated_at: createdAt,
  };
  const sessions = [baseSession];
  const histories = new Map([[BASE_SESSION_ID, []]]);
  const memories = [{
    id: MEMORY_ID, summary: BUSINESS_FIXTURE_TEXT.baselineMemory,
    confirmation_status: "confirmed", created_at: createdAt, updated_at: createdAt,
  }];
  let settings = copy(BASE_SETTINGS), authenticated = false, loggedOut = false;
  let accessToken = "", refreshToken = "", pendingStream = null, closed = false;
  let settingsChanged = false, settingsRestored = false;
  let sessionCreated = false, userMessagePersisted = false, assistantMessagePersisted = false;
  let firstTokenSent = false, streamAcknowledged = false, terminalSent = false;
  const counts = Object.fromEntries([
    "requests", "logins", "refreshes", "userReads", "logouts", "bootstraps",
    "settingsReads", "settingsWrites", "settingsChanges", "settingsRestores", "modelReads",
    "sessionLists", "sessionCreates", "historyReads", "memoryReads", "streams", "streamAcks",
  ].map(key => [key, 0]));
  const violations = Object.fromEntries([
    "unknownRoutes", "unauthorizedRequests", "invalidRequests", "invalidNonces",
    "nonLoopbackRequests", "gateOriginRequests", "prematureAcks", "duplicateAcks",
  ].map(key => [key, 0]));
  const sockets = new Set();
  let port = 0;
  const atBaseline = () => Object.entries(BASE_SETTINGS).every(([key, value]) => settings[key] === value)
    && Object.keys(settings).length === Object.keys(BASE_SETTINGS).length;
  const error = (response, status, code, counter = "invalidRequests") => {
    violations[counter] += 1;
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ code, message: "本地合成验证请求未通过。" }));
  };
  const json = (response, value, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(status === 204 ? undefined : JSON.stringify(value));
  };
  const issueSession = () => {
    const epoch = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: ACCOUNT_ID, aud: "authenticated", role: "authenticated", iat: epoch, exp: epoch + 3600 })}.local-synthetic-signature`;
    refreshToken = `local-synthetic-refresh-${randomUUID()}`;
    authenticated = true;
    loggedOut = false;
    return { access_token: accessToken, token_type: "bearer", expires_in: 3600,
      expires_at: epoch + 3600, refresh_token: refreshToken, user: copy(user) };
  };
  const isAuthenticated = request => authenticated && request.headers.authorization === `Bearer ${accessToken}`;
  const emit = (response, event) => response.write(`data: ${JSON.stringify(event)}\n\n`);

  function routeFor(method, pathname, query) {
    const noQuery = query.size === 0;
    if (pathname === "/__dengta_ci/ack-stream" && method === "POST" && noQuery) return "ack";
    if (pathname === "/auth/v1/token" && method === "POST" && query.size === 1
      && ["password", "refresh_token"].includes(query.get("grant_type"))) return "token";
    if (pathname === "/auth/v1/user" && method === "GET" && noQuery) return "user";
    if (pathname === "/auth/v1/logout" && method === "POST"
      && (noQuery || (query.size === 1 && ["local", "global", "others"].includes(query.get("scope"))))) return "logout";
    if (pathname === "/auth/v1/settings" && method === "GET" && noQuery) return "authSettings";
    if (!noQuery && !(pathname === "/api/v2/fun-labs/recommend" && method === "GET"
      && query.size === 1 && query.get("limit") === "4")) return "";
    const reads = new Map([
      ["/health", "health"], ["/models", "models"], ["/api/v2/bootstrap", "bootstrap"],
      ["/api/v2/settings", "settings"], ["/api/v2/sessions", "sessions"],
      ["/api/v2/private-media/catalog", "media"], ["/api/v2/voice-output/status", "voice"],
      ["/api/v2/chat-skin/preferences", "skin"], ["/api/ai-providers/status", "providers"],
      ["/api/v2/fun-labs/interests", "interests"], ["/api/v2/fun-labs/recommend", "recommend"],
      ["/api/v2/special-dates", "dates"], ["/api/v2/fun-labs/achievements", "achievements"],
      ["/api/v2/fun-labs/daily-shots", "shots"], ["/api/v2/moments", "moments"],
      ["/api/v2/companion-profile", "profile"], ["/api/v2/memories", "memories"],
      ["/api/external-memory/connections", "connections"], ["/api/ombre/config", "ombreConfig"],
      ["/api/ombre/mcp/status", "ombreStatus"], ["/api/v2/memory/health", "memoryHealth"],
    ]);
    if (method === "GET" && reads.has(pathname)) return reads.get(pathname);
    if (method === "PUT" && pathname === "/api/v2/settings") return "saveSettings";
    if (method === "PUT" && pathname === "/api/v2/companion-state") return "saveState";
    if (method === "POST" && pathname === "/api/v2/sessions") return "createSession";
    if (method === "POST" && pathname === "/chat/stream") return "stream";
    if (method === "GET" && /^\/api\/v2\/sessions\/[^/]+\/messages$/.test(pathname)) return "history";
    if (method === "GET" && /^\/api\/v2\/chat-skin\/conversations\/[^/]+\/hint$/.test(pathname)) return "hint";
    if (["PATCH", "DELETE"].includes(method) && /^\/api\/v2\/sessions\/[^/]+$/.test(pathname)) return "sessionMutation";
    return "";
  }

  const server = createServer(async (request, response) => {
    counts.requests += 1;
    try {
      if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)
        || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) {
        return error(response, 403, "fixture_loopback_required", "nonLoopbackRequests");
      }
      const parsed = new URL(request.url, `http://127.0.0.1:${port}`);
      if (![ `http://127.0.0.1:${port}`, `http://localhost:${port}` ].includes(parsed.origin)) return error(response, 403, "fixture_loopback_required", "nonLoopbackRequests");
      const method = request.method || "GET";
      const preflightMethod = request.headers["access-control-request-method"];
      const route = routeFor(method === "OPTIONS" ? preflightMethod : method, parsed.pathname, parsed.searchParams);
      if (!route) return error(response, 404, "fixture_route_not_allowed", "unknownRoutes");
      const origin = request.headers.origin;
      if (route === "ack" && origin !== undefined) return error(response, 403, "fixture_runner_only", "gateOriginRequests");
      if (origin !== undefined && !localOrigin(origin)) return error(response, 403, "fixture_origin_not_allowed", "nonLoopbackRequests");
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      response.setHeader("Access-Control-Expose-Headers", "X-DengTa-Companion-Id");
      response.setHeader("X-DengTa-Companion-Id", COMPANION_ID);
      if (method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-DengTa-Companion-Id, apikey, X-Client-Info, X-Supabase-Api-Version");
        return json(response, null, 204);
      }
      if (route === "ack") {
        const body = await jsonBody(request);
        if (!sameNonce(body.runNonce, runNonce) || Object.keys(body).length !== 1) return error(response, 403, "fixture_nonce_invalid", "invalidNonces");
        if (streamAcknowledged) return error(response, 409, "fixture_stream_already_acknowledged", "duplicateAcks");
        if (!pendingStream || !firstTokenSent || pendingStream.response.destroyed) return error(response, 409, "fixture_stream_not_waiting", "prematureAcks");
        streamAcknowledged = true;
        counts.streamAcks += 1;
        const pending = pendingStream;
        const assistant = { id: randomUUID(), role: "assistant", conversation_id: pending.sessionId,
          content: BUSINESS_FIXTURE_TEXT.finalReply, created_at: new Date().toISOString() };
        histories.get(pending.sessionId).push(assistant);
        assistantMessagePersisted = true;
        emit(pending.response, { type: "text", content: BUSINESS_FIXTURE_TEXT.secondToken });
        emit(pending.response, { type: "done", ok: true, assistant_message: assistant, companion_status_updated: true });
        terminalSent = true;
        pendingStream = null;
        pending.response.end();
        return json(response, { ok: true });
      }
      if (route === "authSettings") return json(response, { external: { email: true }, disable_signup: true, mailer_autoconfirm: true });
      if (route === "token") {
        const body = await jsonBody(request);
        if (parsed.searchParams.get("grant_type") === "password") {
          if (body.email !== BUSINESS_FIXTURE_IDENTITY.email || body.password !== BUSINESS_FIXTURE_IDENTITY.password) {
            return error(response, 400, "invalid_credentials", "unauthorizedRequests");
          }
          counts.logins += 1;
        } else {
          if (!authenticated || body.refresh_token !== refreshToken) return error(response, 401, "invalid_session", "unauthorizedRequests");
          counts.refreshes += 1;
        }
        return json(response, issueSession());
      }
      if (!isAuthenticated(request)) return error(response, 401, "authentication_required", "unauthorizedRequests");
      if (request.headers["x-dengta-companion-id"] !== undefined && request.headers["x-dengta-companion-id"] !== COMPANION_ID) {
        return error(response, 403, "fixture_companion_invalid", "unauthorizedRequests");
      }
      if (route === "user") { counts.userReads += 1; return json(response, user); }
      if (route === "logout") {
        authenticated = false; loggedOut = true; accessToken = ""; refreshToken = ""; counts.logouts += 1;
        if (pendingStream) { pendingStream.response.end(); pendingStream = null; }
        return json(response, null, 204);
      }
      if (route === "health") return json(response, { ok: true, features: { hervoice_proxy_configured: false, expressive_tts_configured: false, expressive_tts_provider: "none" } });
      if (route === "models") { counts.modelReads += 1; return json(response, { models: [{ id: MODEL_ID, label: "本地合成模型" }], current_model: MODEL_ID }); }
      if (route === "bootstrap") { counts.bootstraps += 1; return json(response, { settings, sessions, state: {} }); }
      if (route === "settings") { counts.settingsReads += 1; return json(response, { settings }); }
      if (route === "saveSettings") {
        const body = await jsonBody(request);
        if (Object.keys(body).some(key => !Object.hasOwn(BASE_SETTINGS, key))) return error(response, 400, "fixture_settings_field_invalid");
        if (Object.entries(body).some(([key, value]) => READONLY_SETTINGS.has(key) && value !== BASE_SETTINGS[key])) {
          return error(response, 403, "fixture_settings_readonly", "unauthorizedRequests");
        }
        if (Object.entries(body).some(([key, value]) => typeof value !== typeof BASE_SETTINGS[key])
          || (body.api_url !== undefined && body.api_url !== "") || (body.provider !== undefined && body.provider !== "custom")
          || (body.model !== undefined && body.model !== MODEL_ID)) return error(response, 400, "fixture_settings_value_invalid");
        const changedBefore = !atBaseline();
        settings = { ...settings, ...body };
        counts.settingsWrites += 1;
        if (!atBaseline()) { settingsChanged = true; counts.settingsChanges += 1; }
        if (changedBefore && atBaseline()) { settingsRestored = true; counts.settingsRestores += 1; }
        return json(response, { settings });
      }
      if (route === "sessions") { counts.sessionLists += 1; return json(response, { sessions }); }
      if (route === "createSession") {
        const body = await jsonBody(request);
        if (typeof body.title !== "string" || !body.title.trim() || Object.keys(body).some(key => key !== "title")) return error(response, 400, "fixture_session_invalid");
        const now = new Date().toISOString();
        const session = { id: randomUUID(), title: body.title.slice(0, 60), model_id: MODEL_ID, created_at: now, updated_at: now };
        sessions.unshift(session); histories.set(session.id, []); counts.sessionCreates += 1; sessionCreated = true;
        return json(response, { session });
      }
      if (route === "sessionMutation") {
        const id = parsed.pathname.split("/").at(-1);
        const index = sessions.findIndex(session => session.id === id);
        if (!UUID.test(id) || index < 0) return error(response, 404, "fixture_session_missing");
        if (method === "DELETE") { sessions.splice(index, 1); histories.delete(id); return json(response, null, 204); }
        const body = await jsonBody(request);
        if (Object.keys(body).some(key => !["title", "model_id"].includes(key))
          || (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim()))
          || (body.model_id !== undefined && body.model_id !== MODEL_ID)) return error(response, 400, "fixture_session_invalid");
        Object.assign(sessions[index], body, { updated_at: new Date().toISOString() });
        return json(response, { session: sessions[index] });
      }
      if (route === "history" || route === "hint") {
        const id = parsed.pathname.split("/").at(-2);
        if (!UUID.test(id) || !histories.has(id)) return error(response, 404, "fixture_session_missing");
        if (route === "hint") return json(response, { hint: { hint: "" } });
        counts.historyReads += 1;
        return json(response, { messages: histories.get(id) });
      }
      if (route === "stream") {
        if (counts.streams > 0) return error(response, 409, "fixture_stream_already_started");
        const contentType = String(request.headers["content-type"] || "");
        if (!contentType.toLowerCase().startsWith("multipart/form-data;")) return error(response, 400, "fixture_multipart_required");
        const form = await new Request(`http://127.0.0.1:${port}/chat/stream`, {
          method: "POST", headers: { "Content-Type": contentType }, body: await bodyBytes(request),
        }).formData();
        const sessionId = form.get("session_id"), message = form.get("message"), clientMessageId = form.get("client_message_id");
        if (typeof sessionId !== "string" || !histories.has(sessionId) || typeof message !== "string" || !message.trim()
          || typeof clientMessageId !== "string" || !clientMessageId || form.has("files")) return error(response, 400, "fixture_chat_invalid");
        const userMessage = { id: randomUUID(), role: "user", conversation_id: sessionId,
          content: message, client_message_id: clientMessageId, created_at: new Date().toISOString() };
        histories.get(sessionId).push(userMessage); userMessagePersisted = true; counts.streams += 1;
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
        response.flushHeaders();
        emit(response, { type: "meta", user_message: userMessage });
        emit(response, { type: "text", content: BUSINESS_FIXTURE_TEXT.firstToken });
        firstTokenSent = true;
        pendingStream = { response, sessionId };
        response.on("close", () => { if (pendingStream?.response === response) pendingStream = null; });
        return;
      }
      if (route === "saveState") { const body = await jsonBody(request); return json(response, { state: body }); }
      if (route === "media") return json(response, { assets: [], preferences: {} });
      if (route === "voice") return json(response, { profile: { provider: "server_default", enabled: false, configured: false }, available: true });
      if (route === "skin") return json(response, { preferences: SKIN });
      if (route === "providers") return json(response, { available: false });
      if (route === "interests") return json(response, { profile: { interests: [] } });
      if (route === "recommend") return json(response, { recommend: { reason: "", videos: [] } });
      if (route === "dates") return json(response, { dates: [] });
      if (route === "achievements") return json(response, { achievements: [] });
      if (route === "shots") return json(response, { today: null, recent: [] });
      if (route === "moments") return json(response, { available: true, entries: [] });
      if (route === "profile") return json(response, { profile: {}, latest_version: null, versions: [] });
      if (route === "memories") { counts.memoryReads += 1; return json(response, { memories }); }
      if (route === "connections") return json(response, { ok: true, connections: [] });
      if (route === "ombreConfig") return json(response, { configured: false, mcp: { configured: false, available: false, tools: [] } });
      if (route === "ombreStatus") return json(response, { configured: false, available: false, auth_configured: false, tools: [] });
      if (route === "memoryHealth") return json(response, { configured: false, reachable: false, error: "kiwi_mem_not_configured" });
      return error(response, 404, "fixture_route_not_allowed", "unknownRoutes");
    } catch {
      if (!response.headersSent) error(response, 400, "fixture_request_invalid");
      else response.destroy();
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); port = server.address().port; resolve(); });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    snapshot() {
      return {
        schemaVersion: 1, synthetic: true, loopbackOnly: true,
        counts: copy(counts),
        observed: { authenticated, loggedOut, settingsAtBaseline: atBaseline(), settingsChanged, settingsRestored,
          sessionCreated, userMessagePersisted, assistantMessagePersisted, firstTokenSent,
          streamAcknowledged, terminalSent },
        violations: copy(violations),
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      if (pendingStream) { pendingStream.response.end(); pendingStream = null; }
      const closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const socket of sockets) socket.destroy();
      await closing;
    },
  };
}
