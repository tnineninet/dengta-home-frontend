import assert from "node:assert/strict";
import { test } from "node:test";
import { GoTrueClient } from "@supabase/auth-js";
import {
  BUSINESS_FIXTURE_IDENTITY, BUSINESS_FIXTURE_TEXT, createBusinessFixture,
} from "../scripts/ios-business-fixture.mjs";

const runNonce = "ios-business-fixture-unit-nonce";
const jsonOptions = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function fixtureFor(t) {
  const fixture = await createBusinessFixture({ runNonce });
  t.after(() => fixture.close());
  return fixture;
}

async function login(fixture) {
  const response = await fetch(`${fixture.url}/auth/v1/token?grant_type=password`, jsonOptions(BUSINESS_FIXTURE_IDENTITY));
  assert.equal(response.status, 200);
  return response.json();
}

test("the temporary native localhost ATS origin reaches the same loopback fixture", async t => {
  const fixture = await fixtureFor(t);
  const origin = fixture.url.replace("127.0.0.1", "localhost");
  const response = await fetch(`${origin}/auth/v1/token?grant_type=password`, jsonOptions(BUSINESS_FIXTURE_IDENTITY));
  assert.equal(response.status, 200);
  assert.equal(fixture.snapshot().violations.nonLoopbackRequests, 0);
  assert.equal((await fetch(`${origin}/`)).status, 200);
});

function authed(fixture, session) {
  return async (path, options = {}) => fetch(fixture.url + path, {
    ...options, headers: { Authorization: `Bearer ${session.access_token}`, ...options.headers },
  });
}

