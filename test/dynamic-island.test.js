import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { createDefaultCompanionStatus } from "../src/companion-status.js";

test("Dynamic Island renders live NetEase spectrum, satellite pills and control deck actions", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT, fetch: globalThis.fetch };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ configured: false }) });
  globalThis.window = {
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
  };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };

  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true, watch: null },
    plugins: [{
      name: "di-portal-stub",
      enforce: "pre",
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/CompanionStatus.jsx")) {
          return code.replace('import { createPortal } from "react-dom";', "const createPortal = children => children;");
        }
      },
    }],
  });

  let tree;
  try {
    const { default: CompanionStatus } = await vite.ssrLoadModule("/src/CompanionStatus.jsx");
    const calls = { music: 0, studio: 0, takeout: 0, knowledge: 0, errors: 0 };
    const status = {
      ...createDefaultCompanionStatus(),
      mood: "轻快",
      note: "在听歌呢",
      countdown: {
        label: "专注陪伴",
        totalSeconds: 1500,
        remainingSeconds: 600,
        isRunning: true,
        endsAt: new Date(Date.now() + 600_000).toISOString(),
      },
    };

    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(CompanionStatus, {
          status,
          aiName: "小灯",
          onChange: () => {},
          onStartBuiltInMusic: () => { calls.music += 1; },
          onOpenMusicStudio: () => { calls.studio += 1; },
          takeoutTask: { status: "working", message: "正在挑店" },
          onOpenTakeout: () => { calls.takeout += 1; },
          onOpenKnowledge: () => { calls.knowledge += 1; },
          errorCount: 2,
          onOpenErrorLogs: () => { calls.errors += 1; },
        }),
      );
    });

    const flatten = (node) =>
      typeof node === "string" || typeof node === "number"
        ? String(node)
        : Array.isArray(node)
          ? node.map(flatten).join("")
          : (node?.children || []).map(flatten).join("");
    const textContent = flatten(tree.toJSON());
    assert.match(textContent, /网易云随心听/);
    assert.match(textContent, /外卖选餐中/);
    assert.match(textContent, /2 条诊断/);
    assert.match(textContent, /灵动岛|Dynamic Island/);
    assert.match(textContent, /药箱与知识/);

    // Trigger satellite pills
    const musicPill = tree.root.findByProps({ className: "di-satellite-pill is-music" });
    await act(async () => musicPill.props.onClick());
    assert.equal(calls.music, 1);

    const takeoutPill = tree.root.findByProps({ className: "di-satellite-pill is-takeout" });
    await act(async () => takeoutPill.props.onClick());
    assert.equal(calls.takeout, 1);

    const errorPill = tree.root.findByProps({ className: "di-satellite-pill is-alert" });
    await act(async () => errorPill.props.onClick());
    assert.equal(calls.errors, 1);

    // Switch to playing NetEase song -> verify live audio spectrum renders
    await act(async () => {
      tree.update(
        React.createElement(CompanionStatus, {
          status,
          aiName: "小灯",
          onChange: () => {},
          nowPlaying: {
            title: "晴天",
            artist: "周杰伦",
            album: "叶惠美",
            cover: "http://p1.music.126.net/test/qingtian.jpg",
            isPlaying: true,
            canControl: true,
            availableActions: ["play", "pause", "next"],
          },
          onStartBuiltInMusic: () => { calls.music += 1; },
          onOpenMusicStudio: () => { calls.studio += 1; },
        }),
      );
    });
    const playingJson = JSON.stringify(tree.toJSON());
    assert.match(playingJson, /di-audio-spectrum is-playing/);
    assert.match(playingJson, /晴天/);
    assert.match(playingJson, /sun-glass-now-playing-art/);
    assert.match(playingJson, /https:\/\/p1\.music\.126\.net\/test\/qingtian\.jpg/);
  } finally {
    if (tree) await act(async () => tree.unmount());
    await vite.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    globalThis.fetch = previous.fetch;
  }
});
