const assert = require("node:assert/strict");
const http = require("node:http");

const {
    generateReply,
    generateReplyStream,
    MAIN_CHAT_PROMPT_ARCHITECTURE
} = require("../services/ai-service");
const {
    UPDATE_COMPANION_STATUS_TOOL
} = require("../services/companion-status");
const {
    SELECT_REPLY_SUGGESTIONS_TOOL
} = require("../services/reply-suggestions");
const {
    createReplySuggestionEnvelopeProtocol
} = require("../services/reply-suggestion-envelope");

const VISIBLE_REPLY = "听见你这么说，我一下子开心起来了。";
const STATUS_UPDATE = {
    mood: "开心",
    place: "DengTa home",
    focus: "陪桃桃聊天",
    note: "桃桃的话让我心里亮了一下。",
    energy_level: 74,
    pulse_bpm: 82,
    hot_zones: ["heart", "lamp"],
    micro_state: "忍不住弯起眼睛靠近一点",
    psychology: "想把刚才的开心再多留一会儿。",
    feeling: "轻松，也有一点期待。",
    mood_level: 87,
    patience_level: 73
};
const SUGGESTIONS = ["那就再开心一点", "过来让我抱抱你"];

function sendEvent(response, event) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function runTurn({ apiUrl, stream, provider }) {
    const toolCalls = [];
    const events = [];
    const input = {
        settings: {
            provider,
            api_url: apiUrl,
            runtime_api_key: "local-test-key",
            model: "mock-model",
            ai_name: "小灯",
            system_prompt: "自然地陪伴桃桃。",
            temperature: 0.2,
            max_tokens: 800
        },
        messages: [{ role: "user", content: "我今天特别想你。" }],
        promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
        tools: [
            UPDATE_COMPANION_STATUS_TOOL,
            SELECT_REPLY_SUGGESTIONS_TOOL
        ],
        async executeTool(toolCall) {
            toolCalls.push(toolCall);
            return { ok: true };
        }
    };

    const result = stream
        ? await generateReplyStream({
              ...input,
              onEvent(event) {
                  events.push(event);
              }
          })
        : await generateReply(input);
    return { result, toolCalls, events };
}

