import assert from "node:assert/strict";
import {
  INNER_MONOLOGUE_STORAGE_KEY,
  innerMonologueForMessage,
  readInnerMonologues,
  storeInnerMonologue,
} from "../src/inner-monologue.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

const storage = createStorage();
const saved = storeInnerMonologue(
  {
    messageId: "assistant-1",
    text: `\u0000${"我想安静地把这个念头写下来。".repeat(80)}`,
    createdAt: "2026-08-02T10:00:00.000Z",
  },
  storage,
);

assert.equal(saved["assistant-1"].text.includes("\u0000"), false);
assert.equal(saved["assistant-1"].text.length > 800, true);
assert.equal(
  innerMonologueForMessage(readInnerMonologues(storage), "assistant-1").text,
  saved["assistant-1"].text,
);
assert.ok(storage.getItem(INNER_MONOLOGUE_STORAGE_KEY));

const malformedStorage = createStorage({
  [INNER_MONOLOGUE_STORAGE_KEY]: "not-json",
});
assert.deepEqual(readInnerMonologues(malformedStorage), {});

console.log("inner monologue local-cache checks passed");
