import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("very long chat histories render a bounded window and expand on demand", async () => {
  const vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  let renderer;
  try {
    const { default: Transcript } = await vite.ssrLoadModule("/src/ChatTranscript.jsx");
    const messages = Array.from({ length: 500 }, (_, index) => ({
      id: `synthetic-${index + 1}`,
      role: index % 2 ? "assistant" : "user",
      content: `虚构长历史正文 ${index + 1}`,
      created_at: "2026-10-01T01:00:00Z",
    }));
    const props = {
      messages,
      preferences: { skin: "classic-glass", reduceMotion: true },
      innerMonologues: {},
      innerMonologuePending: {},
      innerMonologueErrors: {},
      aiName: "虚构伴侣",
      userName: "测试用户",
      onReference: () => {},
    };
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Transcript, props));
    });
    const rows = () => new Set(
      renderer.root.findAll((node) => node.props?.item?.id).map((node) => node.props.item.id),
    );
    assert.equal(rows().size, 200, "only the newest 200 rows are mounted initially");
    const earlier = () => renderer.root.findAll(
      (node) => node.type === "button" && String(node.props.children || "").includes("显示更早"),
    );
    assert.equal(earlier().length, 1);
    assert.ok(String(earlier()[0].props.children).includes("300"));
    await act(async () => earlier()[0].props.onClick());
    assert.equal(rows().size, 350, "the earlier-history button expands in 150-row chunks");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await vite.close();
  }
});
