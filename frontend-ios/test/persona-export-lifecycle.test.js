import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fixtureCache } from "./helpers/vite-fixture-cache.js";
import { createAuthSessionManager } from "../src/auth-session.js";
import { settingsSaveScope } from "../src/settings-save-scope.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111", ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333", COMPANION_B = "44444444-4444-4444-8444-444444444444";
const persona = { format: "dengta.astrbot-persona", version: 1, name: "合成伴侣", prompt_mode: "unified", persona: { unified_system_prompt: "FICTIONAL_PERSONA" } };
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function settle() { for (let i = 0; i < 60; i += 1) await Promise.resolve(); }

async function harness() {
  const descriptors = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__personaExportFixture"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const stored = new Map(), requests = [], downloads = [], timers = new Map();
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) };
  const sessionFor = account => ({ access_token: "fictional-" + account, user: { id: account, email: "fictional@example.test" } });
  let session = sessionFor(ACCOUNT_A), listener, nextTimer = 0, tree;
  const sdk = { auth: {
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    async signOut() { session = null; listener?.("SIGNED_OUT", null); return { error: null }; },
  } };
  const manager = createAuthSessionManager({ supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage, createClientFn: () => sdk });
  await manager.initialize(); manager.setActiveCompanionId(COMPANION_A);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    DengTaFileBridge: { saveExport(data, filename) { downloads.push({ data, filename }); } },
  } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "__personaExportFixture", { configurable: true, value: { manager } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise(resolve => {
    assert.equal(new URL(url).origin, "http://personaexport.example.test", "fixture never contacts a real service");
    requests.push({ url: new URL(url), options, respond: resolve });
  }) });
  const vite = await createServer({ configFile: false, cacheDir: fixtureCache, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://personaexport.example.test"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") },
    plugins: [{ name: "persona-export-fixture-auth", enforce: "pre", transform(source, id) {
      if (id.replaceAll("\\", "/").split("?")[0].endsWith("/src/auth-session.js")) return source.replace("export const authSession = createAuthSessionManager();", "export const authSession = globalThis.__personaExportFixture.manager;");
      return null;
    } }],
  });
  const { default: Component } = await vite.ssrLoadModule("/src/AstrBotPersonaExport.jsx");
  async function render() {
    await act(async () => {
      const element = React.createElement(Component, { key: settingsSaveScope(manager.getSnapshot()), disabled: false });
      if (tree) tree.update(element); else tree = TestRenderer.create(element);
      await settle();
    });
  }
  await render();
  return { manager, requests, downloads, timers, render, text: () => text(tree.toJSON()),
    async click() { await act(async () => { tree.root.findByType("button").props.onClick(); await settle(); }); },
    async includeDetails(checked) { await act(async () => tree.root.findByType("input").props.onChange({ target: { checked } })); },
    async respond(index, status = 200, data = persona) { await act(async () => { requests[index].respond(new Response(JSON.stringify(data), { status })); await settle(); }); },
    async raw(index, response) { await act(async () => { requests[index].respond(response); await settle(); }); },
    switchScope(account = false, returnToOriginal = false) {
      if (account) { session = sessionFor(ACCOUNT_B); listener("SIGNED_IN", session); }
      manager.setActiveCompanionId(COMPANION_B);
      if (returnToOriginal) manager.setActiveCompanionId(COMPANION_A);
    },
    async timeout() { await act(async () => { const timer = [...timers.entries()].find(([, value]) => value.delay === 15_000); assert.ok(timer, "export bounds the complete response body"); timers.delete(timer[0]); timer[1].callback(); await settle(); }); },
    async unmount() { await act(async () => { tree?.unmount(); tree = null; await settle(); }); },
    async finish() { await this.unmount(); manager.destroy(); await vite.close(); for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}

for (const [name, account, returnToOriginal] of [["companion", false, false], ["account", true, false], ["A→B→A", false, true]]) {
  test(`a late successful persona export after ${name} changes cannot download old private data before React renders`, async () => {
    const h = await harness();
    try {
      await h.includeDetails(true); await h.click();
      assert.equal(h.requests[0].url.searchParams.get("include_user_details"), "true");
      h.switchScope(account, returnToOriginal);
      await h.respond(0, 200, { ...persona, persona: { ...persona.persona, user_details: "FICTIONAL_PRIVATE_DETAILS" } });
      assert.equal(h.downloads.length, 0);
      assert.doesNotMatch(h.text(), /已生成文件/);
    } finally { await h.finish(); }
  });
}

test("a stalled export JSON body times out and manual retry uses a new GET without downloading the late body", async () => {
  const h = await harness(), body = deferred();
  try {
    await h.click(); await h.raw(0, { ok: true, status: 200, headers: new Headers(), json: () => body.promise });
    await h.timeout(); assert.match(h.text(), /超时/); assert.equal(h.downloads.length, 0);
    await h.click(); await h.respond(1);
    assert.equal(h.requests.length, 2); assert.ok(h.requests.every(({ options }) => !options.method || options.method === "GET"));
    assert.equal(h.downloads.length, 1);
    await act(async () => { body.resolve(persona); await settle(); });
    assert.equal(h.downloads.length, 1);
  } finally { await h.finish(); }
});

test("leaving settings cancels export and the details option defaults off for a later scope", async () => {
  const h = await harness();
  try {
    await h.includeDetails(true); await h.click(); await h.unmount();
    assert.equal(h.requests[0].options.signal.aborted, true);
    await h.respond(0); assert.equal(h.downloads.length, 0); assert.equal(h.timers.size, 0);
    h.switchScope(); await h.render(); await h.click();
    assert.equal(h.requests[1].url.searchParams.get("include_user_details"), "false");
    await h.respond(1); assert.equal(h.downloads.length, 1);
    assert.deepEqual(JSON.parse(Buffer.from(h.downloads[0].data.split(",")[1], "base64").toString("utf8")), persona);
  } finally { await h.finish(); }
});
