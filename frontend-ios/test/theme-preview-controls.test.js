import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { DEFAULT_THEME_PREFERENCES } from "../src/dengta-theme.js";

const server = await createServer({ server: { middlewareMode: true }, logLevel: "silent" });
const ThemeStudio = (await server.ssrLoadModule("/src/ThemeStudio.jsx")).default;
const previous = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
Object.defineProperty(globalThis, "document", { value: { documentElement: { dataset: {} } }, configurable: true });
test.after(async () => {
  await server.close();
  if (previous) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previous);
  else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else delete globalThis.document;
});

test("a manual time remains visible and can return to live after switching every background", async () => {
  const previews = [], themes = [];
  let tree;
  const props = {
    minute: 480, previewing: true, onPreview: minute => previews.push(minute),
    updateTheme: patch => themes.push(patch),
  };
  try {
    for (const background of ["auto", "coast", "legacy"]) {
      const preferences = { ...DEFAULT_THEME_PREFERENCES, background, appearance: "night" };
      await act(async () => { if (tree) tree.update(React.createElement(ThemeStudio, { ...props, preferences }));
        else tree = TestRenderer.create(React.createElement(ThemeStudio, { ...props, preferences })); });
      const clock = tree.root.findByProps({ id: "theme-daylight-clock" });
      assert.equal(clock.props.value, 480);
      await act(async () => clock.props.onChange({ target: { value: "780" } }));
      const now = tree.root.findAllByType("button").find(button => button.children.join("") === "回到现在");
      assert.equal(now.props.disabled, false);
      await act(async () => now.props.onClick());
    }
    assert.deepEqual(previews, [780, null, 780, null, 780, null]);
    assert.deepEqual(themes, [], "previewing and restoring time never write appearance preferences");
  } finally { if (tree) await act(async () => tree.unmount()); }
});
