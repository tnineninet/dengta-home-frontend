import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import {
  createDefaultCompanionStatus, createResetCompanionStatus,
  mergeCompanionStatus, normalizeCompanionStatus,
  readCompanionStatus, saveCompanionStatus,
} from "../src/companion-status.js";

test("generated state survives storage and revision merge without fabricating missing fields", () => {
  const beforeStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  try {
    const original = { ...createDefaultCompanionStatus(), psychology: "在想刚才那一下", feeling: "有一点惊喜", moodLevel: 83, patienceLevel: 61, statusSource: "model", revision: 7 };
    saveCompanionStatus(original, "a:companion-a");
    saveCompanionStatus({ ...original, psychology: "另一个角色", patienceLevel: 22 }, "a:companion-b");
    assert.equal(readCompanionStatus("a:companion-a").psychology, original.psychology);
    assert.equal(readCompanionStatus("a:companion-b").patienceLevel, 22);
    assert.equal(readCompanionStatus("other").moodLevel, null);
    const stale = mergeCompanionStatus(original, { psychology: "过时回执", moodLevel: 5 }, { baseRevision: 6 });
    assert.equal(stale.psychology, original.psychology);
    const next = mergeCompanionStatus(original, { psychology: "连续互动后想歇一会儿", patienceLevel: 40, revision: 8 }, { baseRevision: 7 });
    assert.equal(next.patienceLevel, 40);
    assert.equal(next.feeling, original.feeling);
    const unavailable = mergeCompanionStatus(original, { psychology: "", feeling: "", moodLevel: null, patienceLevel: null, statusSource: "interaction_fallback" }, { baseRevision: 7 });
    assert.equal(unavailable.psychology, "");
    assert.equal(unavailable.patienceLevel, null);
    assert.equal(normalizeCompanionStatus({ moodLevel: 999, patienceLevel: -2 }).moodLevel, 100);
    assert.equal(normalizeCompanionStatus({ moodLevel: "invalid" }).moodLevel, null);
    assert.equal(normalizeCompanionStatus({ statusSource: "fabricated" }).statusSource, "");
    assert.equal(normalizeCompanionStatus({ psychology: "x".repeat(300) }).psychology.length, 240);
    assert.equal(normalizeCompanionStatus({ ...original, resetBlank: true }).psychology, "");
    assert.equal(createResetCompanionStatus().patienceLevel, null);
  } finally { globalThis.localStorage = beforeStorage; }
});

test("capsule retains generated feelings through touch, renders pending/failure and then actual new state", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }), requestAnimationFrame: () => 1, cancelAnimationFrame() {}, clearTimeout() {} };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let tree;
  const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
  try {
    const { default: Component } = await vite.ssrLoadModule("/src/CompanionStatus.jsx");
    let status = { ...createDefaultCompanionStatus(), mood: "好奇", note: "已经生成的回复", psychology: "留意着你", feeling: "有点惊喜", moodLevel: 83, patienceLevel: 61, statusSource: "model" };
    const props = { status, aiName: "测试角色", interactionStats: { counts: { hand: 3 } }, onChange: transform => { status = transform(status); }, onInteract: () => ({ counts: { hand: 4 }, lastZoneId: "hand", streakCount: 4 }) };
    await act(async () => { tree = TestRenderer.create(React.createElement(Component, props)); });
    await act(async () => tree.root.findByProps({ "data-interaction-zone": "hand" }).props.onClick());
    assert.equal(status.note, "已经生成的回复");
    assert.equal(status.mood, "好奇");
    assert.equal(status.psychology, "留意着你");
    assert.match(status.recentRecords[0].text, /第 4 次/);
    assert.equal(tree.root.findAllByType("meter").length, 2);
    assert.ok(tree.root.findByProps({ className: "sun-glass-liquid-capsule-toggle" }));
    await act(async () => tree.update(React.createElement(Component, { ...props, status, interactionFeedback: { state: "queued" } })));
    assert.match(text(tree.toJSON()), /正在准备这次感受/);
    assert.match(text(tree.toJSON()), /留意着你/);
    await act(async () => tree.update(React.createElement(Component, { ...props, status, interactionFeedback: { state: "failed", message: "连接中断，再碰一下可以重试。" } })));
    assert.match(text(tree.toJSON()), /连接中断/);
    await act(async () => tree.update(React.createElement(Component, { ...props, status: { ...status, psychology: "被连续互动逗笑了", patienceLevel: 50 } })));
    assert.match(text(tree.toJSON()), /被连续互动逗笑了/);
    assert.equal(tree.root.findByProps({ "aria-label": "耐心" }).props.value, 50);
  } finally {
    if (tree) await act(async () => tree.unmount());
    await vite.close();
    globalThis.window = previous.window; globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
