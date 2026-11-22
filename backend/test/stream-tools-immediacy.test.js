const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const {
    generateReplyStream,
    MAIN_CHAT_PROMPT_ARCHITECTURE
} = require("../services/ai-service");
const { createVisibleMonologueOutput } = require("../services/visible-monologue-stream");

const LOCAL_TOOL = Object.freeze({
    name: "fixture_note",
    description: "Store one synthetic fixture note.",
    input_schema: {
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
        additionalProperties: false
    }
});

function writeEvent(response, event) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeText(response, content) {
    writeEvent(response, { choices: [{ delta: { content } }] });
}

function textFrom(events, type) {
    return events.filter(event => event.type === type &&
        (type !== "monologue" || event.phase === "delta"))
        .map(event => event.content || "").join("");
}

function reconstructMonologue(events) {
    const segments = new Map();
    for (const event of events.filter(value => value.type === "monologue" && value.phase === "delta")) {
        const previous = segments.get(event.segment) || "";
        assert.equal(event.offset, Array.from(previous).length, "segment offsets count Unicode characters without duplicate deltas");
        assert.ok(event.content.isWellFormed());
        segments.set(event.segment, previous + event.content);
    }
    return [...segments.entries()].sort(([left], [right]) => left - right)
        .map(([, content]) => content.trim()).filter(Boolean).join("\n\n");
}

function eventGate(predicate) {
    let release;
    let timer;
    let settled = false;
    const state = { timedOut: false, tailSent: false, beforeTail: [] };
    const pending = new Promise(resolve => { release = resolve; });
    const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        release();
    };
    return {
        state,
        observe(event) {
            if (state.tailSent) return;
            state.beforeTail.push(event);
            if (predicate(state.beforeTail)) finish();
        },
        async wait() {
            if (!settled) {
                // A liveness deadline releases a deadlocked fixture; it is not a speed target.
                timer = setTimeout(() => {
                    state.timedOut = true;
                    finish();
                }, 4000);
            }
            await pending;
            state.tailSent = true;
        },
        release: finish
    };
}

