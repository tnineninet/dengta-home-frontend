import assert from "node:assert/strict";
import { createReplySuggestions } from "../src/chat-reply-suggestions.js";

assert.deepEqual(
  createReplySuggestions({
    assistantText: "我好像喝多了，回来以后可以抱抱我吗？",
    mood: "微醺",
  }),
  ["过来，抱抱小乖乖", "才不要呢，臭男人"],
);

assert.deepEqual(
  createReplySuggestions({
    assistantText: "今天真的有一点累。",
    mood: "疲惫",
  }),
  ["靠过来休息一会儿吧", "不许硬撑，先乖乖去睡"],
);

assert.deepEqual(
  createReplySuggestions({
    assistantText: "我会记得你刚刚说的话。",
    mood: "平静",
  }),
  ["好，我在认真听", "哼，那你再哄哄我"],
);

assert.deepEqual(createReplySuggestions({ assistantText: "" }), []);

console.log("chat reply suggestion tests passed");
