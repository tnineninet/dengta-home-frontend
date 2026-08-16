import assert from "node:assert/strict";

globalThis.window = {
  setTimeout,
  clearTimeout,
  location: { origin: "https://app.example.com" },
};
globalThis.fetch = () => new Promise(() => {});

const { listMusicPlaylists } = await import("../../../src/music-listening.js");
const outcome = await Promise.race([
  listMusicPlaylists().then(() => "settled", () => "settled"),
  new Promise((resolve) => setTimeout(() => resolve("pending"), 100)),
]);

console.log(`[BUGFIX_REPRO] refresh request outcome after 100ms: ${outcome}`);
assert.equal(outcome, "settled", "刷新请求必须自行超时并释放交互状态");
