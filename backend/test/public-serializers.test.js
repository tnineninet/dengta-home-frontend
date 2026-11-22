const assert = require("node:assert/strict");
const { publicMoment, publicDiaryEntry } = require("../routes/v2/content");
const { publicMessage } = require("../services/chat-attachments");

const moment = publicMoment({
    id: "10000000-0000-4000-8000-000000000001",
    author: "user",
    content: "公开正文",
    images: [],
    liked: false,
    reply_content: null,
    replied_at: null,
    reply_seen_at: null,
    user_liked: false,
    created_at: "2026-10-21T00:00:00.000Z",
    context_note: "active_session_id:secret",
    image_description: "内部图片描述",
    reply_due_at: "2026-10-21T00:10:00.000Z",
    reply_status: "pending"
});
assert.equal(moment.content, "公开正文");
for (const field of ["context_note", "image_description", "reply_due_at", "reply_status"]) {
    assert.equal(Object.hasOwn(moment, field), false, `publicMoment must not expose ${field}`);
}
assert.doesNotMatch(JSON.stringify(moment), /内部图片描述|active_session_id/);

const diary = publicDiaryEntry({
    id: "20000000-0000-4000-8000-000000000001",
    title: "标题",
    content: "正文",
    mood: "平静",
    happened_on: "2026-10-20",
    source_message_ids: [1, 2, 3],
    source_window_start: "2026-10-20T00:00:00.000Z",
    source_window_end: "2026-10-20T01:00:00.000Z",
    created_at: "2026-10-20T01:00:00.000Z"
});
assert.equal(Object.hasOwn(diary, "source_message_ids"), false);
assert.equal(diary.source_message_count, 3);

const message = publicMessage({
    id: 1,
    role: "user",
    content: "语音转写",
    created_at: new Date().toISOString(),
    tool_calls: {
        is_voice: true,
        voice_analysis: {
            emotion: "累",
            confidence: 0.8,
            hint: "声音比平时低",
            features: { pitch_mean_hz: 180 }
        },
        reply_bubbles: {
            version: 1,
            count: 2,
            boundaries: [4, 8]
        }
    }
});
assert.equal(message.tool_calls.voice_analysis.hint, "声音比平时低");
assert.equal("features" in message.tool_calls.voice_analysis, false);
assert.deepEqual(message.tool_calls.reply_bubbles, {
    version: 1,
    count: 2,
    boundaries: [4, 8]
});
const invalidBubbles = publicMessage({
    id: 2,
    role: "assistant",
    content: "x",
    created_at: new Date().toISOString(),
    tool_calls: {
        reply_bubbles: { version: 1, count: 3, boundaries: [4] }
    }
});
assert.equal(invalidBubbles.tool_calls, undefined);

console.log("public serializers internal-field tests passed");