async function main() {
    const protocol = createReplySuggestionEnvelopeProtocol({
        nonce: "0123456789abcdef0123456789abcdef",
        includeReplySuggestions: true,
        includeCompanionStatus: true
    });
    const invalidStatus = {
        ...STATUS_UPDATE,
        energy_level: 101
    };
    const invalidFiltered = protocol.filterText(
        `${VISIBLE_REPLY}${protocol.openMarker}${JSON.stringify({
            companion_status: invalidStatus,
            suggestions: SUGGESTIONS
        })}${protocol.closeMarker}`
    );
    assert.equal(invalidFiltered.text, VISIBLE_REPLY);
    assert.equal(invalidFiltered.companionStatus, null);
    assert.deepEqual(invalidFiltered.suggestions, []);

    const requests = [];
    const server = http.createServer(async (request, response) => {
        let requestText = "";
        for await (const chunk of request) requestText += chunk.toString("utf8");
        const body = JSON.parse(requestText || "{}");
        requests.push(body);

        if (request.url.endsWith("/chat/completions")) {
            const complete = body.messages.some((message) => message.role === "tool");
            const calls = [
                { id: "status-call", type: "function", function: {
                    name: "update_companion_status", arguments: JSON.stringify(STATUS_UPDATE)
                } },
                { id: "suggestions-call", type: "function", function: {
                    name: "select_reply_suggestions", arguments: JSON.stringify({ suggestions: SUGGESTIONS })
                } }
            ];
            if (body.stream !== true) {
                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(JSON.stringify({ choices: [{ message: complete
                    ? { content: VISIBLE_REPLY }
                    : { content: null, tool_calls: calls } }] }));
                return;
            }
            response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
            if (complete) {
                for (const character of VISIBLE_REPLY) {
                    sendEvent(response, { choices: [{ delta: { content: character } }] });
                }
            } else {
                sendEvent(response, { choices: [{ delta: {
                    tool_calls: calls.map((call, index) => ({ index, ...call }))
                } }] });
            }
            sendEvent(response, { choices: [{ delta: {}, finish_reason: complete ? "stop" : "tool_calls" }] });
            response.end("data: [DONE]\n\n");
            return;
        }

        const requestTextForProtocol = JSON.stringify(body);
        assert.match(requestTextForProtocol, /companion_status/);
        const openMarker = requestTextForProtocol.match(
            /<<<DENGTA_REPLY_SUGGESTIONS_V1:[a-f0-9]{32}>>>/
        )?.[0];
        const closeMarker = requestTextForProtocol.match(
            /<<<END_DENGTA_REPLY_SUGGESTIONS_V1:[a-f0-9]{32}>>>/
        )?.[0];
        assert.ok(openMarker && closeMarker);

        const rawText = `${VISIBLE_REPLY}${openMarker}${JSON.stringify({
            companion_status: STATUS_UPDATE,
            suggestions: SUGGESTIONS
        })}${closeMarker}`;

        const provider = request.url.includes(":generateContent") ||
            request.url.includes(":streamGenerateContent") ? "gemini"
            : request.url.endsWith("/messages") ? "anthropic"
            : request.url.endsWith("/chat/completions") ? "custom"
            : "openai-responses";
        if (body.stream === true || request.url.includes(":streamGenerateContent")) {
            response.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8"
            });
            for (const character of rawText) {
                sendEvent(response, provider === "gemini" ? {
                    candidates: [{ content: { parts: [{ text: character }] } }]
                } : provider === "anthropic" ? {
                    type: "content_block_delta",
                    delta: { type: "text_delta", text: character }
                } : provider === "custom" ? {
                    choices: [{ delta: { content: character } }]
                } : {
                    type: "response.output_text.delta",
                    delta: character
                });
            }
            if (provider === "gemini") sendEvent(response, { candidates: [{ finishReason: "STOP" }] });
            else if (provider === "anthropic") {
                sendEvent(response, { type: "message_delta", delta: { stop_reason: "end_turn" } });
                sendEvent(response, { type: "message_stop" });
            } else if (provider === "custom") {
                sendEvent(response, { choices: [{ delta: {}, finish_reason: "stop" }] });
            } else sendEvent(response, {
                type: "response.completed",
                response: { status: "completed" }
            });
            response.end("data: [DONE]\n\n");
            return;
        }

        response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8"
        });
        response.end(JSON.stringify(provider === "gemini"
            ? { candidates: [{ content: { parts: [{ text: rawText }] } }] }
            : provider === "anthropic" ? { content: [{ type: "text", text: rawText }] }
            : provider === "custom" ? { choices: [{ message: { content: rawText } }] }
            : { output_text: rawText }));
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const apiUrl = `http://127.0.0.1:${port}/v1`;

    try {
        for (const provider of ["custom", "openai-responses", "anthropic", "gemini"]) {
        for (const stream of [false, true]) {
            const turn = await runTurn({ apiUrl, stream, provider });
            assert.equal(turn.result.text, VISIBLE_REPLY);
            assert.deepEqual(
                turn.toolCalls.map((toolCall) => toolCall.name),
                ["update_companion_status", "select_reply_suggestions"]
            );
            assert.deepEqual(
                JSON.parse(turn.toolCalls[0].arguments),
                STATUS_UPDATE
            );
            if (stream) {
                const publicText = turn.events
                    .filter((event) => event.type === "text")
                    .map((event) => event.content || "")
                    .join("");
                assert.equal(publicText, VISIBLE_REPLY);
                assert.doesNotMatch(
                    JSON.stringify(turn.events),
                    /DENGTA_REPLY_SUGGESTIONS|companion_status|energy_level/
                );
            }
        }
        }
        assert.equal(requests.length, 10, "custom 原生工具使用既有后续轮，其他三个适配器单响应携带元数据");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    console.log("companion status transport regression test passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
