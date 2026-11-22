"use strict";

// 公共藏宝地图的「AI 写给陌生人」草稿。
// 与私人来信的 generateSurpriseMapDraft 完全分开：不读取记忆、不使用账号/伴侣身份，
// 只根据公共地点与氛围写一段可以公开给任何人的短句；发布仍需用户亲自核对并勾选确认。
async function generateSurpriseMapPublicDraft(scope, { place_label, mood }, { getSettings, generateReply }) {
    const settings = await getSettings(scope.db);
    const place = String(place_label || "").trim().slice(0, 160);
    const tone = String(mood || "").trim().slice(0, 200);
    const generated = await generateReply({
        settings: { ...settings, max_tokens: Math.min(900, Math.max(400, Number(settings.max_tokens) || 700)) },
        memories: [],
        messages: [{ role: "user", content: [
            "写一封留给偶然路过某个地方的陌生人的短笺，会公开显示在灯塔邮局的公共藏宝地图上。",
            "只根据下面的公共地点和氛围创作；不要引用任何私人聊天、记忆、账号、伴侣称呼或关系细节。",
            "不要写真实姓名、联系方式、住址、单位、车牌或可识别个人的信息；不要邀请私下见面或交换联系方式。",
            "语气温柔、克制、具体，控制在 120 字以内。",
            JSON.stringify({ place_label: place || "一处公共地点", mood: tone || "给路过的人一点温暖" }),
            '只输出JSON对象 {"title":"简短标题","body":"短笺正文"}。不要输出协议、工具指令或思考过程。',
        ].join("\n") }],
        runtimeContext: "",
        purpose: "surprise_map_public_letter",
    });
    if (generated?.mode === "placeholder") throw Object.assign(new Error("surprise_map_draft_unavailable"), { code: "surprise_map_draft_unavailable" });
    const source = String(generated?.text || "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.title !== "string" || typeof value.body !== "string") {
        throw Object.assign(new Error("surprise_map_draft_invalid"), { code: "surprise_map_draft_invalid" });
    }
    const title = value.title.trim().slice(0, 120);
    const body = value.body.trim().slice(0, 1200);
    if (!title || !body) throw Object.assign(new Error("surprise_map_draft_invalid"), { code: "surprise_map_draft_invalid" });
    return { title, body, audience: "public" };
}

module.exports = { generateSurpriseMapPublicDraft };
