import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("chat music card renders an inline player for a direct URL and a clear fallback without one", async () => {
  const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let renderer;
  try {
    const { default: MusicChatCard } = await vite.ssrLoadModule("/src/MusicChatCard.jsx");
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(MusicChatCard, { music: {
        id: "123", title: "虚构歌曲", artist: "虚构歌手", album: "虚构专辑",
        cover_url: "", duration_seconds: 180,
        audio_url: "https://example.com/fictional.mp3", external_url: "https://music.163.com/#/song?id=123"
      } }));
    });
    assert.equal(renderer.root.findAllByType("audio").length, 1);
    assert.equal(renderer.root.findAllByType("audio")[0].props.src, "https://example.com/fictional.mp3");
    assert.equal(renderer.root.findByProps({ className: "chat-music-toggle" }).props.disabled, false);
    await act(async () => renderer.unmount());
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(MusicChatCard, { music: {
        id: "124", title: "受版权限制的歌", artist: "虚构歌手", duration_seconds: 0,
        audio_url: "", external_url: "https://music.163.com/#/song?id=124"
      } }));
    });
    assert.equal(renderer.root.findAllByType("audio").length, 0);
    assert.equal(renderer.root.findByProps({ className: "chat-music-toggle" }).props.disabled, true);
    assert.match(renderer.root.findByProps({ className: "chat-music-unavailable" }).children.join(""), /版权/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await vite.close();
  }
});