async function withLocalProvider(handler, run) {
    const requests = [];
    const failures = [];
    const server = http.createServer(async (request, response) => {
        try {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            requests.push(body);
            await handler(response, body, requests.length);
        } catch (error) {
            failures.push(error);
            response.destroy();
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const result = await run({
            provider: "custom",
            api_url: `http://127.0.0.1:${server.address().port}/v1`,
            runtime_api_key: "synthetic-local-fixture-key",
            model: "synthetic-stream-model",
            prompt_mode: "unified",
            unified_system_prompt: "Synthetic fixture persona, unchanged.",
            max_tokens: 500
        }, requests);
        assert.deepEqual(failures, [], "the local provider fixture must finish without handler errors");
        return result;
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

test("unused tools publish body before the tail and release private-checked monologue afterwards", async () => {
    const events = [];
    const gate = eventGate(seen => textFrom(seen, "text") === "First reply🙂");
    try {
        await withLocalProvider(async (response, _body, round) => {
            assert.equal(round, 1, "an unused tool must not add a provider round");
            response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            response.flushHeaders();
            writeText(response, "[mono");
            writeText(response, "logue]Synthetic feeling🙂");
            writeText(response, "[/monologue]First ");
            const frame = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: "reply🙂" } }] })}\n\n`);
            const emoji = frame.indexOf(Buffer.from("🙂"));
            response.write(frame.subarray(0, emoji + 2));
            response.write(frame.subarray(emoji + 2));
            await gate.wait();
            writeText(response, " Tail.");
            response.end("data: [DONE]\n\n");
        }, async (settings, requests) => {
            const result = await generateReplyStream({
                settings,
                messages: [{ role: "user", content: "Synthetic greeting." }],
                promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                visibleMonologue: true,
                tools: [LOCAL_TOOL],
                executeTool() { assert.fail("unused fixture tools must not execute"); },
                onEvent(event) { events.push(event); gate.observe(event); }
            });
            assert.equal(gate.state.timedOut, false,
                "body must arrive while the provider is still withholding its tail, even when it generated monologue first");
            assert.equal(gate.state.beforeTail.some(event => event.type === "monologue" && event.phase === "delta"), false,
                "monologue remains withheld until late tool arguments can be checked");
            assert.equal(requests.length, 1);
            assert.equal(requests[0].tools[0].function.name, LOCAL_TOOL.name);
            assert.equal(result.text, "First reply🙂 Tail.");
            assert.equal(result.visible_monologue.text, "Synthetic feeling🙂");
            assert.equal(result.visible_monologue.state, "complete");
            assert.equal(textFrom(events, "text"), result.text, "no delta may be duplicated on round flush");
            assert.equal(textFrom(events, "monologue"), result.visible_monologue.text);
            const firstMonologue = events.findIndex(event => event.type === "monologue" && event.phase === "delta");
            const firstText = events.findIndex(event => event.type === "text");
            assert.ok(firstText >= 0 && firstMonologue > firstText, "body display precedes deferred monologue publication");
            for (const event of events) {
                if (typeof event.content === "string") assert.ok(event.content.isWellFormed(), "UTF-8 boundaries must not expose broken emoji");
            }
        });
    } finally {
        gate.release();
    }
});

test("offered unused tools do not hold plain body text until provider completion", async () => {
    const events = [];
    const gate = eventGate(seen => textFrom(seen, "text") === "Immediate reply🙂");
    try {
        await withLocalProvider(async response => {
            response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            response.flushHeaders();
            writeText(response, "Immediate reply🙂");
            await gate.wait();
            writeText(response, " Tail.");
            response.end("data: [DONE]\n\n");
        }, async (settings, requests) => {
            const result = await generateReplyStream({
                settings,
                messages: [{ role: "user", content: "Synthetic plain reply request." }],
                tools: [LOCAL_TOOL],
                executeTool() { assert.fail("no tool call was returned"); },
                onEvent(event) { events.push(event); gate.observe(event); }
            });
            assert.equal(gate.state.timedOut, false,
                "a declared but unused tool must not hold the first plain body delta");
            assert.equal(requests.length, 1);
            assert.equal(result.text, "Immediate reply🙂 Tail.");
            assert.equal(textFrom(events, "text"), result.text);
            assert.ok(events.every(event => !event.content || event.content.isWellFormed()));
        });
    } finally {
        gate.release();
    }
});

test("actual tool and follow-up rounds publish body before their own tails without duplicate execution", async () => {
    const events = [];
    const executions = [];
    const beforeTool = eventGate(seen => textFrom(seen, "text") === "Checking fixture. ");
    const followUp = eventGate(seen => textFrom(seen, "text").endsWith("Final reply🙂"));
    try {
        await withLocalProvider(async (response, body, round) => {
            response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            response.flushHeaders();
            if (round === 1) {
                writeText(response, "<thi");
                writeText(response, "nk>RAW_PRIVATE_FIRST_ROUND</th");
                writeText(response, "ink>Checking fixture. ");
                await beforeTool.wait();
                writeEvent(response, { choices: [{ delta: { tool_calls: [{
                    index: 0,
                    id: "fixture-note-call",
                    type: "function",
                    function: { name: LOCAL_TOOL.name, arguments: '{"note":"synthetic-' }
                }] } }] });
                writeEvent(response, { choices: [{ delta: { tool_calls: [{
                    index: 0,
                    function: { arguments: 'note"}' }
                }] } }] });
                response.end("data: [DONE]\n\n");
                return;
            }
            assert.equal(round, 2, "one tool call requires only one follow-up");
            assert.equal(body.messages.filter(message => message.role === "tool").length, 1);
            writeText(response, "<think>RAW_PRIVATE_SECOND_ROUND</think>Final reply🙂");
            await followUp.wait();
            writeText(response, " Done.");
            response.end("data: [DONE]\n\n");
        }, async (settings, requests) => {
            const result = await generateReplyStream({
                settings,
                messages: [{ role: "user", content: "Use one synthetic note tool." }],
                tools: [LOCAL_TOOL],
                async executeTool(call) {
                    assert.equal(beforeTool.state.tailSent, true,
                        "a partial tool argument must not execute before its provider round is complete");
                    executions.push(call);
                    return { ok: true, result: "synthetic-result" };
                },
                onEvent(event) {
                    events.push(event);
                    beforeTool.observe(event);
                    followUp.observe(event);
                }
            });
            assert.equal(beforeTool.state.timedOut, false, "body must not wait for a later tool call");
            assert.equal(followUp.state.timedOut, false, "follow-up body must not wait for its tail");
            assert.equal(requests.length, 2);
            assert.equal(executions.length, 1);
            assert.deepEqual(JSON.parse(executions[0].arguments), { note: "synthetic-note" });
            assert.equal(result.tool_executions.length, 1);
            assert.equal(result.text, "Checking fixture. Final reply🙂 Done.");
            assert.equal(textFrom(events, "text"), result.text, "round flushes must not repeat published prefixes");
            assert.ok(events.every(event => !event.content || event.content.isWellFormed()));
            assert.doesNotMatch(JSON.stringify({ events, text: result.text }), /RAW_PRIVATE|<\/?think>/i,
                "fast body delivery must still strip private think blocks in every provider round");
        });
    } finally {
        beforeTool.release();
        followUp.release();
    }
});

test("late tool arguments and tool results never leak through visible monologue or provider summary", async () => {
    const parameter = "fixture-future-private-value-527181";
    const toolResult = "fixture-result-private-value-88812";
    const events = [];
    let executions = 0;
    await withLocalProvider(async (response, _body, round) => {
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
        response.flushHeaders();
        if (round === 1) {
            writeText(response, `[monologue]Using ${parameter}.[/monologue]Checking fixture. `);
            writeEvent(response, { choices: [{ delta: { reasoning_summary: `Looking up ${parameter}.` } }] });
            await new Promise(resolve => setImmediate(resolve));
            writeEvent(response, { choices: [{ delta: { tool_calls: [{
                index: 0,
                id: "fixture-late-argument-call",
                type: "function",
                function: { name: LOCAL_TOOL.name, arguments: JSON.stringify({ note: parameter }) }
            }] } }] });
        } else {
            assert.equal(round, 2);
            writeText(response, `[monologue]Reading ${toolResult}.[/monologue]Final fixture answer.`);
        }
        response.end("data: [DONE]\n\n");
    }, async settings => {
        const result = await generateReplyStream({
            settings,
            messages: [{ role: "user", content: "Use a synthetic confidential tool fixture." }],
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
            visibleMonologue: true,
            tools: [LOCAL_TOOL],
            async executeTool() { executions += 1; return { ok: true, value: toolResult }; },
            onEvent(event) { events.push(event); }
        });
        assert.equal(executions, 1);
        assert.equal(result.text, "Checking fixture. Final fixture answer.");
        assert.equal(result.visible_monologue.segment_count, 2);
        assert.equal(result.visible_monologue.redacted, true);
        assert.ok(events.some(event => event.type === "reasoning"), "public summaries remain supported");
        const publicProjection = JSON.stringify({ events, text: result.text, monologue: result.visible_monologue });
        assert.deepEqual(events.filter(event => String(event.content || "").includes(parameter))
            .map(event => `${event.type}:${event.phase || "delta"}`), [],
        "late synthetic parameters must not appear in any public event channel");
        assert.equal(publicProjection.includes(parameter), false, "future tool arguments must be registered before publishing sensitive channels");
        assert.equal(publicProjection.includes(toolResult), false, "a subsequent round must inherit tool-result privacy");
        const firstHeart = events.findIndex(event => event.type === "monologue" && event.phase === "delta");
        const firstBody = events.findIndex(event => event.type === "text");
        assert.ok(firstBody >= 0 && firstHeart > firstBody,
            "body display precedes publication of the late-parameter-checked monologue");
    });
});

for (const failure of ["missing-terminal", "provider-error"]) {
    test(`immediate plain body remains a failed result after ${failure}`, async () => {
        const events = [];
        const gate = eventGate(seen => textFrom(seen, "text") === "Temporary fixture reply.");
        try {
            await withLocalProvider(async response => {
                response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
                response.flushHeaders();
                writeText(response, "Temporary fixture reply.");
                await gate.wait();
                if (failure === "provider-error") {
                    writeEvent(response, { error: { code: "fixture_upstream_error", message: "Synthetic fixture failure." } });
                }
                response.end();
            }, async (settings, requests) => {
                await assert.rejects(generateReplyStream({
                    settings,
                    messages: [{ role: "user", content: "Synthetic interrupted request." }],
                    tools: [LOCAL_TOOL],
                    executeTool() { assert.fail("an incomplete stream must not execute tools"); },
                    onEvent(event) { events.push(event); gate.observe(event); }
                }), error => failure === "missing-terminal"
                    ? error.code === "provider_stream_incomplete"
                    : error.providerCode === "fixture_upstream_error");
                assert.equal(gate.state.timedOut, false, "a temporary visible delta must arrive before the failing tail");
                assert.equal(requests.length, 1, "a stream with received events must not silently replay");
                assert.equal(events.some(event => event.type === "done" && event.ok !== false), false);
            });
        } finally {
            gate.release();
        }
    });
}

test("deferred output protects accepted split monologue markers while publishing their following body", () => {
    for (const opening of [
        "[monologue]",
        "[monologueabc]",
        "[MONOLOGUE \t]",
        `[monologue${"x".repeat(32)}]`
    ]) {
        const events = [];
        const output = createVisibleMonologueOutput({
            enabled: true,
            deferMonologuePublication: true,
            onEvent: event => events.push(event)
        });
        output.pushText("Safe prefix. ");
        for (const character of opening) output.pushText(character);
        output.pushText("Protected fixture heart.[/monologue]Ordered body.");
        assert.equal(textFrom(events, "text"), "Safe prefix. Ordered body.");
        assert.equal(textFrom(events, "monologue"), "", "the private-checked channel must not publish before release");
        output.addSensitiveText("Protected fixture heart.");
        output.releaseMonologue();
        const result = output.finish();
        assert.equal(result.text, "Safe prefix. Ordered body.");
        assert.equal(result.visible_monologue.text, "[redacted sensitive content]");
        const count = events.length;
        output.releaseMonologue();
        assert.deepEqual(output.finish(), result);
        output.pushText("ignored late write");
        assert.equal(events.length, count, "release and finish are idempotent and late writes do not append");
    }
});

test("deferred output does not hold ordinary brackets and rejected markers", () => {
    for (const [visible, expected] of [
        ["An ordinary [note] remains immediate.", "An ordinary [note] remains immediate."],
        ["[monoX] is ordinary text.", "[monoX] is ordinary text."],
        ["[monologue?] is ordinary text.", "[monologue?] is ordinary text."],
        [`[monologue${"x".repeat(33)}] exceeds the accepted suffix length.`, `[monologue${"x".repeat(33)}] exceeds the accepted suffix length.`],
        ["[/monologue] has no opening marker here.", " has no opening marker here."]
    ]) {
        const events = [];
        const output = createVisibleMonologueOutput({
            enabled: true,
            deferMonologuePublication: true,
            onEvent: event => events.push(event)
        });
        for (const character of visible) output.pushText(character);
        assert.equal(textFrom(events, "text"), expected, "invalid markers must not buffer the remainder of a reply");
        assert.equal(output.finish().text, expected.trim());
        assert.equal(textFrom(events, "monologue"), "");
    }
});

test("native tool rounds publish each body before its tail while later parameters and results stay private", async () => {
    const parameter = "fixture-stage-two-private-parameter-7319";
    const toolResult = "fixture-stage-two-private-result-9951";
    const events = [];
    const gates = [
        eventGate(seen => textFrom(seen, "text") === "First body🙂 "),
        eventGate(seen => textFrom(seen, "text").endsWith("Second body🌈"))
    ];
    let executions = 0;
    try {
        await withLocalProvider(async (response, body, round) => {
            response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            response.flushHeaders();
            if (round === 1) {
                writeText(response, "[mono");
                writeText(response, `logue]Using ${parameter}. Calm🙂.[/monologue]First body🙂 `);
                writeEvent(response, { choices: [{ delta: { reasoning_summary: `Checking ${parameter}.` } }] });
                await gates[0].wait();
                writeEvent(response, { choices: [{ delta: { tool_calls: [{
                    index: 0, id: "stage-two-tool-call", type: "function",
                    function: { name: LOCAL_TOOL.name, arguments: JSON.stringify({ note: parameter }) }
                }] } }] });
            } else {
                assert.equal(round, 2);
                assert.equal(body.messages.filter(message => message.role === "tool").length, 1);
                writeText(response, `[MONOLOGUE \t]Reading ${toolResult}. Happy🌈.[/monologuel]Second body🌈`);
                await gates[1].wait();
                writeText(response, " Tail.");
            }
            response.end("data: [DONE]\n\n");
        }, async (settings, requests) => {
            const result = await generateReplyStream({
                settings, messages: [{ role: "user", content: "Synthetic body-first native tool request." }],
                promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                visibleMonologue: true, tools: [LOCAL_TOOL],
                async executeTool() { executions += 1; return { ok: true, value: toolResult }; },
                onEvent(event) { events.push(event); gates.forEach(gate => gate.observe(event)); }
            });
            assert.ok(gates.every(gate => !gate.state.timedOut), "both provider rounds must unlock their body gate without their tail");
            assert.equal(gates[0].state.beforeTail.some(event => event.type === "monologue" && event.phase === "delta"), false);
            assert.equal(gates[1].state.beforeTail.some(event => event.type === "monologue" && event.phase === "delta" && event.segment === 1), false);
            assert.equal(executions, 1);
            assert.equal(requests.length, 2);
            assert.equal(result.text, "First body🙂 Second body🌈 Tail.");
            assert.equal(textFrom(events, "text"), result.text);
            assert.equal(result.visible_monologue.segment_count, 2);
            assert.equal(result.visible_monologue.redacted, true);
            assert.equal(reconstructMonologue(events), result.visible_monologue.text);
            const projection = JSON.stringify({ events, text: result.text, monologue: result.visible_monologue });
            assert.equal(projection.includes(parameter), false);
            assert.equal(projection.includes(toolResult), false);
            assert.equal(events.filter(event => event.type === "monologue" && event.phase === "end").length, 1);
        });
    } finally {
        gates.forEach(gate => gate.release());
    }
});

for (const failure of ["missing-terminal", "provider-error", "disconnect"]) {
    test(`body-first native monologue never releases an unverified heart after ${failure}`, async () => {
        const events = [];
        const gate = eventGate(seen => textFrom(seen, "text") === "Temporary body🙂");
        let successfulReturn = false;
        try {
            await withLocalProvider(async response => {
                response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
                response.flushHeaders();
                writeText(response, "[monologue]Unverified fixture heart.[/monologue]Temporary body🙂");
                await gate.wait();
                if (failure === "disconnect") {
                    response.destroy();
                    return;
                }
                if (failure === "provider-error") {
                    writeEvent(response, { error: { code: "fixture_stage_two_error", message: "Synthetic fixture failure." } });
                }
                response.end();
            }, async (settings, requests) => {
                await assert.rejects(generateReplyStream({
                    settings, messages: [{ role: "user", content: "Synthetic failed heart request." }],
                    visibleMonologue: true, tools: [LOCAL_TOOL],
                    executeTool() { assert.fail("an unverified stream must not execute a tool"); },
                    onEvent(event) { events.push(event); gate.observe(event); }
                }).then(result => { successfulReturn = true; return result; }));
                assert.equal(gate.state.timedOut, false);
                assert.equal(successfulReturn, false);
                assert.equal(requests.length, 1, "already-started streams do not replay automatically");
                assert.equal(textFrom(events, "text"), "Temporary body🙂");
                assert.equal(textFrom(events, "monologue"), "");
                assert.equal(JSON.stringify(events).includes("Unverified fixture heart"), false);
                const endings = events.filter(event => event.type === "monologue" && event.phase === "end");
                assert.equal(endings.length, 1);
                assert.equal(endings[0].state, "failed");
                assert.equal(endings[0].characters, 0);
            });
        } finally {
            gate.release();
        }
    });
}

test("deferred output releases checked segments once, resets offsets at boundaries and starts retries cleanly", () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const events = [];
        const output = createVisibleMonologueOutput({ enabled: true, deferMonologuePublication: true, onEvent: event => events.push(event) });
        output.pushText("[mono");
        output.pushText("logue]First\ud83d");
        output.pushText("\ude42. More.[/monologue]First body🙂 ");
        assert.equal(textFrom(events, "text"), "First body🙂 ");
        assert.equal(textFrom(events, "monologue"), "");
        output.releaseMonologue();
        const released = events.length;
        output.releaseMonologue();
        assert.equal(events.length, released, "repeating a release must not replay a segment");
        output.nextAssistantResponse();
        output.pushText("[monologueabc]Second🌈. Again.[/monologue]Second body🌈");
        assert.equal(events.some(event => event.type === "monologue" && event.phase === "delta" && event.segment === 1), false);
        output.releaseMonologue();
        const result = output.finish();
        assert.equal(result.text, "First body🙂 Second body🌈");
        assert.equal(result.visible_monologue.text, "First🙂. More.\n\nSecond🌈. Again.");
        assert.equal(result.visible_monologue.segment_count, 2);
        assert.equal(reconstructMonologue(events), result.visible_monologue.text);
        assert.deepEqual([...new Set(events.filter(event => event.type === "monologue" && event.phase === "delta").map(event => event.segment))], [0, 1]);
        for (const segment of [0, 1]) {
            const first = events.find(event => event.type === "monologue" && event.phase === "delta" && event.segment === segment);
            assert.equal(first.offset, 0);
        }
        const completeCount = events.length;
        assert.deepEqual(output.finish(), result);
        output.releaseMonologue();
        assert.equal(events.length, completeCount);
        assert.equal(events.filter(event => event.type === "monologue" && event.phase === "end").length, 1);
    }
});

test("a failed deferred segment has no successful snapshot and discards only its unreleased heart", () => {
    const events = [];
    const output = createVisibleMonologueOutput({ enabled: true, deferMonologuePublication: true, onEvent: event => events.push(event) });
    output.pushText("[monologue]Checked first🙂.[/monologue]First body. ");
    output.releaseMonologue();
    output.nextAssistantResponse();
    output.pushText("[monologue]Unverified second🌈.[/monologue]Temporary second body.");
    const failed = output.finish({ outcome: "failed" });
    assert.equal(failed.visible_monologue, null);
    assert.equal(textFrom(events, "monologue"), "Checked first🙂.");
    assert.equal(events.some(event => event.type === "monologue" && event.phase === "delta" && event.segment === 1), false);
    const end = events.find(event => event.type === "monologue" && event.phase === "end");
    assert.equal(end.state, "failed");
    assert.equal(end.characters, Array.from("Checked first🙂.").length);
    output.releaseMonologue();
    assert.equal(textFrom(events, "monologue"), "Checked first🙂.");
});

test("a boundary cannot implicitly publish an unreleased previous segment", () => {
    const events = [];
    const output = createVisibleMonologueOutput({ enabled: true, deferMonologuePublication: true, onEvent: event => events.push(event) });
    output.pushText("[monologue]UNRELEASED_PREVIOUS_FIXTURE_HEART[/monologue]First body. ");
    output.nextAssistantResponse();
    assert.equal(textFrom(events, "monologue"), "");
    output.pushText("[monologue]Checked current🙂.[/monologue]Second body.");
    output.releaseMonologue();
    const result = output.finish();
    assert.equal(result.text, "First body. Second body.");
    assert.equal(result.visible_monologue.text, "Checked current🙂.");
    assert.equal(result.visible_monologue.segment_count, 1);
    assert.equal(reconstructMonologue(events), result.visible_monologue.text);
    const deltas = events.filter(event => event.type === "monologue" && event.phase === "delta");
    assert.equal(deltas[0].segment, 1);
    assert.equal(deltas[0].offset, 0);
    assert.equal(JSON.stringify({ events, monologue: result.visible_monologue }).includes("UNRELEASED_PREVIOUS_FIXTURE_HEART"), false);
});

test("deferred publication preserves the Unicode display budget without holding body text", () => {
    const events = [];
    const output = createVisibleMonologueOutput({ enabled: true, deferMonologuePublication: true, maxCharacters: 4, onEvent: event => events.push(event) });
    output.pushText("[monologue]AB\ud83d");
    output.pushText("\ude42CD[/monologue]Full body🌈.");
    assert.equal(textFrom(events, "text"), "Full body🌈.");
    assert.equal(textFrom(events, "monologue"), "");
    output.releaseMonologue();
    const result = output.finish();
    assert.equal(result.visible_monologue.text, "AB🙂C");
    assert.equal(result.visible_monologue.state, "truncated");
    assert.equal(result.visible_monologue.display_truncated, true);
    assert.equal(reconstructMonologue(events), result.visible_monologue.text);
    assert.ok(events.every(event => !event.content || event.content.isWellFormed()));
});

test("failed unclosed tool-follow-up heart cannot contaminate a successful nonstream fallback", async () => {
    const events = [];
    let executions = 0;
    await withLocalProvider(async (response, body, round) => {
        if (round === 3) {
            assert.equal(body.stream, undefined);
            assert.equal(body.tools, undefined);
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ choices: [{ message: { content: "Recovered fixture body." } }] }));
            return;
        }
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
        response.flushHeaders();
        if (round === 1) {
            writeText(response, "[monologue]Checked tool planning.[/monologue]");
            writeEvent(response, { choices: [{ delta: { tool_calls: [{
                index: 0, id: "fallback-fixture-call", type: "function",
                function: { name: LOCAL_TOOL.name, arguments: JSON.stringify({ note: "synthetic fallback request" }) }
            }] } }] });
            response.end("data: [DONE]\n\n");
        } else {
            assert.equal(round, 2);
            writeText(response, "[monologue]STALE_UNVERIFIED_FIXTURE_HEART");
            setImmediate(() => response.destroy());
        }
    }, async (settings, requests) => {
        const result = await generateReplyStream({
            settings, messages: [{ role: "user", content: "Synthetic failed-follow-up recovery." }],
            visibleMonologue: true, tools: [LOCAL_TOOL],
            async executeTool() { executions += 1; return { ok: true, value: "synthetic fallback result" }; },
            onEvent: event => events.push(event)
        });
        assert.equal(requests.length, 3);
        assert.equal(executions, 1, "fallback cannot re-execute the committed tool");
        assert.equal(result.text, "Recovered fixture body.");
        assert.equal(textFrom(events, "text"), result.text);
        assert.equal(result.visible_monologue.text, "Checked tool planning.");
        assert.equal(result.visible_monologue.segment_count, 1);
        assert.equal(reconstructMonologue(events), result.visible_monologue.text);
        assert.equal(JSON.stringify({ events, monologue: result.visible_monologue }).includes("STALE_UNVERIFIED_FIXTURE_HEART"), false);
    });
});

for (const strictGuard of [false, true]) {
    for (const verifiedFlags of [false, true]) {
        test(`discarded long heart does not alter fallback flags (strict guard ${strictGuard}, verified flags ${verifiedFlags})`, async () => {
            const previousGuard = process.env.PROVIDER_OUTPUT_GUARD_DISABLED;
            process.env.PROVIDER_OUTPUT_GUARD_DISABLED = strictGuard ? "false" : "true";
            const events = [];
            const verifiedHeart = verifiedFlags
                ? `Verified api_key=fixture-secret-token ${"V".repeat(6100)}`
                : "Checked short planning.";
            let executions = 0;
            try {
                await withLocalProvider(async (response, body, round) => {
                    if (round === 3) {
                        assert.equal(body.stream, undefined);
                        assert.equal(body.tools, undefined);
                        response.writeHead(200, { "Content-Type": "application/json" });
                        response.end(JSON.stringify({ choices: [{ message: { content:
                            "[monologue]Short recovery🙂.[/monologue]Recovered metadata fixture body."
                        } }] }));
                        return;
                    }
                    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
                    response.flushHeaders();
                    if (round === 1) {
                        writeText(response, `[monologue]${verifiedHeart}[/monologue]`);
                        writeEvent(response, { choices: [{ delta: { tool_calls: [{
                            index: 0, id: "long-heart-fallback-fixture", type: "function",
                            function: { name: LOCAL_TOOL.name, arguments: JSON.stringify({ note: "synthetic metadata request" }) }
                        }] } }] });
                        response.end("data: [DONE]\n\n");
                    } else {
                        assert.equal(round, 2);
                        writeText(response, `[monologue]STALE_METADATA_FIXTURE_${"U".repeat(6101)}`);
                        setImmediate(() => response.destroy());
                    }
                }, async (settings, requests) => {
                    const result = await generateReplyStream({
                        settings, messages: [{ role: "user", content: "Synthetic metadata fallback request." }],
                        visibleMonologue: true, tools: [LOCAL_TOOL],
                        async executeTool() { executions += 1; return { ok: true, value: "synthetic metadata result" }; },
                        onEvent: event => events.push(event)
                    });
                    assert.equal(requests.length, 3);
                    assert.equal(executions, 1);
                    assert.equal(result.text, "Recovered metadata fixture body.");
                    assert.equal(textFrom(events, "text"), result.text);
                    assert.equal(result.visible_monologue.state, verifiedFlags ? "truncated" : "complete",
                        "a discarded segment must not add truncation while earlier verified truncation remains valid");
                    assert.equal(result.visible_monologue.display_truncated, verifiedFlags);
                    assert.equal(result.visible_monologue.redacted, verifiedFlags,
                        "discard must preserve earlier checked redaction without inheriting flags from the failed round");
                    assert.equal(result.visible_monologue.segment_count, verifiedFlags ? 1 : 2,
                        "a verified 6000-character segment already consumes the unchanged global display budget");
                    if (!verifiedFlags) assert.ok(result.visible_monologue.text.endsWith("Short recovery🙂."));
                    assert.equal(reconstructMonologue(events), result.visible_monologue.text);
                    const projection = JSON.stringify({ events, monologue: result.visible_monologue });
                    assert.equal(projection.includes("STALE_METADATA_FIXTURE_"), false);
                    assert.equal(projection.includes("fixture-secret-token"), false);
                });
            } finally {
                if (previousGuard === undefined) delete process.env.PROVIDER_OUTPUT_GUARD_DISABLED;
                else process.env.PROVIDER_OUTPUT_GUARD_DISABLED = previousGuard;
            }
        });
    }
}

for (const target of ["arguments", "result"]) {
    test(`late ${target} leaves after 1200 serialized characters remain private in native monologue`, async () => {
        const argumentLeaf = "FICTIONAL_PRIVATE_TOOL_DETAIL";
        const resultLeaf = "FICTIONAL_PRIVATE_TOOL_RESULT_DETAIL";
        const argumentsValue = JSON.stringify({ padding: "x".repeat(1500), query: argumentLeaf });
        const resultValue = { ok: true, padding: "r".repeat(1500), detail: resultLeaf };
        const events = [];
        let executions = 0;
        assert.ok(argumentsValue.indexOf(argumentLeaf) > 1200);
        assert.ok(JSON.stringify(resultValue).indexOf(resultLeaf) > 1200);
        await withLocalProvider(async (response, _body, round) => {
            response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            response.flushHeaders();
            if (round === 1) {
                writeText(response, `[monologue]Using ${argumentLeaf}.[/monologue]First long-JSON fixture body. `);
                writeEvent(response, { choices: [{ delta: { reasoning_summary: `Checking ${argumentLeaf}.` } }] });
                await new Promise(resolve => setImmediate(resolve));
                writeEvent(response, { choices: [{ delta: { tool_calls: [{
                    index: 0, id: "long-json-leaf-fixture", type: "function",
                    function: { name: LOCAL_TOOL.name, arguments: argumentsValue }
                }] } }] });
            } else {
                assert.equal(round, 2);
                writeText(response, `[monologue]Reading ${resultLeaf}.[/monologue]Second long-JSON fixture body.`);
                writeEvent(response, { choices: [{ delta: { reasoning_summary: `Using ${resultLeaf}.` } }] });
            }
            response.end("data: [DONE]\n\n");
        }, async (settings, requests) => {
            const result = await generateReplyStream({
                settings, messages: [{ role: "user", content: "Synthetic long-serialized tool privacy fixture." }],
                visibleMonologue: true,
                tools: [{ ...LOCAL_TOOL, input_schema: {
                    type: "object", properties: { padding: { type: "string" }, query: { type: "string" } },
                    required: ["padding", "query"], additionalProperties: false
                } }],
                async executeTool() { executions += 1; return resultValue; },
                onEvent: event => events.push(event)
            });
            assert.equal(requests.length, 2);
            assert.equal(executions, 1);
            assert.equal(result.text, "First long-JSON fixture body. Second long-JSON fixture body.");
            const targetLeaf = target === "arguments" ? argumentLeaf : resultLeaf;
            assert.deepEqual(events.filter(event => String(event.content || "").includes(targetLeaf))
                .map(event => `${event.type}:${event.phase || "delta"}`), [],
            "short confidential leaves must remain protected even when their serialized JSON position exceeds the display clipping boundary");
            assert.equal(JSON.stringify({ text: result.text, monologue: result.visible_monologue }).includes(targetLeaf), false);
            assert.equal(result.visible_monologue.redacted, true);
            assert.equal(result.visible_monologue.segment_count, 2);
            assert.equal(reconstructMonologue(events), result.visible_monologue.text);
        });
    });
}
