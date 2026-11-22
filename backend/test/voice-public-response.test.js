const assert = require("node:assert/strict");
const { publicVoiceAnalysis } = require("../services/voice-turn");

const result = publicVoiceAnalysis({
    text: "语音转写",
    emotion: "累",
    confidence: 0.8,
    hint: "声音比平时低",
    features: { pitch_mean_hz: 180, energy_rms: 0.2 },
    source: "hervoice",
    analyzed_at: "2026-10-21T00:00:00.000Z"
});

assert.deepEqual(result, {
    text: "语音转写",
    emotion: "累",
    confidence: 0.8,
    hint: "声音比平时低",
    source: "hervoice"
});
assert.equal("features" in result, false);
assert.equal("analyzed_at" in result, false);

console.log("voice public response tests passed");
