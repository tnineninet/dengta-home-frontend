const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    publicMoment,
    publicMomentComment
} = require("../routes/v2/content");

const moment = publicMoment({
    id: "00000000-0000-4000-8000-000000000001",
    author: "assistant",
    content: "公开正文",
    images: [],
    context_note: "active_session_id:secret",
    image_description: "内部图片描述",
    reply_due_at: "2026-10-21T00:00:00.000Z",
    reply_status: "pending",
    liked: true,
    reply_content: "公开回复",
    replied_at: "2026-10-21T00:01:00.000Z",
    reply_seen_at: null,
    user_liked: false,
    created_at: "2026-10-21T00:00:00.000Z"
});
assert.deepEqual(Object.keys(moment).sort(), [
    "author",
    "content",
    "created_at",
    "id",
    "images",
    "liked",
    "replied_at",
    "reply_content",
    "reply_seen_at",
    "user_liked"
]);
for (const internalField of [
    "context_note",
    "image_description",
    "reply_due_at",
    "reply_status"
]) {
    assert.equal(Object.hasOwn(moment, internalField), false, internalField);
}

const comment = publicMomentComment({
    id: "00000000-0000-4000-8000-000000000002",
    moment_id: moment.id,
    author: "user",
    content: "公开评论",
    reply_due_at: "2026-10-21T00:00:00.000Z",
    reply_status: "pending",
    seen_at: null,
    created_at: "2026-10-21T00:00:00.000Z"
});
assert.equal(Object.hasOwn(comment, "reply_due_at"), false);
assert.equal(Object.hasOwn(comment, "reply_status"), false);

const serverSource = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);
for (const legacySymbol of [
    "processDueMoments",
    "processDueMomentReply",
    "momentReplyLocks",
    "commentReplyLocks",
    "PUBLIC_MOMENT_FIELDS",
    "buildMomentBackground"
]) {
    assert.equal(
        serverSource.includes(legacySymbol),
        false,
        `legacy moment path must be removed: ${legacySymbol}`
    );
}
assert.equal(
    /app\.(get|post|use)\(["']\/moments/.test(serverSource),
    false,
    "legacy /moments route must be removed"
);

const migration = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "063_image_descriptions.sql"),
    "utf8"
);
assert.match(migration, /unique\s*\(\s*user_id,\s*companion_id,\s*sha256\s*\)/i);

console.log("moments privacy and legacy cleanup tests passed");
