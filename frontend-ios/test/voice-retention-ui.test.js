import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const words = (node) => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(words).join("");

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
let tree;
try {
  const { default: ChatMessage } = await vite.ssrLoadModule("/src/ChatMessage.jsx");
  const item = {
    id: "voice-1",
    role: "user",
    content: "语音转写文本",
    voiceAnalysis: { emotion: "累", confidence: 0.8, hint: "声音比平时低" },
  };
  const baseProps = { item, onReference: () => {} };
  await act(async () => { tree = TestRenderer.create(React.createElement(ChatMessage, baseProps)); });
  const visible = words(tree.toJSON());
  assert.ok(visible.includes("累"), "emotion label should render when retention is visible");
  assert.ok(visible.includes("语音转写文本"));
  await act(async () => { tree.update(React.createElement(ChatMessage, { ...baseProps, voiceAnalysisVisible: false })); });
  const hidden = words(tree.toJSON());
  assert.ok(!hidden.includes("累"), "emotion label must not render when retention is off");
  assert.ok(!hidden.includes("声音比平时低"), "hint must not render when retention is off");
  assert.ok(hidden.includes("语音转写文本"), "transcription must stay visible");
  console.log("voice retention UI tests passed");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
}
