import test from "node:test";
import assert from "node:assert/strict";
import {
  clearSearchHistory,
  filterSearchHistory,
  readSearchHistory,
  rememberSearchTerm,
  searchHistoryStorageKey,
  SEARCH_HISTORY_LIMIT,
} from "../src/search-history.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    dump: () => Object.fromEntries(values),
  };
}

test("search history is isolated per account/companion scope", () => {
  const storage = memoryStorage();
  rememberSearchTerm(storage, "account:companionA", "features", "听歌");
  rememberSearchTerm(storage, "account:companionB", "features", "记忆");
  assert.deepEqual(readSearchHistory(storage, "account:companionA").features, ["听歌"]);
  assert.deepEqual(readSearchHistory(storage, "account:companionB").features, ["记忆"]);
  assert.equal(searchHistoryStorageKey("account:companionA"), "dengta.search-history.v1:account:companionA");
});

test("dedupe moves term to front and enforces limit", () => {
  const storage = memoryStorage();
  for (let index = 1; index <= SEARCH_HISTORY_LIMIT + 2; index += 1) {
    rememberSearchTerm(storage, "scope", "settings", `设置${index}`);
  }
  rememberSearchTerm(storage, "scope", "settings", "设置4");
  const history = readSearchHistory(storage, "scope").settings;
  assert.equal(history.length, SEARCH_HISTORY_LIMIT);
  assert.equal(history[0], "设置4");
});

test("sensitive fragments are never stored", () => {
  const storage = memoryStorage();
  for (const term of ["https://example.com", "@someone", "123456789", "sk-abcdefghijk"]) {
    rememberSearchTerm(storage, "scope", "features", term);
  }
  assert.deepEqual(readSearchHistory(storage, "scope").features, []);
});

test("history filters character by character and survives bad JSON", () => {
  const storage = memoryStorage();
  rememberSearchTerm(storage, "scope", "features", "小棉花");
  rememberSearchTerm(storage, "scope", "features", "藏宝地图");
  assert.deepEqual(filterSearchHistory(readSearchHistory(storage, "scope").features, "棉"), ["小棉花"]);
  assert.deepEqual(filterSearchHistory(readSearchHistory(storage, "scope").features, "地"), ["藏宝地图"]);
  storage.setItem(searchHistoryStorageKey("scope"), "{bad json");
  assert.deepEqual(readSearchHistory(storage, "scope").features, []);
});

test("clear only removes the requested area", () => {
  const storage = memoryStorage();
  rememberSearchTerm(storage, "scope", "features", "听歌");
  rememberSearchTerm(storage, "scope", "settings", "语音");
  clearSearchHistory(storage, "scope", "features");
  assert.deepEqual(readSearchHistory(storage, "scope").features, []);
  assert.deepEqual(readSearchHistory(storage, "scope").settings, ["语音"]);
});
