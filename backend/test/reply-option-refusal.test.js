const assert = require("node:assert/strict");
const {
    isReplyOptionRefusal,
    normalizeReplySuggestions
} = require("../services/reply-suggestions");

const refusals = [
    "抱歉，我无法为这类内容提供回复选项。",
    "这涉及平台不允许的成人角色扮演内容，我不能继续。",
    "如果想聊别的——游戏、缝纫店、大理的生活、薯条和狗子们——我随时陪你。",
    "I'm sorry, but I can't continue this."
];

for (const value of refusals) {
    assert.equal(isReplyOptionRefusal(value), true, value);
}

for (const value of [
    "抱歉，我刚才没听清，你再说一遍。",
    "那你先抱住我，别的等会儿再说。",
    "我想继续，你慢慢来。"
]) {
    assert.equal(isReplyOptionRefusal(value), false, value);
}

assert.deepEqual(
    normalizeReplySuggestions([
        refusals[0],
        "那你先抱住我。"
    ]),
    []
);

console.log("reply option refusal filter tests passed");
