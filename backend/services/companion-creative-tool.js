"use strict";

const { publicCreativeError } = require("./companion-creative");
const { scheduleSurpriseReveal } = require("./tenant-companion-creative");

const CREATIVE_ARTWORK_TOOL = {
    name: "create_artwork",
    description: [
        "在聊天里为用户画一张图，并放进当前伴侣的私人作品库。",
        "用户明确说想看/画/生成一张图、想要头像/涂鸦/礼物、或要求“画给我们”时调用；不要只口头答应。",
        "调用后图片会在后台生成，本条回复先返回 artwork_id；图片完成后会出现在这条消息里。",
        "prompt 写清楚画面主体、人物/场景、构图、光线、风格和氛围；不要只写“画一张好看的图”。",
        "用户没有明确要惊喜时 surprise=false。只有用户说“偷偷画/藏起来/以后给我”且已开启秘密惊喜，才设 surprise=true。",
        "图片接口未配置时不要反复重试，直接告诉用户去设置里启用图片接口。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            prompt: { type: "string", description: "完整画面提示词，包含主体、场景、构图、光线、风格和氛围。" },
            title: { type: "string", description: "给这张图起一个短标题。" },
            description: { type: "string", description: "这张图对你们意味着什么，一句话说明。" },
            kind: { type: "string", enum: ["doodle", "gift", "avatar"], description: "作品类型，默认 doodle。" },
            surprise: { type: "boolean", description: "是否作为秘密惊喜藏起来，默认 false。" },
            reveal_after_minutes: { type: "number", description: "惊喜多久后揭晓，单位分钟；仅 surprise=true 时有效。" }
        },
        required: ["prompt"],
        additionalProperties: false
    }
};

function cleanText(value, max = 1000) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max).join("");
}

function createCompanionCreativeToolExecutor({ center, database, scope, onArtwork = () => {} } = {}) {
    let created = false;
    let lastArtwork = null;

    async function execute(toolCall) {
        if (!center || !scope?.userId || !scope?.companionId) {
            return { ok: false, code: "creative_auth_required", error: "画图需要登录态，请先登录后再试。" };
        }
        if (created) {
            return { ok: false, code: "creative_turn_limit", error: "这次聊天已经画过一张图了；等它画完再决定要不要画第二张。" };
        }
        let args;
        try { args = JSON.parse(String(toolCall?.arguments || "")); }
        catch { return { ok: false, code: "creative_arguments_invalid", error: "画图参数不是有效的 JSON。" }; }
        if (!args || typeof args !== "object" || Array.isArray(args)) {
            return { ok: false, code: "creative_arguments_invalid", error: "画图参数格式不正确。" };
        }
        const prompt = cleanText(args.prompt, 6000);
        if (!prompt) return { ok: false, code: "creative_prompt_required", error: "请先写清楚想画什么。" };
        const title = cleanText(args.title, 120) || "聊天里画下的一张";
        const description = cleanText(args.description, 1200) || ("在聊天里为你说想画下：" + title);
        const kind = ["doodle", "gift", "avatar"].includes(args.kind) ? args.kind : "doodle";
        const wantsSurprise = args.surprise === true;

        let status;
        try { status = typeof center.readiness === "function" ? await center.readiness() : await center.status(); }
        catch (error) {
            const safe = publicCreativeError(error);
            return { ok: false, code: safe.code, error: safe.message };
        }
        if (status.settings?.generation_mode === "off") {
            return { ok: false, code: "creative_generation_disabled", error: "AI 图片生成当前是关闭的；可以去设置里开启，或先继续聊天。" };
        }
        if (status.provider?.enabled !== true) {
            return { ok: false, code: "creative_provider_not_enabled", setup_required: true,
                error: "图片接口还没有启用。去「涂鸦画室 → 图片接口设置」填一次 API，之后聊天里就能直接画。" };
        }
        if (status.provider?.auth_configured !== true) {
            return { ok: false, code: "creative_provider_credential_required", setup_required: true,
                error: "图片接口的 API Key 需要重新填写，填好后聊天里就能继续画。" };
        }
        if (wantsSurprise && status.settings?.surprise_enabled !== true) {
            return { ok: false, code: "creative_surprise_disabled", error: "秘密惊喜还没开启；先在图片设置里开启，或改成普通画作。" };
        }
        if (wantsSurprise && status.settings?.generation_mode !== "autonomous") {
            return { ok: false, code: "creative_surprise_mode_required", error: "藏惊喜需要把创作模式设为“自主创作”；当前模式会直接画出来。" };
        }

        try {
            const createdIdea = await center.createIdea({
                prompt, title, description, kind,
                reason: "聊天里想为你画下来。",
                alt_text: title,
                surprise: wantsSurprise,
                reveal_after_minutes: Number(args.reveal_after_minutes) || 24 * 60
            }, { allowSurprise: true, generateImmediately: true });
            created = true;
            const row = createdIdea.row;
            const surprise = row.visibility === "surprise";
            // 后台生成，先把 artwork_id 还给聊天；图片完成后前端会自己轮询显示。
            // 惊喜必须等图片真正生成成功后再排揭晓任务，避免到点还没有图。
            void center.generateArtwork(row.id, { allowSurprise: false })
                .then(async () => {
                    if (surprise) await scheduleSurpriseReveal({ database, artwork: row, now: () => new Date() });
                })
                .catch(() => {
                    // generateArtwork 自己会把失败写入作品状态；这里只避免未处理的 rejection。
                });
            lastArtwork = { artwork_id: row.id, artwork_alt: row.alt_text || title, artwork_state: "generating", artwork_surprise: surprise };
            if (!surprise) onArtwork(lastArtwork);
            return surprise
                ? {
                      ok: true,
                      state: "hidden",
                      surprise: true,
                      title: row.title,
                      message: "惊喜已经藏好了，到时间再给你看。"
                  }
                : {
                      ok: true,
                      artwork_id: row.id,
                      state: "generating",
                      surprise: false,
                      title: row.title,
                      alt: row.alt_text || title,
                      message: "开始画了，画好会出现在这条消息里。"
                  };
        } catch (error) {
            const safe = publicCreativeError(error);
            return { ok: false, code: safe.code, error: safe.message, ...(safe.status === 409 ? { setup_required: true } : {}) };
        }
    }

    return {
        tool: CREATIVE_ARTWORK_TOOL,
        execute,
        getArtwork: () => lastArtwork
    };
}

module.exports = { CREATIVE_ARTWORK_TOOL, createCompanionCreativeToolExecutor };
