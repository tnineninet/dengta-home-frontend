import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const text = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(text).join("");

test("a partial assistant message keeps its text, shows the interruption label and copies the fragment", async () => {
  const clipboard = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async value => { clipboard.push(value); } } },
  });
  const vite = await createServer({ appType: "custom", envDir: false, logLevel: "silent", server: { middlewareMode: true } });
  let renderer;
  try {
    const { default: ChatMessage } = await vite.ssrLoadModule("/src/ChatMessage.jsx");
    const item = {
      id: "fictional-partial",
      role: "assistant",
      content: "已经生成到一半的正文，不能被删掉。",
      created_at: "2026-10-20T10:00:00Z",
      tool_calls: { partial_reply: true },
    };
    await act(async () => { renderer = TestRenderer.create(React.createElement(ChatMessage, { item })); });
    const rendered = text(renderer.toJSON());
    assert.match(rendered, /已经生成到一半的正文/, "partial text must stay visible");
    assert.match(rendered, /生成中断 · 已保留当时内容/);
    const copyButton = renderer.root.findAllByType("button").find(button => text(button).includes("复制片段"));
    assert.ok(copyButton, "partial copy action must exist");
    await act(async () => copyButton.props.onClick());
    assert.deepEqual(clipboard, [item.content]);
    assert.match(text(renderer.toJSON()), /已复制片段/);
    await act(async () => renderer.unmount());
    renderer = null;

    await act(async () => { renderer = TestRenderer.create(React.createElement(ChatMessage, { item: { ...item, tool_calls: {} } })); });
    assert.doesNotMatch(text(renderer.toJSON()), /生成中断 · 已保留当时内容/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await vite.close();
  }
});
