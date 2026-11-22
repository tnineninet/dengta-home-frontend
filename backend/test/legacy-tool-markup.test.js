const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const { generateReplyStream, MAIN_CHAT_PROMPT_ARCHITECTURE } = require("../services/ai-service");
const { stripVisibleToolMarkup, createVisibleToolMarkupFilter } = require("../services/legacy-tool-markup");

const markup = '正文。\n\n<update_companion_status mood="宠溺且无奈" place="DengTa home 的暗光卧室" focus="满足奶油深夜食欲" note="凌晨一点又要点外卖。" energy_level=88 pulse_bpm=102 hot_zones=["heart"] micro_state="无奈地摇摇头" />\n\n尾巴';

test("visible reply strips legacy status markup and keeps the parsed status", () => {
    const result = stripVisibleToolMarkup(markup);
    assert.equal(result.text, "正文。\n\n尾巴");
    assert.deepEqual(result.companionStatus, {
        mood: "宠溺且无奈",
        place: "DengTa home 的暗光卧室",
        focus: "满足奶油深夜食欲",
        note: "凌晨一点又要点外卖。",
        energy_level: 88,
        pulse_bpm: 102,
        hot_zones: ["heart"],
        micro_state: "无奈地摇摇头"
    });
});

test("streaming filter never exposes a split legacy tag", () => {
    const filter = createVisibleToolMarkupFilter();
    let visible = "";
    for (const character of markup) visible += filter.push(character);
    visible += filter.finish();
    assert.equal(visible.replace(/\n{3,}/g, "\n\n"), "正文。\n\n尾巴");
    assert.equal(filter.companionStatus().mood, "宠溺且无奈");
    assert.equal(visible.includes("update_companion_status"), false);
    assert.equal(visible.includes("<"), false);
});

test("stream adapter strips legacy status markup and exposes parsed status", async () => {
    const server = http.createServer(async (request, response) => {
        for await (const _chunk of request) { /* consume */ }
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: markup } }] })}\n\n`);
        response.end("data: [DONE]\n\n");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const events = [];
        const result = await generateReplyStream({
            settings: {
                provider: "custom",
                api_url: `http://127.0.0.1:${server.address().port}/v1`,
                runtime_api_key: "synthetic-local-key",
                model: "synthetic-markup-model",
                max_tokens: 512
            },
            messages: [{ role: "user", content: "Synthetic markup fixture." }],
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
            onEvent(event) { events.push(event); }
        });
        assert.equal(result.text, "正文。\n\n尾巴");
        assert.equal(result.legacy_companion_status.mood, "宠溺且无奈");
        assert.equal(result.legacy_companion_status.energy_level, 88);
        assert.equal(events.filter(event => event.type === "text").map(event => event.content).join("").replace(/\n{3,}/g, "\n\n").trim(), result.text);
        assert.equal(JSON.stringify(events).includes("update_companion_status"), false);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});


test("text-emitted function calls are stripped and surfaced as a tool call", () => {
    const raw = "好呀 <function=netese_play_song> <parameter=keyword> 晴天 周杰伦 </parameter> </function> </toolcall>";
    const stripped = stripVisibleToolMarkup(raw);
    assert.equal(stripped.text.includes("function"), false);
    assert.deepEqual(stripped.toolCalls, [{ name: "netease_play_song", arguments: JSON.stringify({ keyword: "晴天 周杰伦" }) }]);
});

test("streaming function calls stay hidden while being split across chunks", () => {
    const filter = createVisibleToolMarkupFilter();
    let visible = "";
    for (const chunk of ["好呀", " <func", "tion=neteseplay", "song><param", "eter=keyword>晴", "天</parameter>", "</function>", "</toolcall>"]) {
        visible += filter.push(chunk);
    }
    visible += filter.finish();
    assert.equal(visible.includes("function"), false);
    assert.equal(visible.includes("晴天"), false);
    assert.equal(visible.trim(), "好呀");
    assert.deepEqual(filter.toolCalls(), [{ name: "netease_play_song", arguments: JSON.stringify({ keyword: "晴天" }) }]);
});


test("stream adapter accepts a text-only function call and returns it for execution", async () => {
    const functionMarkup = "<function=neteseplaysong> <parameter=keyword> 晴天 </parameter> </function> </toolcall>";
    const server = http.createServer(async (request, response) => {
        for await (const _chunk of request) { /* consume */ }
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
        for (const character of functionMarkup) {
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: character } }] })}\n\n`);
        }
        response.end("data: [DONE]\n\n");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const result = await generateReplyStream({
            settings: {
                provider: "custom",
                api_url: `http://127.0.0.1:${server.address().port}/v1`,
                runtime_api_key: "synthetic-local-key",
                model: "synthetic-function-model",
                max_tokens: 128
            },
            messages: [{ role: "user", content: "Synthetic function fixture." }],
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE
        });
        assert.equal(result.text, "");
        assert.deepEqual(result.legacy_tool_calls, [{ name: "netease_play_song", arguments: JSON.stringify({ keyword: "晴天" }) }]);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
