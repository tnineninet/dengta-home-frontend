const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { generateReplyStream, MAIN_CHAT_PROMPT_ARCHITECTURE } = require("../services/ai-service");

const adapters = [
    { name: "custom-no-tools", provider: "custom" },
    { name: "custom-native-tools", provider: "custom", nativeTools: true },
    { name: "responses", provider: "openai-responses" },
    { name: "anthropic", provider: "anthropic" },
    { name: "gemini", provider: "gemini" }
];

function writeEvent(response, event) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeDelta(response, provider, content) {
    if (provider === "openai-responses") writeEvent(response, { type: "response.output_text.delta", delta: content });
    else if (provider === "anthropic") writeEvent(response, { type: "content_block_delta", delta: { type: "text_delta", text: content } });
    else if (provider === "gemini") writeEvent(response, { candidates: [{ content: { parts: [{ text: content }] } }] });
    else writeEvent(response, { choices: [{ delta: { content } }] });
}

function writeTerminal(response, provider) {
    if (provider === "openai-responses") writeEvent(response, { type: "response.completed", response: { status: "completed" } });
    if (provider === "anthropic") {
        writeEvent(response, { type: "message_delta", delta: { stop_reason: "end_turn" } });
        writeEvent(response, { type: "message_stop" });
    }
    if (provider === "gemini") writeEvent(response, { candidates: [{ finishReason: "STOP" }] });
    response.end("data: [DONE]\n\n");
}

function content(events, type) {
    return events.filter(event => event.type === type && (type !== "monologue" || event.phase === "delta"))
        .map(event => event.content || "").join("");
}

