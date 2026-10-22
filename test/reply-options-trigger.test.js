import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutoOpenReplyOptions } from "../src/reply-options-trigger.js";

const message = (content, extra = {}) => ({
  role: "assistant",
  content,
  ...extra,
});

test("questions always open reply options", () => {
  assert.equal(shouldAutoOpenReplyOptions(message("那你想听哪首？")), true);
  assert.equal(shouldAutoOpenReplyOptions(message("你还在吗?")), true);
});

test("open-ended invitations and choices do not need a question mark", () => {
  assert.equal(
    shouldAutoOpenReplyOptions(
      message("要是你累得不想动，就窝在我怀里，我一边轻轻拍你一边念歌词。")
    ),
    true
  );
  assert.equal(
    shouldAutoOpenReplyOptions(message("你想听哪首，我帮你找。")),
    true
  );
  assert.equal(
    shouldAutoOpenReplyOptions(message("那我在床边等你，慢慢来……")),
    true
  );
});

test("model-provided suggestions are enough on their own", () => {
  assert.equal(
    shouldAutoOpenReplyOptions(
      message("今天先到这里。", {
        tool_calls: { reply_suggestions: ["再陪我会儿", "明天见"] }
      })
    ),
    true
  );
});

test("plain statements and streaming rows stay quiet", () => {
  assert.equal(
    shouldAutoOpenReplyOptions(message("我把窗户关好了，灯也留着。")),
    false
  );
  assert.equal(
    shouldAutoOpenReplyOptions(message("你想听哪首？", { isStreaming: true })),
    false
  );
  assert.equal(shouldAutoOpenReplyOptions(null), false);
});
