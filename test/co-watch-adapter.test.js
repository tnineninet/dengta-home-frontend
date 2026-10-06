import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const calls = [];
let receipt;
globalThis.__coWatchAdapterFixture = {
  request(path, options) { calls.push({ path, options }); return Promise.resolve(receipt); },
};
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{
    name: "co-watch-adapter-fixture", enforce: "pre",
    load(id) {
      const path = id.replaceAll("\\", "/");
      if (path.endsWith("/src/api.js")) return 'export const apiRequest=(...args)=>globalThis.__coWatchAdapterFixture.request(...args);';
      if (path.endsWith("/src/auth-session.js")) return "export const authSession={};";
    },
  }],
});
const { sendCoWatchReply } = await vite.ssrLoadModule("/src/co-watch.js");
after(async () => { await vite.close(); delete globalThis.__coWatchAdapterFixture; });

test("actual co-watch reply adapter preserves every timed danmaku receipt without rewriting text", async () => {
  const danmaku = [
    { text: "  虚构字幕👩🏽‍🚀\r\n ", media_time_seconds: 12.25, color: "fixture" },
    { text: "第二行", media_time_seconds: 0 },
  ];
  const assistant = { id: "fictional-assistant", content: "Fictional response" };
  receipt = { reaction: "Fictional response", danmaku, assistant_message: assistant };
  const result = await sendCoWatchReply("fictional/session", "Fictional input", 12);
  assert.deepEqual(result.danmaku, danmaku);
  assert.equal(result.assistantMessage, assistant);
  assert.equal(result.reaction, receipt.reaction);
  assert.equal(calls.at(-1).path, "/api/v2/co-watch/sessions/fictional%2Fsession/reply");
  const body = JSON.parse(calls.at(-1).options.body);
  assert.equal(body.text, "Fictional input");
  assert.equal(body.media_position_seconds, 12);
  assert.equal(body.request_id, result.requestId);
});

test("actual co-watch reply adapter supplies an empty list for absent or malformed danmaku", async () => {
  for (const danmaku of [undefined, null, "fixture", { text: "fixture" }]) {
    receipt = { reaction: "Fictional response", danmaku };
    const result = await sendCoWatchReply("fictional-session", "Fictional input");
    assert.deepEqual(result.danmaku, []);
  }
});
