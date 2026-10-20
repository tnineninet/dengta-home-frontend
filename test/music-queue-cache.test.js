import assert from "node:assert/strict";
import test from "node:test";
import { readMusicDockQueue, writeMusicDockQueue } from "../src/music-queue-cache.js";

test("music dock queue is scoped, deduped and index clamped", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  const card = (id) => ({ id, title: "Song " + id, audio_url: "https://example.com/" + id + ".mp3" });
  writeMusicDockQueue("scope-a", { queue: [card("1"), card("2"), card("1")], index: 9 });
  const saved = readMusicDockQueue("scope-a");
  assert.deepEqual(saved.queue.map((item) => item.id), ["1", "2"]);
  assert.equal(saved.index, 1);
  assert.deepEqual(readMusicDockQueue("scope-b"), { queue: [], index: -1 });
  writeMusicDockQueue("scope-a", { queue: [], index: -1 });
  assert.deepEqual(readMusicDockQueue("scope-a"), { queue: [], index: -1 });
});
