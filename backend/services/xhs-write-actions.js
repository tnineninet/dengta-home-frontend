"use strict";

// Phase 2 local write confirmation and idempotency.
// Production needs a durable receipt store; this module keeps an in-memory
// store so the local mock fork can be tested without a DB migration.

const crypto = require("node:crypto");
const { extractXhsId } = require("./xhs-client");

const ACTIONS = Object.freeze({
  like: { target: "note" },
  comment: { target: "note", content: true },
  follow: { target: "user" },
  favorite: { target: "note" },
  reply: { target: "note", content: true, comment: true },
  publish: { target: "publish", publish: true }
});
const TOKEN_VERSION = 1;
const MAX_IMAGES = 9;

function writeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
function clean(value, max = 2000) {
  return Array.from(String(value ?? "").trim()).slice(0, max).join("");
}
function b64(value) {
  return Buffer.from(value).toString("base64url");
}
function unb64(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}
function canonical(payload) {
  return JSON.stringify(payload);
}
function hashPayload(payload) {
  return crypto.createHash("sha256").update(canonical(payload)).digest("hex");
}
function parseImages(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,]/);
  const images = [...new Set(list.map((item) => clean(item, 2048)).filter(Boolean))];
  if (!images.length) throw writeError(400, "xhs_publish_images_required", "至少需要一张小红书图片。");
  if (images.length > MAX_IMAGES) throw writeError(400, "xhs_publish_images_too_many", "小红书图片最多 9 张。");
  for (const image of images) {
    let url;
    try {
      url = new URL(image);
    } catch {
      throw writeError(400, "xhs_publish_image_invalid", "小红书图片必须是 https 链接。");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw writeError(400, "xhs_publish_image_invalid", "小红书图片必须是公开 https 链接。");
    }
  }
  return images;
}
function parseTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,]/);
  return [...new Set(list.map((item) => clean(item, 20)).filter(Boolean))].slice(0, 10);
}
function parsePublish(input = {}) {
  const title = clean(input.title, 80);
  const content = clean(input.content, 2000);
  const images = parseImages(input.images);
  if (!title) throw writeError(400, "xhs_publish_title_required", "缺少小红书标题。");
  if (!content) throw writeError(400, "xhs_publish_content_required", "缺少小红书正文。");
  const visibility = ["公开可见", "仅自己可见", "仅互关好友可见"].includes(input.visibility)
    ? input.visibility
    : "公开可见";
  const scheduleAt = clean(input.schedule_at, 80);
  const tags = parseTags(input.tags);
  return { title, content, images, tags, visibility, scheduleAt };
}
function parseInput(action, input = {}) {
  const definition = ACTIONS[action];
  if (!definition) throw writeError(400, "xhs_write_action_invalid", "不支持的小红书写操作。");
  if (definition.publish) {
    const publish = parsePublish(input);
    return {
      action,
      targetId: "",
      targetKind: "publish",
      content: "",
      commentId: "",
      publish,
      payloadHash: hashPayload({ action, publish })
    };
  }
  const targetId =
    definition.target === "note"
      ? extractXhsId(input.note_url || input.note_id || input.feed_id, "note")
      : extractXhsId(input.user_url || input.user_id, "user");
  if (!targetId) throw writeError(400, "xhs_write_target_required", "缺少小红书目标 ID。");
  const content = definition.content ? clean(input.content, 500) : "";
  if (definition.content && !content) throw writeError(400, "xhs_write_content_required", "缺少评论内容。");
  const commentId = definition.comment ? clean(input.comment_id, 80) : "";
  if (definition.comment && !commentId) throw writeError(400, "xhs_write_comment_required", "缺少目标评论 ID。");
  return {
    action,
    targetId,
    targetKind: definition.target,
    content,
    commentId,
    payloadHash: hashPayload({ action, targetId, content, commentId })
  };
}

