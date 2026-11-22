const CONTINUATION_PATTERN =
    /继续|接着|再来|别停|然后呢|后来呢|展开|详细|多说|讲下去|写长|长一点|具体说说|继续写/;

function visibleLength(value) {
    return Array.from(String(value || "").trim()).length;
}

function buildReplyRhythmContext({ userMessage = "", settings = {} } = {}) {
    const message = String(userMessage || "").trim();
    const length = visibleLength(message);
    const asksForMore = CONTINUATION_PATTERN.test(message);
    const lines = [
        "【回复节奏：像真人微信聊天一样自然变化】",
        "这条只影响回复的长度和节奏，不改变角色、关系、用户个性化指令、用户详情、记忆或任何内容边界。",
        "日常问候、情绪回应、简单确认通常 1–3 句，可以只有一句甚至几个字；不要每一轮都写成结构完整的长段落。",
        "需要讲故事、解释、安慰、描写场景、回答复杂问题，或对方明确要求“详细/展开/继续”时，再自然写长。",
        "不要为了显得简短而敷衍，也不要为了凑长度重复上一轮已经说过的内容。",
        "如果用户保存的个性化指令、用户详情、角色设定或本轮明确要求已经规定了长度或文风，以它们为准；本条只在它们没有规定时生效。"
    ];

    if (length > 0 && length <= 8 && !asksForMore) {
        lines.push(
            `本轮对方只发来很短的一句（${length} 字）。像微信聊天一样优先用 1–2 句自然回应；如果只是打招呼，可以只回一句，不必展开成说明书。`
        );
    } else if (asksForMore) {
        lines.push(
            "本轮对方明确要求继续或展开。按需要写长，保留对方要的细节，不要为了“简短”省略或提前收尾。"
        );
    }

    return lines.join("\n");
}

module.exports = { buildReplyRhythmContext, CONTINUATION_PATTERN };
