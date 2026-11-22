import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
const { default: CommandPalette } = await vite.ssrLoadModule("/src/CommandPalette.jsx");
const features = [{ id: "chat", label: "Chat", icon: "C" }, { id: "music", label: "Music", icon: "M" }];
const settingsCategories = [{ id: "persona", label: "个性化", description: "表达与记忆" }];

function key(key, extra = {}) {
  const calls = { prevented: 0, stopped: 0 };
  return { event: { key, preventDefault: () => calls.prevented++, stopPropagation: () => calls.stopped++, ...extra }, calls };
}

test("command palette filters real entries, cancels IME Enter, and confirms explicitly", async () => {
  const navigated = [], closed = [], settings = [];
  let tree;
  await act(async () => {
    tree = TestRenderer.create(React.createElement(CommandPalette, {
      open: true,
      onClose: options => closed.push(options),
      onNavigate: (view, sessionId) => navigated.push([view, sessionId]),
      onOpenSettings: category => settings.push(category),
      features,
      settingsCategories,
      sessions: [{ id: "session-1", title: "雨天的对话" }],
    }), { createNodeMock: element => element.type === "input" ? { focus: () => {} } : null });
  });
  const input = tree.root.findByType("input");
  await act(async () => input.props.onChange({ target: { value: "音乐" } }));
  assert.equal(tree.root.findAll(node => node.type === "button" && node.props["aria-selected"] !== undefined).length, 1);
  const composing = key("Enter", { isComposing: true });
  await act(async () => input.props.onKeyDown(composing.event));
  assert.deepEqual(navigated, []);
  const confirm = key("Enter");
  await act(async () => input.props.onKeyDown(confirm.event));
  assert.deepEqual(navigated, [["music", undefined]]);
  assert.ok(closed.at(-1)?.navigate === true);
  for (const [query, category] of [["打开设置", undefined], ["个性化", "persona"]]) {
    await act(async () => input.props.onChange({ target: { value: query } }));
    const [row] = tree.root.findAll(node => node.type === "button" && node.props["aria-selected"] === true);
    await act(async () => row.props.onClick());
    assert.equal(settings.at(-1), category);
    assert.equal(closed.at(-1)?.navigate, true, "the settings sheet owns focus after navigation");
  }
  assert.deepEqual(settings, [undefined, "persona"]);
  await act(async () => tree.unmount());
  await vite.close();
});
