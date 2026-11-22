"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    createXhsWriteActions
} = require("../services/xhs-write-actions");

const scope = {
    userId: "11111111-1111-4111-8111-111111111111",
    companionId: "33333333-3333-4333-8333-333333333333"
};
const otherScope = { ...scope, companionId: "44444444-4444-4444-8444-444444444444" };
const NOTE = "note1234567890";
const USER = "user1234567890";

function fakeClient() {
    const calls = [];
    return {
        calls,
        async like(id) { calls.push(["like", id]); return { liked: true }; },
        async comment(id, content) { calls.push(["comment", id, content]); return { commented: true }; },
        async follow(id) { calls.push(["follow", id]); return { followed: true }; },
        async favorite(id) { calls.push(["favorite", id]); return { favorited: true }; },
        async replyComment(id, commentId, content) { calls.push(["reply", id, commentId, content]); return { replied: true }; },
        async publishContent(payload) { calls.push(["publish", payload]); return { published: true, title: payload.title }; }
    };
}

test("write actions require preview, confirmation and an idempotency key", async () => {
    let now = 1_000_000;
    const actions = createXhsWriteActions({ secret: "fixture-confirmation-secret", now: () => now });
    const client = fakeClient();

    assert.throws(() => actions.preview(scope, "delete", { note_id: NOTE }), { code: "xhs_write_action_invalid" });
    assert.throws(() => actions.preview(scope, "like", {}), { code: "xhs_write_target_required" });
    assert.throws(() => actions.preview(scope, "comment", { note_id: NOTE }), { code: "xhs_write_content_required" });

    const preview = actions.preview(scope, "like", { note_id: NOTE });
    assert.equal(preview.action, "like");
    assert.equal(preview.target_id, NOTE);
    assert.ok(preview.confirmation_token);
    assert.ok(preview.expires_at);
    assert.equal(client.calls.length, 0, "preview must not perform the write");

    await assert.rejects(
        () => actions.execute(scope, preview.confirmation_token, "", client),
        { code: "xhs_idempotency_key_required" }
    );
    await assert.rejects(
        () => actions.execute(otherScope, preview.confirmation_token, "key-a", client),
        { code: "xhs_write_token_scope_mismatch" }
    );
    const receipt = await actions.execute(scope, preview.confirmation_token, "key-a", client);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.replayed, false);
    assert.deepEqual(client.calls, [["like", NOTE]]);

    const replay = await actions.execute(scope, preview.confirmation_token, "key-a", client);
    assert.equal(replay.replayed, true);
    assert.deepEqual(client.calls, [["like", NOTE]], "idempotent retry must not write twice");

    await assert.rejects(
        () => actions.execute(scope, preview.confirmation_token, "key-b", client),
        { code: "xhs_write_token_reused" }
    );
    const followPreview = actions.preview(scope, "follow", { user_id: USER });
    now += 6 * 60 * 1000;
    await assert.rejects(
        () => actions.execute(scope, followPreview.confirmation_token, "key-c", client),
        { code: "xhs_write_token_expired" }
    );
});

test("confirmation token is bound to its action payload and idempotency key", async () => {
    const actions = createXhsWriteActions({ secret: "fixture-confirmation-secret" });
    const client = fakeClient();
    const comment = actions.preview(scope, "comment", { note_id: NOTE, content: "第一句评论" });
    const receipt = await actions.execute(scope, comment.confirmation_token, "comment-key", client);
    assert.equal(receipt.action, "comment");
    assert.deepEqual(client.calls, [["comment", NOTE, "第一句评论"]]);

    await assert.rejects(
        () => actions.execute(scope, comment.confirmation_token, "other-key", client),
        { code: "xhs_write_token_reused" }
    );
    await assert.rejects(
        () => actions.execute(scope, "not-a-token", "key", client),
        { code: "xhs_write_token_invalid" }
    );
});

test("publish uses a confirmed preview and rejects unsafe image paths", async () => {
    const actions = createXhsWriteActions({ secret: "fixture-confirmation-secret" });
    const client = fakeClient();
    assert.throws(
        () => actions.preview(scope, "publish", { title: "标题", content: "正文", images: ["/etc/passwd"] }),
        { code: "xhs_publish_image_invalid" }
    );
    assert.throws(
        () => actions.preview(scope, "publish", { title: "标题", content: "正文", images: [] }),
        { code: "xhs_publish_images_required" }
    );
    const preview = actions.preview(scope, "publish", {
        title: "今天的小红书",
        content: "这是本地 mock 图文正文。",
        images: ["https://cdn.example.test/one.jpg"],
        tags: ["生活"]
    });
    assert.equal(preview.action, "publish");
    assert.equal(preview.preview.title, "今天的小红书");
    const result = await actions.execute(scope, preview.confirmation_token, "publish-key", client);
    assert.equal(result.action, "publish");
    assert.deepEqual(client.calls, [["publish", {
        title: "今天的小红书",
        content: "这是本地 mock 图文正文。",
        images: ["https://cdn.example.test/one.jpg"],
        tags: ["生活"],
        visibility: "公开可见",
        scheduleAt: ""
    }]]);
});