test("loopback App startup and persona/memory reads have real receipt shapes", async t => {
  const fixture = await fixtureFor(t);
  assert.match(fixture.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const session = await login(fixture), request = authed(fixture, session);
  const bootstrapResponse = await request("/api/v2/bootstrap");
  const bootstrap = await bootstrapResponse.json();
  assert.match(bootstrapResponse.headers.get("x-dengta-companion-id"), /^[a-f0-9-]{36}$/);
  assert.equal(bootstrapResponse.headers.get("access-control-expose-headers"), "X-DengTa-Companion-Id");
  assert.equal(bootstrap.settings.account_role, "member");
  assert.equal(bootstrap.settings.prompt_mode, "unified");
  assert.equal(bootstrap.settings.push_enabled, false);
  assert.equal(bootstrap.sessions.length, 1);
  const responses = new Map([
    ["/api/v2/xinchao/state", data => assert.deepEqual(data, { configured: false, state: null })],
    ["/health", data => assert.equal(data.features.hervoice_proxy_configured, false)],
    ["/models", data => assert.equal(data.models[0].id, bootstrap.settings.model)],
    ["/api/v2/private-media/catalog", data => assert.deepEqual(data, { assets: [], preferences: {} })],
    ["/api/v2/voice-output/status", data => assert.equal(data.profile.provider, "server_default")],
    ["/api/v2/chat-skin/preferences", data => assert.equal(data.preferences.dynamic_composer_hint, false)],
    ["/api/ai-providers/status", data => assert.equal(data.available, false)],
    ["/api/v2/fun-labs/interests", data => assert.deepEqual(data.profile.interests, [])],
    ["/api/v2/fun-labs/recommend?limit=4", data => assert.deepEqual(data.recommend.videos, [])],
    ["/api/v2/special-dates", data => assert.deepEqual(data.dates, [])],
    ["/api/v2/fun-labs/achievements", data => assert.deepEqual(data.achievements, [])],
    ["/api/v2/fun-labs/daily-shots", data => assert.deepEqual(data, { today: null, recent: [] })],
    ["/api/v2/moments", data => assert.deepEqual(data, { available: true, entries: [] })],
    ["/api/v2/companion-profile", data => assert.deepEqual(data, { profile: {}, latest_version: null, versions: [] })],
    ["/api/v2/memories", data => { assert.equal(data.memories[0].summary, BUSINESS_FIXTURE_TEXT.baselineMemory); assert.equal(data.memories[0].confirmation_status, "confirmed"); }],
    ["/api/external-memory/connections", data => assert.deepEqual(data, { ok: true, connections: [] })],
    ["/api/ombre/config", data => assert.equal(data.configured, false)],
    ["/api/ombre/mcp/status", data => assert.equal(data.available, false)],
  ]);
  for (const [path, verify] of responses) { const response = await request(path); assert.equal(response.status, 200, path); verify(await response.json()); }
  const history = await (await request(`/api/v2/sessions/${bootstrap.sessions[0].id}/messages`)).json();
  assert.deepEqual(history.messages, []);
  const hint = await (await request(`/api/v2/chat-skin/conversations/${bootstrap.sessions[0].id}/hint`)).json();
  assert.deepEqual(hint, { hint: { hint: "" } });
  assert.ok(Object.values(fixture.snapshot().violations).every(value => value === 0));
});

test("strict allowlist rejects unknown paths, methods, queries, identities and runner gate origins", async t => {
  const fixture = await fixtureFor(t);
  assert.equal((await fetch(fixture.url + "/api/v2/bootstrap")).status, 401);
  assert.equal((await fetch(fixture.url + "/api/v2/unknown")).status, 404);
  assert.equal((await fetch(fixture.url + "/api/v2/bootstrap", { method: "POST" })).status, 404);
  assert.equal((await fetch(fixture.url + "/api/v2/bootstrap?anything=1")).status, 404);
  assert.equal((await fetch(fixture.url + "/auth/v1/token?grant_type=password", jsonOptions({ email: BUSINESS_FIXTURE_IDENTITY.email, password: "wrong" }))).status, 400);
  const session = await login(fixture), request = authed(fixture, session);
  assert.equal((await request("/api/v2/bootstrap", { headers: { "X-DengTa-Companion-Id": "unrelated" } })).status, 403);
  assert.equal((await request("/api/v2/bootstrap", { headers: { Origin: "https://example.com" } })).status, 403);
  const preflight = await fetch(fixture.url + "/api/v2/bootstrap", { method: "OPTIONS", headers: {
    Origin: "capacitor://localhost", "Access-Control-Request-Method": "GET",
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "capacitor://localhost");
  assert.equal((await fetch(fixture.url + "/__dengta_ci/ack-stream", { ...jsonOptions({ runNonce }), headers: { "Content-Type": "application/json", Origin: "capacitor://localhost" } })).status, 403);
  assert.equal((await fetch(fixture.url + "/__dengta_ci/ack-stream", jsonOptions({ runNonce: "bad" }))).status, 403);
  assert.equal((await fetch(fixture.url + "/__dengta_ci/ack-stream", jsonOptions({ runNonce }))).status, 409);
  const receipt = fixture.snapshot();
  assert.equal(receipt.violations.unknownRoutes, 3);
  assert.equal(receipt.violations.unauthorizedRequests, 3);
  assert.equal(receipt.violations.nonLoopbackRequests, 1);
  assert.equal(receipt.violations.gateOriginRequests, 1);
  assert.equal(receipt.violations.invalidNonces, 1);
  assert.equal(receipt.violations.prematureAcks, 1);
});

test("personalization round trip preserves whitespace and records actual baseline restoration", async t => {
  const fixture = await fixtureFor(t), session = await login(fixture), request = authed(fixture, session);
  const baseline = (await (await request("/api/v2/settings")).json()).settings;
  const change = { unified_system_prompt: "  合成个性化\n保留尾部空格  ", user_details: "\n合成长详情\n", ai_name: "验证小灯" };
  const write = async body => request("/api/v2/settings", { ...jsonOptions(body), method: "PUT" });
  const changed = await (await write(change)).json();
  assert.equal(changed.settings.unified_system_prompt, change.unified_system_prompt);
  assert.equal((await (await request("/api/v2/bootstrap")).json()).settings.user_details, change.user_details);
  assert.equal(fixture.snapshot().observed.settingsAtBaseline, false);
  assert.equal((await write({ account_role: "owner" })).status, 403);
  assert.equal((await write({ api_url: "https://external.invalid" })).status, 400);
  assert.equal((await write({ api_key: "must-not-store" })).status, 400);
  await write(baseline);
  assert.deepEqual((await (await request("/api/v2/settings")).json()).settings, baseline);
  const receipt = fixture.snapshot();
  assert.equal(receipt.counts.settingsWrites, 2);
  assert.equal(receipt.counts.settingsChanges, 1);
  assert.equal(receipt.counts.settingsRestores, 1);
  assert.equal(receipt.observed.settingsChanged, true);
  assert.equal(receipt.observed.settingsRestored, true);
  assert.equal(receipt.observed.settingsAtBaseline, true);
});

test("SSE sends first Chinese text but withholds terminal and persistence until runner acknowledgement", async t => {
  const fixture = await fixtureFor(t), session = await login(fixture), request = authed(fixture, session);
  const created = await (await request("/api/v2/sessions", jsonOptions({ title: "合成流式对话" }))).json();
  const form = new FormData();
  form.set("session_id", created.session.id); form.set("message", "本地验证消息"); form.set("client_message_id", "local-unit-message");
  const response = await request("/chat/stream", { method: "POST", body: form });
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  t.after(() => reader.cancel().catch(() => {}));
  let output = "";
  while (!output.includes(BUSINESS_FIXTURE_TEXT.firstToken)) output += decoder.decode((await reader.read()).value, { stream: true });
  assert.match(output, /"type":"meta"/);
  assert.doesNotMatch(output, /"type":"done"/);
  assert.equal(fixture.snapshot().observed.terminalSent, false);
  let history = await (await request(`/api/v2/sessions/${created.session.id}/messages`)).json();
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0].role, "user");
  const nextChunk = reader.read();
  const noTerminal = await Promise.race([nextChunk.then(() => false), new Promise(resolve => setTimeout(() => resolve(true), 65))]);
  assert.equal(noTerminal, true, "terminal must remain gated, independent of a timer");
  assert.equal((await fetch(fixture.url + "/__dengta_ci/ack-stream", jsonOptions({ runNonce: "wrong-nonce" }))).status, 403);
  assert.equal(fixture.snapshot().observed.terminalSent, false);
  assert.equal((await fetch(fixture.url + "/__dengta_ci/ack-stream", jsonOptions({ runNonce }))).status, 200);
  let chunk = await nextChunk;
  while (!chunk.done) { output += decoder.decode(chunk.value, { stream: true }); chunk = await reader.read(); }
  output += decoder.decode();
  const events = output.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  assert.deepEqual(events.map(event => event.type), ["meta", "text", "text", "done"]);
  assert.equal(events[2].content, BUSINESS_FIXTURE_TEXT.secondToken);
  assert.equal(events[3].assistant_message.content, BUSINESS_FIXTURE_TEXT.finalReply);
  assert.equal(events[3].ok, true);
  assert.equal(events[3].companion_status_updated, true);
  history = await (await request(`/api/v2/sessions/${created.session.id}/messages`)).json();
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[1].content, BUSINESS_FIXTURE_TEXT.finalReply);
  assert.ok((await (await request("/api/v2/sessions")).json()).sessions.some(item => item.id === created.session.id));
  const receipt = fixture.snapshot();
  assert.equal(receipt.counts.streams, 1); assert.equal(receipt.counts.streamAcks, 1);
  assert.equal(receipt.observed.firstTokenSent, true); assert.equal(receipt.observed.streamAcknowledged, true);
  assert.equal(receipt.observed.assistantMessagePersisted, true); assert.equal(receipt.observed.terminalSent, true);
  assert.equal((await fetch(fixture.url + "/__dengta_ci/ack-stream", jsonOptions({ runNonce }))).status, 409);
});

