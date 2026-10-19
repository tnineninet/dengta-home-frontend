import assert from "node:assert/strict";
import test from "node:test";
import { parseLrc, activeLyricIndex } from "../src/music-lyrics.js";

test("lrc timestamps parse, duplicate tags merge, metadata is ignored", () => {
  const lines = parseLrc("[ar:Jay]\n[00:12.50]故事的小黄花\n[00:12.500]故事的小黄花\n[00:18.00][00:22.25]从出生那年就飘着");
  assert.deepEqual(lines.map((line) => line.text), ["故事的小黄花", "从出生那年就飘着", "从出生那年就飘着"]);
  assert.equal(lines[0].time, 12.5);
});

test("active lyric index follows progress", () => {
  const lines = [{ time: 0, text: "a" }, { time: 10, text: "b" }, { time: 20, text: "c" }];
  assert.equal(activeLyricIndex(lines, 0), 0);
  assert.equal(activeLyricIndex(lines, 15), 1);
  assert.equal(activeLyricIndex(lines, 25), 2);
  assert.equal(activeLyricIndex([], 5), -1);
});