function createXhsWriteActions({
  secret,
  ttlMs = 5 * 60 * 1000,
  now = () => Date.now(),
  receipts = new Map(),
  usedTokens = new Map()
} = {}) {
  const signingSecret = String(secret || "").trim();
  if (!signingSecret) throw writeError(503, "xhs_write_confirmation_unconfigured", "写操作确认密钥尚未配置。");

  function sign(encoded) {
    return crypto.createHmac("sha256", signingSecret).update(encoded).digest("base64url");
  }
  function verify(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) throw writeError(400, "xhs_write_token_invalid", "写操作确认令牌无效。");
    const [encoded, signature] = parts;
    const expected = sign(encoded);
    if (signature.length !== expected.length) throw writeError(400, "xhs_write_token_invalid", "写操作确认令牌无效。");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw writeError(400, "xhs_write_token_invalid", "写操作确认令牌无效。");
    }
    let payload;
    try {
      payload = JSON.parse(unb64(encoded));
    } catch {
      throw writeError(400, "xhs_write_token_invalid", "写操作确认令牌无效。");
    }
    if (payload?.v !== TOKEN_VERSION || !payload.exp || payload.exp <= now()) {
      throw writeError(410, "xhs_write_token_expired", "写操作确认已过期，请重新预览。");
    }
    return payload;
  }
  function preview(scope, action, input) {
    const normalized = parseInput(action, input);
    const issuedAt = now();
    const payload = {
      v: TOKEN_VERSION,
      userId: scope.userId,
      companionId: scope.companionId,
      action: normalized.action,
      targetId: normalized.targetId,
      targetKind: normalized.targetKind,
      content: normalized.content,
      commentId: normalized.commentId,
      publish: normalized.publish || null,
      payloadHash: normalized.payloadHash,
      exp: issuedAt + ttlMs,
      jti: crypto.randomUUID()
    };
    const encoded = b64(canonical(payload));
    const token = `${encoded}.${sign(encoded)}`;
    const summary =
      normalized.action === "publish"
        ? `发布小红书图文：${normalized.publish.title}`
        : normalized.action === "comment"
          ? `发表评论：${normalized.content}`
          : normalized.action === "reply"
            ? `回复评论：${normalized.content}`
            : normalized.action === "follow"
              ? "关注该小红书用户"
              : normalized.action === "favorite"
                ? "收藏该小红书笔记"
                : "点赞该小红书笔记";
    return {
      confirmation_token: token,
      action: normalized.action,
      target_id: normalized.targetId,
      summary,
      preview: normalized.publish || null,
      expires_at: new Date(payload.exp).toISOString()
    };
  }
  async function execute(scope, token, idempotencyKey, client) {
    const key = clean(idempotencyKey, 120);
    if (!key) throw writeError(400, "xhs_idempotency_key_required", "缺少幂等键。");
    const receiptKey = `${scope.userId}:${scope.companionId}:${key}`;
    const payload = verify(token);
    if (payload.userId !== scope.userId || payload.companionId !== scope.companionId) {
      throw writeError(403, "xhs_write_token_scope_mismatch", "写操作确认不属于当前账号与伴侣。");
    }
    const existing = receipts.get(receiptKey);
    if (existing) {
      if (existing.payloadHash !== payload.payloadHash) {
        throw writeError(409, "xhs_idempotency_conflict", "幂等键已用于不同的写操作。");
      }
      return { ...existing.result, replayed: true };
    }
    if (usedTokens.has(payload.jti)) {
      throw writeError(409, "xhs_write_token_reused", "这次确认已经使用过，请重新预览。");
    }
    if (!client) throw writeError(503, "xhs_service_unconfigured", "小红书服务尚未配置。");
    let raw;
    if (payload.action === "like") raw = await client.like(payload.targetId);
    else if (payload.action === "comment") raw = await client.comment(payload.targetId, payload.content);
    else if (payload.action === "follow") raw = await client.follow(payload.targetId);
    else if (payload.action === "favorite") raw = await client.favorite(payload.targetId, true);
    else if (payload.action === "reply") raw = await client.replyComment(payload.targetId, payload.commentId, payload.content);
    else if (payload.action === "publish") {
      if (typeof client.publishContent !== "function") throw writeError(501, "xhs_action_not_supported", "当前小红书服务尚未支持发布。");
      raw = await client.publishContent({
        title: payload.publish?.title || "",
        content: payload.publish?.content || "",
        images: payload.publish?.images || [],
        tags: payload.publish?.tags || [],
        visibility: payload.publish?.visibility || "公开可见",
        scheduleAt: payload.publish?.scheduleAt || ""
      });
    } else throw writeError(400, "xhs_write_action_invalid", "不支持的小红书写操作。");
    const result = {
      ok: true,
      action: payload.action,
      target_id: payload.targetId,
      receipt: raw,
      completed_at: new Date(now()).toISOString()
    };
    usedTokens.set(payload.jti, now() + ttlMs);
    receipts.set(receiptKey, { payloadHash: payload.payloadHash, result, completedAt: now() });
    return { ...result, replayed: false };
  }
  return { preview, execute, verify };
}

module.exports = { createXhsWriteActions, ACTIONS };
