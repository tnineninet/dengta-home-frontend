import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fixtureCache } from "./helpers/vite-fixture-cache.js";
import { describeKiwiListPage } from "../src/kiwi-list-presentation.js";

test("an empty page only means an empty library for a complete unfiltered list with a verified zero", () => {
  const page = { query: "", mode: "list", partial: false, hasMore: false, total: 0 };
  assert.match(describeKiwiListPage(page, 0).empty, /暂时没有长期记忆/);
  for (const changed of [{ total: null, partial: true }, { partial: true }, { total: 12 }, { hasMore: true }]) {
    assert.doesNotMatch(describeKiwiListPage({ ...page, ...changed }, 0).empty, /暂时没有长期记忆|没有找到匹配/);
  }
  const filtered = describeKiwiListPage({ ...page, query: "fictional" }, 0);
  assert.match(filtered.count, /匹配 0 条/);
  assert.match(filtered.empty, /匹配该关键词/);
  assert.match(describeKiwiListPage({ ...page, partial: true, total: 0 }, 0).count, /总数尚未确认/);
});

const root = fileURLToPath(new URL("..", import.meta.url));
const evidence = { ok: true, provider: "kiwi", storage: "kiwi", tenant_verified: true };
const list = (total, query = "") => ({ ...evidence, mode: query ? "search" : "list", total, partial: total === null, offset: 0, limit: 20, has_more: false, memories: [] });
const text = element => typeof element === "string" ? element : (element?.children || []).map(text).join("");
let vite;
before(async () => {
  vite = await createServer({ configFile: false, cacheDir: fixtureCache, envDir: false, root, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "memory-presentation-fixture", enforce: "pre",
      transform(source, id) {
        if (!id.replaceAll("\\", "/").split("?")[0].endsWith("/src/memory-ui-feedback.js")) return null;
        return source.replace("export function useMemoryUiRequest(", "export const useMemoryUiRequest = () => globalThis.__memoryPresentationFixture;\nfunction unusedRealRequest(");
      },
    }],
  });
});
after(async () => { await vite?.close(); });

