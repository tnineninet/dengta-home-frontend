const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { generateReplyStream } = require("../services/ai-service");
const { registerToolSensitiveText } = require("../services/tool-round-stream");
const { createVisibleMonologueOutput } = require("../services/visible-monologue-stream");
const { createReasoningEventEmitter } = require("../services/reasoning-stream");

const SECRET = "FICTIONAL_LATER_TOOL_PRIVATE_DETAIL";
const SHORT_SECRET = "FICTIONAL_SHORT_PRIVATE_DETAIL";
const BODY = "First body🙂. Second body🌈. Final body.";
const TOOL = {
    name: "budget_fixture_tool",
    description: "Read one fictional fixture note.",
    input_schema: { type: "object", properties: { query: { type: "string" } } }
};

function eventsText(events, type) {
    return events.filter(event => event.type === type &&
        (type !== "monologue" || event.phase === "delta"))
        .map(event => event.content || "").join("");
}

async function exerciseProvider({ firstResult, lateArgument = false, secret = SECRET }) {
    let calls = 0;
    const requests = [];
    const events = [];
    const fixtureErrors = [];
    const server = http.createServer(async (request, response) => {
        try {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            const round = requests.length;
            response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            response.flushHeaders();
            const send = delta => response.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
            send({ content: round === 1
                ? "[monologue]Initial warm feeling.[/monologue]First body🙂. "
                : round === 2
                  ? `[monologue]I feel warm. Detail ${secret}.[/monologue]Second body🌈. `
                  : "[monologue]Final calm feeling.[/monologue]Final body." });
            if (round === 2) send({ reasoning_summary: `Checking ${secret}. Feeling ready.` });
            if (round < 3) {
                send({ tool_calls: [{
                    index: 0, id: `budget-fixture-call-${round}`, type: "function",
                    function: { name: TOOL.name, arguments: JSON.stringify({
                        query: round === 2 && lateArgument ? secret : `fictional-note-${round}`
                    }) }
                }] });
            }
            response.end("data: [DONE]\n\n");
        } catch (error) {
            fixtureErrors.push(error);
            response.destroy();
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const result = await generateReplyStream({
            settings: {
                provider: "custom", api_url: `http://127.0.0.1:${server.address().port}/v1`,
                runtime_api_key: "synthetic-local-budget-fixture-key", model: "synthetic-budget-model",
                prompt_mode: "unified", unified_system_prompt: "Synthetic fictional persona, unchanged.", max_tokens: 500
            },
            messages: [{ role: "user", content: "Synthetic tool privacy capacity request." }],
            visibleMonologue: true, tools: [TOOL],
            async executeTool() { calls += 1; return calls === 1 ? firstResult : { ok: true }; },
            onEvent: event => events.push(event)
        });
        assert.equal(requests.length, 3, "the fixture exercises three native provider rounds");
        assert.equal(calls, 2, "privacy handling cannot replay tool effects");
        assert.deepEqual(fixtureErrors, []);
        assert.equal(result.text, BODY, "privacy budget handling must not alter normal reply text");
        assert.equal(eventsText(events, "text"), BODY);
        const publicProjection = JSON.stringify({
            monologue: result.visible_monologue,
            deltas: events.filter(event => event.type === "monologue" || event.type === "reasoning")
        });
        assert.equal(publicProjection.includes(secret), false,
            "unregistered confidential values must never be published when privacy registration runs out of capacity");
        assert.equal(result.visible_monologue.redacted, true);
        assert.ok(events.every(event => !event.content || event.content.isWellFormed()));
        return { result, events };
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

test("native SSE: an earlier 200-leaf tool result cannot expose later tool arguments across three rounds", async () => {
    const padding = Array.from({ length: 4 }, (_, group) => Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [`field${index}`, `FICTIONAL_PADDING_${group}_${index}`])
    ));
    await exerciseProvider({ firstResult: { ok: true, padding }, lateArgument: true });
});

test("native SSE: a private leaf beyond the 50-entry container limit suppresses unsafe thought and summary", async () => {
    const entries = Array.from({ length: 50 }, (_, index) => `FICTIONAL_CONTAINER_PADDING_${index}`);
    entries.push(SECRET);
    await exerciseProvider({ firstResult: { entries } });
});

test("native SSE: a private leaf below the depth limit never leaks through public metadata", async () => {
    let nested = { detail: SECRET };
    for (let level = 0; level < 7; level += 1) nested = { nested };
    await exerciseProvider({ firstResult: nested });
});

test("native SSE: a private suffix beyond a 1200-character leaf is not protected only by its clipped prefix", async () => {
    await exerciseProvider({ firstResult: { detail: `${"x".repeat(1300)}${SECRET}` } });
});

test("native SSE: normal short leaves remain precisely redacted while unrelated feelings and body remain readable", async () => {
    const { result, events } = await exerciseProvider({
        firstResult: { ok: true, detail: SHORT_SECRET }, secret: SHORT_SECRET
    });
    assert.ok(result.visible_monologue.text.includes("I feel warm."),
        "normal complete registration must not hide the whole authored thought");
    assert.ok(eventsText(events, "reasoning").includes("Feeling ready."),
        "normal complete registration must not hide unrelated provider summary");
    assert.ok(result.visible_monologue.text.includes("Initial warm feeling."));
    assert.ok(result.visible_monologue.text.includes("Final calm feeling."));
});

test("registration completeness reports structural and clipping boundaries and fails closed in both public channels", () => {
    const cases = [
        Array.from({ length: 51 }, (_, index) => `FICTIONAL_ARRAY_${index}`),
        Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`k${index}`, `FICTIONAL_OBJECT_${index}`])),
        { a: { b: { c: { d: { e: { f: { detail: SECRET } } } } } } },
        { detail: `${"x".repeat(1300)}${SECRET}` }
    ];
    for (const value of cases) {
        const events = [];
        const output = createVisibleMonologueOutput({
            enabled: true, deferMonologuePublication: true, onEvent: event => events.push(event)
        });
        const reasoning = createReasoningEventEmitter({ onEvent: event => events.push(event) });
        assert.equal(typeof output.markSensitiveTextIncomplete, "function");
        assert.equal(typeof reasoning.markSensitiveTextIncomplete, "function");
        const monologueComplete = registerToolSensitiveText(JSON.stringify(value), output.addSensitiveText);
        const reasoningComplete = registerToolSensitiveText(JSON.stringify(value), reasoning.addSensitiveText);
        assert.equal(monologueComplete, false);
        assert.equal(reasoningComplete, false);
        if (!monologueComplete) output.markSensitiveTextIncomplete();
        if (!reasoningComplete) reasoning.markSensitiveTextIncomplete();
        output.pushText(`[monologue]Reading ${SECRET}.[/monologue]Unchanged body🙂`);
        output.releaseMonologue();
        reasoning.emit(`Checking ${SECRET}.`);
        reasoning.flushProvider();
        const result = output.finish();
        assert.equal(result.text, "Unchanged body🙂");
        assert.equal(result.visible_monologue.redacted, true);
        assert.equal(JSON.stringify({ events, monologue: result.visible_monologue }).includes(SECRET), false);
    }
});

test("normal leaf registration returns complete and does not disable precise redaction", () => {
    const events = [];
    const output = createVisibleMonologueOutput({
        enabled: true, deferMonologuePublication: true, onEvent: event => events.push(event)
    });
    const complete = registerToolSensitiveText(JSON.stringify({ detail: SHORT_SECRET }), output.addSensitiveText);
    assert.equal(complete, true);
    assert.equal(output.addSensitiveText(SHORT_SECRET), true);
    output.pushText(`[monologue]Calm feeling. Detail ${SHORT_SECRET}.[/monologue]Unchanged body🌈`);
    output.releaseMonologue();
    const result = output.finish();
    assert.equal(result.text, "Unchanged body🌈");
    assert.ok(result.visible_monologue.text.includes("Calm feeling."));
    assert.equal(result.visible_monologue.text.includes(SHORT_SECRET), false);
    assert.equal(result.visible_monologue.redacted, true);
});