for (const adapter of adapters) {
    for (const complete of [true, false]) {
        test(`${adapter.name}: body unlocks the provider tail; ${complete ? "checked monologue is published after body" : "missing terminal keeps monologue unpublished"}`, async () => {
            const events = [];
            const beforeTail = [];
            const requests = [];
            const fixtureErrors = [];
            let release;
            let timer;
            let timedOut = false;
            let tailSent = false;
            const observedBody = new Promise(resolve => { release = resolve; });
            const server = http.createServer(async (request, response) => {
                try {
                    const chunks = [];
                    for await (const chunk of request) chunks.push(chunk);
                    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
                    response.flushHeaders();
                    for (const part of ["[mono", "logue]Matrix feeling🌈", "[/mono", "logue]Matrix reply🙂"]) {
                        writeDelta(response, adapter.provider, part);
                    }
                    // This timeout only releases a deadlocked fixture, never scores network speed.
                    timer = setTimeout(() => { timedOut = true; release(); }, 4000);
                    await observedBody;
                    clearTimeout(timer);
                    tailSent = true;
                    if (complete) {
                        writeDelta(response, adapter.provider, " Tail.");
                        writeTerminal(response, adapter.provider);
                    } else response.end();
                } catch (error) {
                    fixtureErrors.push(error);
                    response.destroy();
                }
            });
            await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
            try {
                const settings = {
                    provider: adapter.provider,
                    api_url: `http://127.0.0.1:${server.address().port}/v1`,
                    runtime_api_key: "synthetic-local-matrix-key", model: "synthetic-matrix-model",
                    prompt_mode: "unified", unified_system_prompt: "Synthetic matrix persona, unchanged.",
                    user_details: "Synthetic matrix details, unchanged.", max_tokens: 500
                };
                const originalSettings = JSON.stringify(settings);
                const run = generateReplyStream({
                    settings, messages: [{ role: "user", content: "Synthetic adapter body-first request." }],
                    promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE, visibleMonologue: true,
                    worldBookContext: { beforeMemoryInstruction: "Synthetic matrix world-book entry.", dynamicContext: "Synthetic matrix turn entry." },
                    ...(adapter.nativeTools ? {
                        tools: [{ name: "matrix_fixture_tool", description: "Synthetic unused tool.", input_schema: { type: "object", properties: {} } }],
                        executeTool() { assert.fail("no matrix fixture tool was called"); }
                    } : {}),
                    onEvent(event) {
                        events.push(event);
                        if (!tailSent) beforeTail.push(event);
                        if (content(events, "text") === "Matrix reply🙂") release();
                    }
                });
                if (complete) {
                    const result = await run;
                    assert.equal(result.text, "Matrix reply🙂 Tail.");
                    assert.equal(content(events, "text"), result.text);
                    assert.equal(result.visible_monologue.text, "Matrix feeling🌈");
                    assert.equal(result.visible_monologue.state, "complete");
                    assert.equal(content(events, "monologue"), result.visible_monologue.text);
                    const bodyIndex = events.findIndex(event => event.type === "text");
                    const heartIndex = events.findIndex(event => event.type === "monologue" && event.phase === "delta");
                    assert.ok(bodyIndex >= 0 && heartIndex > bodyIndex);
                } else {
                    await assert.rejects(run, error => error.code === "provider_stream_incomplete");
                    assert.equal(content(events, "text"), "Matrix reply🙂");
                    assert.equal(content(events, "monologue"), "");
                    const end = events.find(event => event.type === "monologue" && event.phase === "end");
                    assert.equal(end.state, "failed");
                    assert.equal(end.characters, 0);
                }
                assert.equal(timedOut, false, "the first body event must unlock the withheld terminal packet");
                assert.ok(beforeTail.some(event => event.type === "text"));
                assert.equal(beforeTail.some(event => event.type === "monologue" && event.phase === "delta"), false,
                    "every adapter defers authored monologue until successful terminal validation");
                assert.equal(requests.length, 1, "a received provider stream must not replay");
                assert.equal(JSON.stringify(settings), originalSettings, "personalization and model settings remain byte-for-byte unchanged");
                const requestText = JSON.stringify(requests[0]);
                for (const required of [settings.unified_system_prompt, settings.user_details,
                    "First write one [monologue]", "Synthetic matrix world-book entry.", "Synthetic matrix turn entry."]) {
                    assert.ok(requestText.includes(required), "the display change must not remove generation instructions or selected context");
                }
                assert.ok(events.every(event => !event.content || event.content.isWellFormed()));
                assert.deepEqual(fixtureErrors, []);
            } finally {
                clearTimeout(timer);
                release();
                server.closeAllConnections();
                await new Promise(resolve => server.close(resolve));
            }
        });
    }

    test(`${adapter.name}: explicit strict guard publishes body before a checked monologue in the same buffered block`, async () => {
        const previousGuard = process.env.PROVIDER_OUTPUT_GUARD_DISABLED;
        process.env.PROVIDER_OUTPUT_GUARD_DISABLED = "false";
        const events = [];
        let terminalSent = false;
        const server = http.createServer(async (request, response) => {
            for await (const _chunk of request) { /* consume the synthetic request */ }
            response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            writeDelta(response, adapter.provider, "[monologue]Checked buffered feeling.[/monologue]Buffered body.");
            terminalSent = true;
            writeTerminal(response, adapter.provider);
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        try {
            const result = await generateReplyStream({
                settings: {
                    provider: adapter.provider,
                    api_url: `http://127.0.0.1:${server.address().port}/v1`,
                    runtime_api_key: "synthetic-strict-matrix-key",
                    model: "synthetic-matrix-model", max_tokens: 500
                },
                messages: [{ role: "user", content: "Synthetic strict guard ordering request." }],
                visibleMonologue: true,
                ...(adapter.nativeTools ? {
                    tools: [{ name: "matrix_fixture_tool", description: "Unused synthetic tool.", input_schema: { type: "object", properties: {} } }],
                    executeTool() { assert.fail("no strict matrix tool was called"); }
                } : {}),
                onEvent(event) {
                    if (event.type === "text" || (event.type === "monologue" && event.phase === "delta")) {
                        assert.equal(terminalSent, true);
                    }
                    events.push(event);
                }
            });
            assert.equal(result.text, "Buffered body.");
            assert.equal(content(events, "text"), result.text);
            assert.equal(result.visible_monologue.text, "Checked buffered feeling.");
            assert.equal(content(events, "monologue"), result.visible_monologue.text);
            const bodyIndex = events.findIndex(event => event.type === "text");
            const heartIndex = events.findIndex(event => event.type === "monologue" && event.phase === "delta");
            assert.ok(bodyIndex >= 0 && heartIndex > bodyIndex);
        } finally {
            if (previousGuard === undefined) delete process.env.PROVIDER_OUTPUT_GUARD_DISABLED;
            else process.env.PROVIDER_OUTPUT_GUARD_DISABLED = previousGuard;
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });
}
