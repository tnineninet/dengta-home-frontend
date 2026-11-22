import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const { default: ProviderModelPicker } = await vite.ssrLoadModule("/src/provider-model-picker.jsx");

after(async () => { await vite.close(); });

function renderPicker(props) {
  let tree;
  act(() => { tree = TestRenderer.create(React.createElement(ProviderModelPicker, props)); });
  return tree;
}
const toggle = tree => tree.root.findByProps({ "aria-haspopup": "listbox" });
const listbox = tree => tree.root.findByProps({ role: "listbox" });
const options = tree => tree.root.findAllByProps({ role: "option" });
const hasListbox = tree => tree.root.findAllByProps({ role: "listbox" }).length > 0;

test("the model button opens a real listbox instead of a datalist", () => {
  const tree = renderPicker({ value: "", models: [], onChange() {} });
  assert.equal(toggle(tree).props["aria-expanded"], false);
  assert.equal(hasListbox(tree), false);
  act(() => toggle(tree).props.onClick());
  assert.equal(toggle(tree).props["aria-expanded"], true);
  assert.ok(listbox(tree), "opening must render an accessible listbox");
  assert.match(JSON.stringify(tree.toJSON()), /还没有模型目录/);
  assert.match(JSON.stringify(tree.toJSON()), /手动输入服务商文档里的模型名/);
  act(() => { listbox(tree).props.onKeyDown({ key: "Escape", preventDefault() {} }); });
  assert.equal(hasListbox(tree), false);
});

test("a tap on an option fills the model and closes the popover", () => {
  const changes = [];
  const tree = renderPicker({
    value: "model-b",
    models: ["model-a", "model-b"],
    onChange: value => changes.push(value),
  });
  act(() => toggle(tree).props.onClick());
  const items = options(tree);
  assert.equal(items.length, 2);
  assert.equal(items[1].props["aria-selected"], true, "the current model stays highlighted");
  act(() => items[0].props.onClick());
  assert.deepEqual(changes, ["model-a"]);
  assert.equal(hasListbox(tree), false);
  assert.equal(toggle(tree).props["aria-expanded"], false);
});

test("arrow keys and enter select a model without a pointer", () => {
  const changes = [];
  const tree = renderPicker({
    value: "model-a",
    models: ["model-a", "model-b", "model-c"],
    onChange: value => changes.push(value),
  });
  act(() => toggle(tree).props.onClick());
  act(() => { listbox(tree).props.onKeyDown({ key: "ArrowDown", preventDefault() {} }); });
  act(() => { listbox(tree).props.onKeyDown({ key: "Enter", preventDefault() {} }); });
  assert.deepEqual(changes, ["model-b"]);
});

test("long catalogs expose a filter and only render matches", () => {
  const tree = renderPicker({
    value: "",
    models: ["alpha-1", "alpha-2", "alpha-3", "beta-1", "beta-2", "gamma-1", "delta-1", "epsilon-1"],
    onChange() {},
  });
  act(() => toggle(tree).props.onClick());
  assert.equal(options(tree).length, 8);
  const filter = tree.root.findByProps({ "aria-label": "筛选模型" });
  act(() => filter.props.onChange({ target: { value: "beta" } }));
  assert.equal(options(tree).length, 2);
  act(() => filter.props.onChange({ target: { value: "no-such-model" } }));
  assert.equal(options(tree).length, 0);
  assert.match(JSON.stringify(tree.toJSON()), /没有匹配的模型/);
});

test("a disabled picker cannot open while another operation is busy", () => {
  const tree = renderPicker({ value: "", models: ["model-a"], busy: true, onChange() {} });
  assert.equal(toggle(tree).props.disabled, true);
  assert.equal(hasListbox(tree), false);
});
