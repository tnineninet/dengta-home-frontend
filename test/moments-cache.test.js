import assert from "node:assert/strict";
import test from "node:test";
import { readMomentsCache, writeMomentsCache } from "../src/moments-cache.js";

test("moments cache is scoped and drops malformed receipts", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  writeMomentsCache("scope-a", { available: true, entries: [{ id: "m1", images: [], comments: [] }] });
  assert.equal(readMomentsCache("scope-a")?.entries?.[0]?.id, "m1");
  assert.equal(readMomentsCache("scope-b"), null);
  windowlessWrite();
  assert.equal(readMomentsCache("scope-a")?.entries?.length, 0);
});

function windowlessWrite() {
  writeMomentsCache("scope-a", { available: true, entries: [{ id: "bad" }] });
}