async function render(name, props, reply) {
  const globals = Object.fromEntries(["window", "IS_REACT_ACT_ENVIRONMENT", "__memoryPresentationFixture"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const requests = [];
  Object.defineProperty(globalThis, "__memoryPresentationFixture", { configurable: true, value: {
    isCurrent: () => true, request: async path => { requests.push(path); return reply(path); },
  } });
  let tree, Component;
  async function finish() {
    if (tree) await act(async () => tree.unmount());
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
  try {
    ({ default: Component } = await vite.ssrLoadModule(`/src/${name}.jsx`));
    await act(async () => { tree = TestRenderer.create(React.createElement(Component, { scopeKey: "fictional", ...props })); });
  } catch (error) { await finish(); throw error; }
  return { requests, finish, text: () => text(tree.toJSON()),
    async click(label) {
      const button = tree.root.findAll(node => node.type === "button" && text(node) === label)[0];
      assert.ok(button, label);
      await act(async () => { button.props.onClick(); });
    },
    async query(value) {
      await act(async () => { tree.root.findByProps({ type: "search" }).props.onChange({ currentTarget: { value } }); });
    },
    async memoryEvent(scopeKey, source, jobId) {
      await act(async () => window.dispatchEvent(new CustomEvent("dengta:memory-updated", { detail: { scopeKey, source, jobId } })));
    },
    async changeScope(scopeKey) {
      await act(async () => tree.update(React.createElement(Component, { ...props, scopeKey })));
    },
  };
}

test("a search with no matches never describes the whole library as empty; changing the input labels old results", async () => {
  const h = await render("MemoryGatewayStatus", {}, path => path.includes("/health")
    ? { ...evidence, configured: true, reachable: true, memory_enabled: true, embedding_available: false, total_memories: null }
    : list(0, "fictional"));
  try {
    await h.click("检测连接与账号范围");
    assert.deepEqual(h.requests, ["/api/v2/memory/health"]);
    assert.match(h.text(), /未返回记忆总数/);
    assert.doesNotMatch(h.text(), /null 条|0 条记忆|语义召回未通过/);
    await h.query("fictional");
    await h.click("查看 / 搜索网关记忆");
    assert.match(h.text(), /匹配 0 条/);
    assert.doesNotMatch(h.text(), /暂时没有长期记忆/);
    await h.query("  fictional ");
    assert.doesNotMatch(h.text(), /输入已改变/);
    await h.query("changed");
    assert.match(h.text(), /输入已改变/);
    assert.doesNotMatch(h.text(), /没有找到匹配该关键词/);
  } finally { await h.finish(); }
});

test("an upgrade-required health response never publishes unverified counts or enables reading", async () => {
  const h = await render("MemoryGatewayStatus", {}, () => ({ ...evidence, ok: false, configured: true, reachable: true, memory_enabled: true, total_memories: 42, error: "kiwi_mem_status_upgrade_required" }));
  try {
    await h.click("检测连接与账号范围");
    assert.doesNotMatch(h.text(), /42 条记忆|查看 \/ 搜索网关记忆|服务可达 · 账号与伴侣范围已确认/);
  } finally { await h.finish(); }
});

test("opening or failing a list cannot publish a legacy session snapshot as a verified Kiwi record", async () => {
  const h = await render("LocalMemorySummaries", { items: [{ id: "legacy", summary: "FICTIONAL_CACHE_SENTINEL" }], onItemsChange() {}, onDraftsChange() {} }, () => ({ memories: [] }));
  try {
    assert.deepEqual(h.requests, ["/api/v2/memories"]);
    assert.match(h.text(), /总数尚未确认/);
    assert.doesNotMatch(h.text(), /FICTIONAL_CACHE_SENTINEL|暂时没有长期记忆/);
  } finally { await h.finish(); }
});

test("learned profile is read on demand; unavailable data stays hidden and manual precedence requires its own receipt", async () => {
  const profile = { ...evidence, profile_source: "kiwi_learned", available: false, profile: "FICTIONAL_STALE_PROFILE", summary: "FICTIONAL_STALE_SUMMARY", updated_at: null, summary_updated_at: null };
  const h = await render("KiwiLearnedProfile", {}, () => ({ ...profile }));
  try {
    assert.equal(h.requests.length, 0);
    await h.click("查看画像与摘要");
    assert.deepEqual(h.requests, ["/api/v2/memory/profile"]);
    assert.match(h.text(), /暂未提供/);
    assert.doesNotMatch(h.text(), /FICTIONAL_STALE|尚未生成|已确认：手动设置优先/);
    Object.assign(profile, { available: true, profile: "FICTIONAL_PROFILE", summary: "", manual_persona_source: "settings", manual_persona_authoritative: true });
    await h.click("刷新画像与摘要");
    assert.match(h.text(), /FICTIONAL_PROFILE/);
    assert.match(h.text(), /没有返回摘要内容/);
    assert.match(h.text(), /已确认：手动设置优先/);
  } finally { await h.finish(); }
});

test("reopening labels a previously published summary until Kiwi confirms it covers the latest chat", async () => {
  const profile = { ...evidence, profile_source: "kiwi_learned", available: true, fresh: false, profile: "合成人物", summary: "旧的合成摘要", updated_at: null, summary_updated_at: null };
  const h = await render("KiwiLearnedProfile", {}, () => ({ ...profile }));
  try {
    await h.click("查看画像与摘要");
    assert.match(h.text(), /尚未确认已覆盖最新对话/);
    assert.match(h.text(), /旧的合成摘要/);
    Object.assign(profile, { fresh: true, summary: "新的合成摘要" });
    await h.click("刷新画像与摘要");
    assert.match(h.text(), /新的合成摘要/);
    assert.doesNotMatch(h.text(), /尚未确认已覆盖最新对话|旧的合成摘要/);
  } finally { await h.finish(); }
});

test("previously read profile is labelled during concurrent jobs and after failure, and changing scope clears the old content and job state", async () => {
  const h = await render("KiwiLearnedProfile", {}, () => ({ ...evidence, profile_source: "kiwi_learned", available: true, profile: "FICTIONAL_PRIOR", summary: "", updated_at: null, summary_updated_at: null }));
  try {
    await h.click("查看画像与摘要");
    await h.memoryEvent("unrelated", "chat-job-accepted", "other");
    assert.doesNotMatch(h.text(), /正在整理中/);
    await h.memoryEvent("fictional", "chat-job-accepted", "a");
    await h.memoryEvent("fictional", "chat-job-accepted", "b");
    assert.match(h.text(), /正在整理中。下方是上次确认的画像与摘要/);
    await h.memoryEvent("fictional", "chat-job-succeeded", "a");
    assert.equal(h.requests.length, 2);
    assert.match(h.text(), /正在整理中/);
    await h.memoryEvent("fictional", "chat-job-failed", "b");
    assert.equal(h.requests.length, 2);
    assert.match(h.text(), /整理失败。仍显示上次确认/);
    assert.match(h.text(), /FICTIONAL_PRIOR/);
    assert.doesNotMatch(h.text(), /正在整理中|已更新/);
    await h.changeScope("other-account-or-companion");
    assert.doesNotMatch(h.text(), /FICTIONAL_PRIOR|整理失败|正在整理中/);
    assert.match(h.text(), /尚未读取/);
  } finally { await h.finish(); }
});
