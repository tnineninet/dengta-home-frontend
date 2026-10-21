import assert from "node:assert/strict";
import test from "node:test";
import { splitChatSegments } from "../src/chat-sentences.js";

test("long replies become one chat segment per sentence", () => {
  assert.deepEqual(splitChatSegments("第一句。第二句！第三句？"), ["第一句。", "第二句！", "第三句？"]);
  assert.deepEqual(splitChatSegments("第一段。\n\n第二段。"), ["第一段。", "第二段。"]);
});

test("stored reply bubble boundaries take precedence when valid", () => {
  assert.deepEqual(
    splitChatSegments("第一句。第二句！", {
      version: 1,
      count: 2,
      boundaries: [4, 8],
    }),
    ["第一句。", "第二句！"],
  );
  assert.deepEqual(
    splitChatSegments("第一句。第二句！", {
      version: 1,
      count: 2,
      boundaries: [4],
    }),
    ["第一句。", "第二句！"],
    "invalid metadata must fall back to text splitting",
  );
});

test("code blocks and structured lines are not split mid-format", () => {
  assert.deepEqual(splitChatSegments("```\nconst a = 1;\n```"), ["```\nconst a = 1;\n```"]);
  assert.deepEqual(splitChatSegments("- 第一项\n- 第二项"), ["- 第一项", "- 第二项"]);
});
