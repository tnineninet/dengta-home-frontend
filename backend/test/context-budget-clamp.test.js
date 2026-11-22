const assert = require("node:assert/strict");
const test = require("node:test");
const { allocateContextBudget } = require("../services/context-budget");

test("reserved output is clamped to the model context window", () => {
    const result = allocateContextBudget({
        contextWindow: 32768,
        maxOutputTokens: 65536,
        systemPrompt: "system",
        messages: [{ role: "user", content: "hello" }],
        protectedFromIndex: 0
    });
    assert.equal(result.ok, true);
    assert.ok(result.usage.reservedOutput < result.usage.capacity);
    assert.ok(
        result.usage.system + result.usage.latest + result.usage.extra + result.usage.reservedOutput
        < result.usage.capacity
    );
});
