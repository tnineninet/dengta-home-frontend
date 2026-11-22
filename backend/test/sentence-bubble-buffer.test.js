const assert = require("node:assert/strict");
const {
    SentenceBubbleBuffer
} = require("../services/sentence-bubble-buffer");

function texts(events) {
    return events.map((event) => event.content);
}

// 正常中英文标点切分。
{
    const buffer = new SentenceBubbleBuffer();
    const events = [
        ...buffer.push("第一句"),
        ...buffer.push("。第二句！"),
        ...buffer.push("Third?")
    ];
    assert.deepEqual(texts(events), ["第一句。", "第二句！", "Third?"]);
    assert.deepEqual(events.map((event) => event.bubble_index), [0, 1, 2]);
    const final = buffer.flushFinal();
    assert.deepEqual(texts(final), []);
}

// 标点跨 delta。
{
    const buffer = new SentenceBubbleBuffer();
    assert.deepEqual(texts(buffer.push("你好")), []);
    assert.deepEqual(texts(buffer.push("。")), ["你好。"]);
}

// 开头空白不能形成空气泡。
{
    const buffer = new SentenceBubbleBuffer();
    const events = buffer.push("\n\n收到。");
    assert.deepEqual(texts(events), ["收到。"]);
    assert.deepEqual(texts(buffer.flushFinal()), []);
}

// 换行边界。
{
    const buffer = new SentenceBubbleBuffer();
    const events = buffer.push("第一段。\n\n第二段");
    assert.deepEqual(texts(events), ["第一段。\n\n"]);
    assert.deepEqual(texts(buffer.flushFinal()), ["第二段"]);
}

// 代码围栏：内部不切。
{
    const buffer = new SentenceBubbleBuffer();
    const events = [
        ...buffer.push("说明：\n```js\nconst a = 1;\n"),
        ...buffer.push("console.log(a);\n```\n后续 ")
    ];
    assert.deepEqual(texts(events), [], "代码围栏内不能提前切句");
    const final = buffer.flushFinal();
    assert.equal(final.length, 1);
    assert.match(final[0].content, /```js/);
    assert.match(final[0].content, /console\.log/);
    assert.equal(final[0].final, true);
}

// 列表/引用块从块首开始保护。
{
    const buffer = new SentenceBubbleBuffer();
    assert.deepEqual(texts(buffer.push("第一项。")), ["第一项。"]);
    assert.deepEqual(texts(buffer.push("- 第二项。\n- 第三项。")), []);
    const final = buffer.flushFinal();
    assert.equal(final.length, 1);
    assert.match(final[0].content, /- 第二项/);
}

// 首句 1.5 秒超时 flush；第二句后恢复正常切分。
{
    let clock = 1000;
    const buffer = new SentenceBubbleBuffer({ now: () => clock });
    assert.deepEqual(texts(buffer.push("还没有标点")), []);
    clock += 1499;
    assert.deepEqual(texts(buffer.push("的长句")), []);
    clock += 1;
    const due = buffer.flushDue(clock);
    assert.equal(due.length, 1);
    assert.equal(due[0].content, "还没有标点的长句");
    assert.equal(due[0].bubble_index, 0);
    assert.equal(due[0].final, false);
    assert.deepEqual(texts(buffer.push("下一句。")), ["下一句。"]);
}

// 长 buffer 强制 flush。
{
    const buffer = new SentenceBubbleBuffer({ maxBufferChars: 200 });
    assert.deepEqual(texts(buffer.push("a".repeat(199))), []);
    const due = buffer.flushDue();
    assert.equal(due.length, 0, "还没到 1.5 秒，也不到 200 字符");
    const forced = buffer.push("b");
    assert.equal(forced.length, 1);
    assert.equal(forced[0].content.length, 200);
    assert.deepEqual(buffer.flushFinal(), []);
}

// 最终无标点也不能丢字。
{
    const buffer = new SentenceBubbleBuffer();
    assert.deepEqual(texts(buffer.push("没有句号的最后一句")), []);
    const final = buffer.flushFinal();
    assert.equal(final.length, 1);
    assert.equal(final[0].content, "没有句号的最后一句");
    assert.equal(final[0].final, true);
    const state = buffer.getState();
    assert.equal(state.version, 1);
    assert.equal(state.count, 1);
    assert.deepEqual(state.boundaries, [9]);
}

// 最小气泡长度：长回复不再一句一个气泡。
{
    const buffer = new SentenceBubbleBuffer({ minBubbleChars: 20 });
    assert.deepEqual(texts(buffer.push("Short! ")), []);
    assert.deepEqual(
        texts(buffer.push("Another short sentence! ")),
        ["Short! Another short sentence!"]
    );
    assert.deepEqual(buffer.flushFinal(), []);
}

{
    const buffer = new SentenceBubbleBuffer({ minBubbleChars: 20 });
    const events = buffer.push("This is a sufficiently long first sentence! Second! ");
    assert.equal(events.length, 1);
    assert.equal(events[0].content, "This is a sufficiently long first sentence!");
    assert.equal(events[0].bubble_index, 0);
    assert.deepEqual(texts(buffer.flushFinal()), [" Second! "]);
}

// 立即模式：每个 delta 立刻发出，但气泡编号在足够长/段落边界后才推进。
{
    const buffer = new SentenceBubbleBuffer({
        immediate: true,
        minBubbleChars: 1
    });
    const first = buffer.push("First! ");
    assert.equal(first[0].content, "First! ");
    assert.equal(first[0].bubble_index, 0);
    const second = buffer.push("\n\nSecond paragraph");
    assert.equal(second[0].content, "Second paragraph");
    assert.equal(second[0].bubble_index, 1);
    const third = buffer.push(" More words");
    assert.equal(third[0].content, " More words");
    assert.equal(third[0].bubble_index, 1);
    assert.deepEqual(buffer.flushFinal(), []);
    assert.equal(buffer.getState().count, 2);
}

console.log("sentence bubble buffer tests passed");
