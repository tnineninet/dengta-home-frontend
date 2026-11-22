import assert from "node:assert/strict";
import test, { after } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ configFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
const { default: PublishPanel } = await vite.ssrLoadModule("/src/XhsPublishPanel.jsx");
const { default: NotificationsPanel } = await vite.ssrLoadModule("/src/XhsNotificationsPanel.jsx");
const text = (node) => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = (view, label) => view.root.findAllByType("button").find((node) => text(node).includes(label));

test("publish shows a draft preview before confirmation", async () => {
  let confirmed = null;
  const operations = {
    async preview(input) {
      assert.equal(input.action, "publish");
      return { confirmation_token: "publish-token", summary: "发布小红书图文：标题", preview: { title: input.title, images: input.images }, expires_at: "2030-01-01T00:00:00.000Z" };
    },
    async confirm({ confirmationToken, idempotencyKey }) {
      confirmed = { confirmationToken, idempotencyKey };
      return { ok: true, action: "publish", replayed: false };
    },
  };
  let view;
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(PublishPanel, { operations })); });
    const inputs = view.root.findAllByType("input");
    const textareas = view.root.findAllByType("textarea");
    await act(async () => {
      inputs[0].props.onChange({ target: { value: "标题" } });
      textareas[0].props.onChange({ target: { value: "正文" } });
      textareas[1].props.onChange({ target: { value: "https://cdn.example.test/a.jpg" } });
    });
    await act(async () => { await view.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    assert.match(text(view.toJSON()), /发布小红书图文：标题/);
    assert.equal(confirmed, null);
    await act(async () => { await button(view, "确认发布").props.onClick(); });
    assert.ok(confirmed);
    assert.match(text(view.toJSON()), /已提交发布/);
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

test("notifications render unread counts and list without writing", async () => {
  const operations = {
    async read() {
      return { unread: { comments: 2, likes: 3, follows: 1 }, list: { notifications: [{ id: "n1", type: "comment", content: "虚构通知" }] } };
    },
  };
  let view;
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(NotificationsPanel, { operations })); });
    await act(async () => { await button(view, "读取通知").props.onClick(); });
    const body = text(view.toJSON());
    assert.match(body, /虚构通知/);
    assert.match(body, /评论\/at 2/);
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

after(async () => { await vite.close(); });
