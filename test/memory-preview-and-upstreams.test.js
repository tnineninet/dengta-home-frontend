import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { classifyPlaybackRelayEvent } from "../src/music-playback-sync.js";
import { extractTweetId, formatXResultTimestamps } from "../src/x-hub-utils.js";
import { createAuthSessionManager } from "../src/auth-session.js";

const textOf = (node) =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : (node?.children || []).map(textOf).join("");

async function settle() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

test("classifyPlaybackRelayEvent treats natural track end and routine pause as quiet relay events", () => {
  const ended = classifyPlaybackRelayEvent(
    { playbackState: "playing", musicPlaylistItemId: "track-1", mediaPositionSeconds: 180 },
    { playbackState: "paused", musicPlaylistItemId: "track-1", reason: "ended" },
  );
  assert.equal(ended.kind, "ended");
  assert.equal(ended.quiet, true);
  assert.equal(ended.shouldNotifyRoom, false);

  const paused = classifyPlaybackRelayEvent(
    { playbackState: "playing", musicPlaylistItemId: "track-1", mediaPositionSeconds: 40 },
    { playbackState: "paused", musicPlaylistItemId: "track-1", mediaPositionSeconds: 42 },
  );
  assert.equal(paused.kind, "paused");
  assert.equal(paused.quiet, true);
  assert.equal(paused.shouldNotifyRoom, false);

  const switched = classifyPlaybackRelayEvent(
    { playbackState: "playing", musicPlaylistItemId: "track-1", mediaPositionSeconds: 40 },
    { playbackState: "playing", musicPlaylistItemId: "track-2", mediaPositionSeconds: 0 },
  );
  assert.equal(switched.kind, "track_change");
  assert.equal(switched.quiet, false);
  assert.equal(switched.shouldNotifyRoom, true);

  const sought = classifyPlaybackRelayEvent(
    { playbackState: "playing", musicPlaylistItemId: "track-1", mediaPositionSeconds: 10 },
    { playbackState: "playing", musicPlaylistItemId: "track-1", mediaPositionSeconds: 95 },
  );
  assert.equal(sought.kind, "seek");
  assert.equal(sought.quiet, false);
  assert.equal(sought.shouldNotifyRoom, true);
});

test("visualPreview isolation prevents unauthenticated fetches across Diary, Nursery, MusicStudio, Memory, X, and ChannelHub", async () => {
  const descriptors = Object.fromEntries(
    ["window", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__previewTestManager"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const requests = [];
  const stored = new Map();
  const storage = {
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, v) => stored.set(k, String(v)),
    removeItem: (k) => stored.delete(k),
  };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test",
    supabaseAnonKey: "fictional-public-key",
    storage,
    createClientFn: () => ({
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: async () => ({ data: { session: null }, error: null }),
        refreshSession: async () => ({ data: { session: null }, error: null }),
        signOut: async () => ({ error: null }),
      },
    }),
  });
  await manager.initialize();

  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "__previewTestManager", { configurable: true, value: manager });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { href: "http://127.0.0.1:4173/visual-preview.html" },
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      confirm: () => true,
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url) => {
      requests.push(String(url));
      throw new Error("visualPreview must not call network API: " + url);
    },
  });

  const vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    envDir: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify("http://preview.example.test"),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(""),
    },
    plugins: [
      {
        name: "preview-test-auth-stub",
        enforce: "pre",
        transform(source, id) {
          const normalized = id.replaceAll("\\", "/").split("?")[0];
          if (normalized.endsWith("/src/auth-session.js")) {
            return source.replace(
              "export const authSession = createAuthSessionManager();",
              "export const authSession = globalThis.__previewTestManager;",
            );
          }
          return null;
        },
      },
    ],
  });

  try {
    const [
      { default: CompanionDiary },
      { default: Nursery },
      { default: MusicStudio },
      { default: MemoryGatewayStatus },
      { default: LocalMemorySummaries },
      { default: XHub },
      { default: ChannelHub },
      { default: WorkspaceManager },
    ] = await Promise.all([
      vite.ssrLoadModule("/src/CompanionDiary.jsx"),
      vite.ssrLoadModule("/src/Nursery.jsx"),
      vite.ssrLoadModule("/src/MusicStudio.jsx"),
      vite.ssrLoadModule("/src/MemoryGatewayStatus.jsx"),
      vite.ssrLoadModule("/src/LocalMemorySummaries.jsx"),
      vite.ssrLoadModule("/src/XHub.jsx"),
      vite.ssrLoadModule("/src/ChannelHub.jsx"),
      vite.ssrLoadModule("/src/WorkspaceManager.jsx"),
    ]);

    // XHub upstream helpers (x-twikit-mcp ec842b1)
    assert.equal(extractTweetId("https://x.com/dengta_ai/status/1890123456789012345?s=20"), "1890123456789012345");
    assert.equal(extractTweetId("https://twitter.com/i/web/status/1890123456789012345"), "1890123456789012345");
    assert.equal(extractTweetId("1890123456789012345"), "1890123456789012345");
    assert.equal(extractTweetId("not-a-tweet"), "");
    assert.match(formatXResultTimestamps("Posted at 2026-11-25T00:00:00Z"), /2026\/11\/25 08:00:00 \(UTC\+8\)/);

    const cases = [
      [React.createElement(CompanionDiary, { aiName: "灯塔", visualPreview: true }), /本地预览模式 · 记忆手记/],
      [React.createElement(Nursery, { aiName: "灯塔", visualPreview: true }), /小灯芽（本地预览）/],
      [React.createElement(MusicStudio, { visualPreview: true, onOpenSync: () => {} }), /本地预览 · 音乐工作室需登录后连接/],
      [React.createElement(MemoryGatewayStatus, { visualPreview: true }), /本地预览模式/],
      [
        React.createElement(LocalMemorySummaries, {
          scopeKey: "preview",
          items: [],
          drafts: {},
          onItemsChange: () => {},
          onDraftsChange: () => {},
          visualPreview: true,
        }),
        /注入预算/,
      ],
      [React.createElement(XHub, { visualPreview: true }), /本地预览 · X \/ Twitter MCP 通道/],
      [React.createElement(ChannelHub, { channel: "wechat", aiName: "灯塔", visualPreview: true }), /wechat-ilink-bridge-hardened/],
      [React.createElement(ChannelHub, { channel: "qq", aiName: "灯塔", visualPreview: true }), /QQ通道/],
      [React.createElement(WorkspaceManager, { accountScope: "preview", visualPreview: true }), /工作区（本地预览）/],
    ];

    for (const [element, expected] of cases) {
      let tree;
      await act(async () => {
        tree = TestRenderer.create(element);
        await settle();
      });
      const rendered = textOf(tree.toJSON());
      assert.match(rendered, expected);
      assert.doesNotMatch(rendered, /authentication_required/);
      await act(async () => {
        tree.unmount();
        await settle();
      });
    }

    assert.equal(requests.length, 0, "visualPreview mode must emit zero network requests");
  } finally {
    manager.destroy();
    await vite.close();
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
