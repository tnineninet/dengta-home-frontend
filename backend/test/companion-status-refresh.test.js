const assert = require("node:assert/strict");
const test = require("node:test");
const {
    refreshCompanionStatus
} = require("../services/companion-status-refresh");
const {
    UPDATE_COMPANION_STATUS_TOOL
} = require("../services/companion-status");

const statusArguments = {
    mood: "happy",
    place: "home",
    focus: "talk with you",
    note: "we just had a good talk",
    energy_level: 72,
    pulse_bpm: 84,
    hot_zones: [],
    micro_state: "warm inside",
    psychology: "want to stay close",
    feeling: "relaxed and happy",
    mood_level: 82,
    patience_level: 74
};

test("fallback status is labeled and does not copy chat text into visible fields", async () => {
    const current = {
        mood: "old mood",
        place: "home",
        focus: "old focus",
        note: "old note",
        psychology: "old psychology",
        feeling: "old feeling",
        energyLevel: 60,
        pulseBpm: 72,
        hotZones: [],
        microState: "old micro state"
    };
    const result = await refreshCompanionStatus({
        settings: {},
        messages: [
            { role: "user", content: "user chat text" },
            { role: "assistant", content: "assistant chat text should not become status" }
        ],
        currentStatus: current,
        liveState: { emotion: { label: "calm" } },
        generateReply: async () => { throw new Error("provider unavailable"); }
    });
    assert.equal(result.statusSource, "interaction_fallback");
    assert.equal(result.mood, "calm");
    assert.equal(result.note, current.note);
    assert.equal(result.psychology, current.psychology);
    assert.equal(result.feeling, current.feeling);
});

test("a captured status tool update is applied as model output", async () => {
    const result = await refreshCompanionStatus({
        settings: {},
        messages: [{ role: "assistant", content: "recent chat" }],
        currentStatus: {},
        liveState: null,
        generateReply: async (options) => {
            assert.match(options.messages.at(-1).content, /必须是不同内容/);
            assert.deepEqual(options.tools, [UPDATE_COMPANION_STATUS_TOOL]);
            const response = await options.executeTool({
                name: UPDATE_COMPANION_STATUS_TOOL.name,
                arguments: JSON.stringify(statusArguments)
            });
            assert.equal(response.ok, true);
        }
    });
    assert.equal(result.statusSource, "model");
    assert.equal(result.mood, "happy");
    assert.equal(result.note, "we just had a good talk");
    assert.equal(result.psychology, "want to stay close");
});
