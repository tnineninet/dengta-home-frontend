import assert from "node:assert/strict";
import test, { after } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ configFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
const { default: Panel } = await vite.ssrLoadModule("/src/XhsWritePanel.jsx");
const text = (node) => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = (view, label) => view.root.findAllByType("button").find((node) => text(node).includes(label));

test("preview must be shown before confirmation; idempotency key is stable across retries", async () => {
  const calls = [];
  let previewCalls = 0;
  const operations = {
    async preview(input) {
      previewCalls += 1;
      calls.push(["preview", input]);
      return { confirmation_token: "token-1", summary: "点赞该笔记", target_id: "note-1", expires_at: "2030-01-01T00:00:00.000Z" };
    },
    async confirm({ confirmationToken, idempotencyKey }) {
      calls.push(["confirm", confirmationToken, idempotencyKey]);
      return { ok: true, action: "like", replayed: false };
    },
  };
  let view;
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Panel, { operations })); });
    await act(async () => {
      view.root.findByType("input").props.onChange({ target: { value: "note-1" } });
    });
    await act(async () => { await view.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    assert.equal(previewCalls, 1);
    assert.match(text(view.toJSON()), /点赞该笔记/);
    assert.equal(button(view, "确认执行一次").props.disabled, false);
    assert.equal(calls.filter((item) => item[0] === "confirm").length, 0);
    await act(async () => { await button(view, "确认执行一次").props.onClick(); });
    assert.equal(calls.filter((item) => item[0] === "confirm").length, 1);
    const firstKey = calls.find((item) => item[0] === "confirm")[2];
    assert.ok(firstKey);
    assert.match(text(view.toJSON()), /操作已完成/);
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

test("replay and conflict states are explicit and never claim a fresh write", async () => {
  const operations = {
    async preview() {
      return { confirmation_token: "token-2", summary: "发表评论：你好", target_id: "note-2" };
    },
    async confirm() {
      return { ok: true, action: "comment", replayed: true };
    },
  };
  let view;
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Panel, { operations })); });
    await act(async () => {
      view.root.findByType("select").props.onChange({ target: { value: "comment" } });
    });
    const inputs = view.root.findAllByType("input");
    await act(async () => inputs[0].props.onChange({ target: { value: "note-2" } }));
    await act(async () => view.root.findByType("textarea").props.onChange({ target: { value: "你好" } }));
    await act(async () => { await view.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await act(async () => { await button(view, "确认执行一次").props.onClick(); });
    assert.match(text(view.toJSON()), /同一幂等收据/);
  } finally {
    if (view) await act(async () => view.unmount());
  }

  const conflicted = {
    async preview() {
      return { confirmation_token: "token-3", summary: "点赞该笔记", target_id: "note-3" };
    },
    async confirm() {
      const error = new Error("幂等冲突");
      error.code = "xhs_idempotency_conflict";
      throw error;
    },
  };
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Panel, { operations: conflicted })); });
    await act(async () => {
      view.root.findByType("input").props.onChange({ target: { value: "note-3" } });
    });
    await act(async () => { await view.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await act(async () => { await button(view, "确认执行一次").props.onClick(); });
    assert.match(text(view.toJSON()), /幂等冲突/);
    assert.doesNotMatch(text(view.toJSON()), /操作已完成/);
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

after(async () => { await vite.close(); });
