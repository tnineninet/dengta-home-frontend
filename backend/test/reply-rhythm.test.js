const assert = require("node:assert/strict");
const { buildReplyRhythmContext } = require("../services/reply-rhythm");

{
    const context = buildReplyRhythmContext({ userMessage: "在吗" });
    assert.match(context, /回复节奏/);
    assert.match(context, /1–3 句/);
    assert.match(context, /优先用 1–2 句自然回应/);
    assert.match(context, /个性化指令.*以它们为准/);
    assert.doesNotMatch(context, /拒绝|安全边界|成人内容/);
}

{
    const context = buildReplyRhythmContext({ userMessage: "继续写下去" });
    assert.match(context, /明确要求继续或展开/);
    assert.match(context, /写长/);
    assert.doesNotMatch(context, /优先用 1–2 句自然回应/);
}

{
    const longMessage = "我想认真讲讲今天发生的事情，从早上出门开始，一路上遇到了很多细节，想听你慢慢陪我聊完。";
    const context = buildReplyRhythmContext({ userMessage: longMessage });
    assert.doesNotMatch(context, /优先用 1–2 句自然回应/);
    assert.doesNotMatch(context, /明确要求继续或展开/);
    assert.match(context, /不要每一轮都写成结构完整的长段落/);
}

{
    const empty = buildReplyRhythmContext({});
    assert.match(empty, /自然变化/);
    assert.doesNotMatch(empty, /本轮对方只发来很短的一句/);
}

console.log("reply rhythm tests passed");