test("real GoTrue SDK signs in, persists, restores, refreshes and logs out through local transport", async t => {
  const fixture = await fixtureFor(t);
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const options = { url: fixture.url + "/auth/v1", storageKey: "synthetic-sdk-session",
    storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    headers: { apikey: BUSINESS_FIXTURE_IDENTITY.anonKey } };
  const client = new GoTrueClient(options);
  t.after(() => client.stopAutoRefresh());
  const result = await client.signInWithPassword(BUSINESS_FIXTURE_IDENTITY);
  assert.equal(result.error, null);
  assert.equal(result.data.user.email, BUSINESS_FIXTURE_IDENTITY.email);
  assert.ok(values.has("synthetic-sdk-session"));
  const restoredClient = new GoTrueClient(options);
  t.after(() => restoredClient.stopAutoRefresh());
  const restored = await restoredClient.getSession();
  assert.equal(restored.error, null);
  assert.equal(restored.data.session.user.email, BUSINESS_FIXTURE_IDENTITY.email);
  assert.equal((await restoredClient.getUser()).error, null);
  assert.equal((await restoredClient.refreshSession()).error, null);
  const active = (await restoredClient.getSession()).data.session;
  const request = authed(fixture, active);
  assert.equal((await request("/api/v2/bootstrap")).status, 200);
  assert.equal((await restoredClient.signOut()).error, null);
  assert.equal(values.has("synthetic-sdk-session"), false);
  assert.equal((await request("/api/v2/bootstrap")).status, 401);
  const receipt = fixture.snapshot();
  assert.equal(receipt.counts.logins, 1); assert.equal(receipt.counts.refreshes, 1);
  assert.equal(receipt.counts.userReads, 1); assert.equal(receipt.counts.logouts, 1);
  assert.equal(receipt.observed.authenticated, false); assert.equal(receipt.observed.loggedOut, true);
});

test("snapshot is an allowlisted receipt with only counts and booleans, isolated between runs", async t => {
  await assert.rejects(createBusinessFixture({ runNonce: "" }), /runNonce/);
  const fixture = await fixtureFor(t);
  await login(fixture);
  const receipt = fixture.snapshot();
  assert.deepEqual(Object.keys(receipt), ["schemaVersion", "synthetic", "loopbackOnly", "counts", "observed", "violations"]);
  for (const value of Object.values(receipt.counts)) assert.ok(Number.isSafeInteger(value) && value >= 0);
  for (const value of Object.values(receipt.observed)) assert.equal(typeof value, "boolean");
  for (const value of Object.values(receipt.violations)) assert.ok(Number.isSafeInteger(value) && value >= 0);
  const serialized = JSON.stringify(receipt);
  for (const forbidden of [runNonce, BUSINESS_FIXTURE_IDENTITY.email, BUSINESS_FIXTURE_IDENTITY.password,
    BUSINESS_FIXTURE_TEXT.firstToken, BUSINESS_FIXTURE_TEXT.baselineMemory, "access_token", "refresh_token", "123456789abc"]) assert.equal(serialized.includes(forbidden), false);
  receipt.counts.logins = 900;
  assert.equal(fixture.snapshot().counts.logins, 1);
  const other = await fixtureFor(t);
  assert.equal(other.snapshot().counts.logins, 0);
  assert.equal(other.snapshot().observed.authenticated, false);
  await other.close(); await other.close();
});
