const assert = require("node:assert/strict");
const {
    publicMessage,
    voiceAnalysisExpired
} = require("../services/chat-attachments");
const { normalizeChatBody } = require("../services/chat-request");
const { parseVoiceTurnFields } = require("../services/voice-turn");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const baseMessage = {
    id: 1,
    role: "user",
    content: "语音转写文本",
    tool_calls: {
        is_voice: true,
        voice_analysis: {
            emotion: "累",
            confidence: 0.8,
            hint: "声音比平时低",
            features: { pitch_mean_hz: 180 }
        }
    }
};

const fresh = publicMessage(
    { ...baseMessage, created_at: new Date(now - 5 * DAY).toISOString() },
    { basePath: "/api/v2/attachments" }
);
assert.equal(fresh.content, "语音转写文本");
assert.equal(fresh.tool_calls.is_voice, true);
assert.equal(fresh.tool_calls.voice_analysis.emotion, "累");
assert.equal(fresh.tool_calls.voice_analysis.hint, "声音比平时低");
assert.equal("features" in fresh.tool_calls.voice_analysis, false);

const expired = publicMessage(
    { ...baseMessage, created_at: new Date(now - 31 * DAY).toISOString() },
    { basePath: "/api/v2/attachments" }
);
assert.equal(expired.content, "语音转写文本");
assert.equal(expired.tool_calls.is_voice, true);
assert.equal(expired.tool_calls.voice_analysis, undefined);
assert.equal(voiceAnalysisExpired(new Date(now - 31 * DAY).toISOString()), true);
assert.equal(voiceAnalysisExpired(new Date(now - 5 * DAY).toISOString()), false);

const defaultBody = normalizeChatBody({}, []);
assert.equal(defaultBody.voiceAnalysisRetentionEnabled, true);
const offBody = normalizeChatBody({ voice_analysis_retention_enabled: "false" }, []);
assert.equal(offBody.voiceAnalysisRetentionEnabled, false);
assert.equal(parseVoiceTurnFields({}).voiceAnalysisRetentionEnabled, true);
assert.equal(
    parseVoiceTurnFields({ voice_analysis_retention_enabled: "false" })
        .voiceAnalysisRetentionEnabled,
    false
);

console.log("voice analysis retention tests passed");
