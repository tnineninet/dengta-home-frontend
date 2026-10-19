import assert from "node:assert/strict";
import test from "node:test";
import { splitChatSegments } from "../src/chat-sentences.js";

test("long replies become one chat segment per sentence", () => {
  assert.deepEqual(splitChatSegments("第一句。第二句！第三句？"), ["第一句。", "第二句！", "第三句？"]);
  assert.deepEqual(splitChatSegments("第一段。\n\n第二段。"), ["第一段。", "第二段。"]);
});

test("code blocks and structured lines are not split mid-format", () => {
  assert.deepEqual(splitChatSegments("```\nconst a = 1;\n```"), ["```\nconst a = 1;\n```"]);
  assert.deepEqual(splitChatSegments("- 第一项\n- 第二项"), ["- 第一项", "- 第二项"]);
});
