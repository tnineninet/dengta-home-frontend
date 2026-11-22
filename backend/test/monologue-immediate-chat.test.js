const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { generateReplyStream, MAIN_CHAT_PROMPT_ARCHITECTURE } = require("../services/ai-service");

test("chat opt-in publishes monologue characters before terminal validation", { timeout: 10000 }, async () => {
    let releaseTail;
    const tail = new Promise(resolve => { releaseTail = resolve; });
    let receivedFirst = false;
    const server = http.createServer(async (request, response) => {
        for await (const _chunk of request) { /* consume */ }
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
        const delta = content => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
        delta("[monologue]");
        delta("想");
        await tail;
        delta("你。[/monologue]正");
        delta("文。");
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
                model: "synthetic-immediate-model",
                max_tokens: 256
            },
            messages: [{ role: "user", content: "Synthetic immediate monologue request." }],
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
            visibleMonologue: true,
            publishVisibleMonologueImmediately: true,
            onEvent(event) {
                events.push(event);
                if (event.type === "monologue" && event.phase === "delta" && String(event.content || "").includes("想")) {
                    receivedFirst = true;
                    releaseTail();
                }
            }
        });
        assert.equal(receivedFirst, true, "first monologue character must reach the client before the provider tail");
        assert.equal(result.text, "正文。");
        assert.equal(result.visible_monologue.text, "想你。");
        assert.equal(result.visible_monologue.state, "complete");
        assert.ok(events.some(event => event.type === "text" && event.content === "正"));
    } finally {
        releaseTail();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
