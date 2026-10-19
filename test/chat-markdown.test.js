import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const textOf = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(textOf).join("");

test("chat markdown renders bold, italic, code and unfinished streaming markers", async () => {
  const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let renderer;
  try {
    const { renderChatMarkdown } = await vite.ssrLoadModule("/src/chat-markdown.jsx");
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        renderChatMarkdown("**推荐并加购**\n**店铺：** 小满\n*热的* 和 `豆浆`，还有 **未闭合")));
    });
    assert.equal(renderer.root.findAllByType("strong").length, 3);
    assert.equal(renderer.root.findAllByType("em").length, 1);
    assert.equal(renderer.root.findAllByType("code").length, 1);
    const text = textOf(renderer.toJSON());
    assert.equal(text.includes("**"), false);
    assert.match(text, /推荐并加购/);
    assert.match(text, /小满/);
    assert.match(text, /未闭合/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await vite.close();
  }
});

test("plain roleplay angle brackets remain text, not HTML", async () => {
  const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let renderer;
  try {
    const { renderChatMarkdown } = await vite.ssrLoadModule("/src/chat-markdown.jsx");
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, renderChatMarkdown("普通 <微笑> 文本"))); });
    assert.equal(textOf(renderer.toJSON()), "普通 <微笑> 文本");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await vite.close();
  }
});
