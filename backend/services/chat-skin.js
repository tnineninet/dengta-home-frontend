// 新账号默认使用与老账号一致的奶油小猫皮肤；已保存的
// companion_chat_preferences 行始终优先于这个默认值。
const DEFAULT_CHAT_SKIN_PREFERENCES = Object.freeze({
    skin: "taotao-cream",
    ornament_activity: "natural",
    dynamic_composer_hint: true,
    reduce_motion: false,
    hide_generation_process: true,
    show_error_details: false
});
const {
    filterProviderBoundaryMessages
} = require("./persistent-memory-filter");

const CHAT_SKINS = new Set(["classic-glass", "taotao-cream"]);
const ORNAMENT_ACTIVITY_LEVELS = new Set(["quiet", "natural", "lively"]);
const HINT_MINUTES = 15;
const HINT_DAILY_LIMIT = 12;

function defaultChatSkinPreferencesForRole(_role) {
    // 所有角色（含新注册的 member）使用同一默认皮肤，与老账号观感一致；
    // 已保存的账号偏好由数据库记录决定，默认值不会覆盖它。
    return { ...DEFAULT_CHAT_SKIN_PREFERENCES };
}

function normalizeChatSkinPreferences(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const ornamentActivity =
        source.ornament_activity ?? source.ornamentActivity;
    const dynamicComposerHint =
        source.dynamic_composer_hint ?? source.dynamicComposerHint;
    const reduceMotion = source.reduce_motion ?? source.reduceMotion;
    const hideGenerationProcess =
        source.hide_generation_process ?? source.hideGenerationProcess;
    const showErrorDetails =
        source.show_error_details ?? source.showErrorDetails;
    return {
        skin: CHAT_SKINS.has(source.skin)
            ? source.skin
            : DEFAULT_CHAT_SKIN_PREFERENCES.skin,
        ornament_activity: ORNAMENT_ACTIVITY_LEVELS.has(ornamentActivity)
            ? ornamentActivity
            : DEFAULT_CHAT_SKIN_PREFERENCES.ornament_activity,
        dynamic_composer_hint:
            typeof dynamicComposerHint === "boolean"
                ? dynamicComposerHint
                : DEFAULT_CHAT_SKIN_PREFERENCES.dynamic_composer_hint,
        reduce_motion:
            typeof reduceMotion === "boolean"
                ? reduceMotion
                : DEFAULT_CHAT_SKIN_PREFERENCES.reduce_motion,
        hide_generation_process:
            typeof hideGenerationProcess === "boolean"
                ? hideGenerationProcess
                : DEFAULT_CHAT_SKIN_PREFERENCES.hide_generation_process,
        show_error_details:
            typeof showErrorDetails === "boolean"
                ? showErrorDetails
                : DEFAULT_CHAT_SKIN_PREFERENCES.show_error_details
    };
}

function normalizeComposerHint(value) {
    const normalized = String(value || "")
        .replace(/[\r\n]+/g, " ")
        .replace(/[`*_#<>]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 32);
    if (normalized.length < 2 || normalized.length > 22) return "";
    if (/https?:\/\//i.test(normalized)) return "";
    return normalized;
}

function hasEnoughComposerHintContext(messages) {
    return (
        (Array.isArray(messages) ? messages : []).filter(
            (message) =>
                ["user", "assistant"].includes(String(message?.role || "")) &&
                String(message?.content || "").trim()
        ).length >= 2
    );
}

function canRefreshComposerHint({
    now = new Date(),
    lastGeneratedAt = null,
    dailyCount = 0
} = {}) {
    if (Number(dailyCount) >= HINT_DAILY_LIMIT) {
        return { allowed: false, reason: "daily_limit" };
    }
    if (lastGeneratedAt) {
        const elapsed = now.getTime() - new Date(lastGeneratedAt).getTime();
        if (Number.isFinite(elapsed) && elapsed < HINT_MINUTES * 60 * 1000) {
            return { allowed: false, reason: "cooldown" };
        }
    }
    return { allowed: true, reason: "ready" };
}

function buildComposerHintPrompt({
    companionName = "伴侣",
    stableMood = "",
    messages = []
} = {}) {
    const recent = filterProviderBoundaryMessages(messages)
        .filter((message) =>
            ["user", "assistant"].includes(String(message?.role || ""))
        )
        .slice(-12)
        .map(
            (message) =>
                `${message.role === "user" ? "你" : companionName}: ${String(
                    message.content || ""
                )
                    .replace(/[\r\n]+/g, " ")
                    .replace(
                        /(?:系统提示词|密钥|token|api[_ -]?key|cookie|authorization)[^，。；;]{0,160}/gi,
                        "[敏感内容已省略]"
                    )
                    .slice(0, 420)}`
        )
        .join("\n");
    return [
        "你只负责为聊天输入框写一句短提示语，不回答用户问题。",
        "提示语必须是 2-22 个中文字符的一行自然口吻，可撒娇、调侃、疲惫或暂时不开心。",
        "不要使用 Markdown、链接、系统命令、技术错误、密钥、附件原文或长篇解释。",
        `AI 名称：${String(companionName).slice(0, 40)}`,
        `当前心情摘要：${String(stableMood).slice(0, 180)}`,
        "最近 12 条有效消息：",
        recent || "（暂无足够聊天背景）",
        "只输出提示语本身。"
    ].join("\n");
}

module.exports = {
    DEFAULT_CHAT_SKIN_PREFERENCES,
    HINT_DAILY_LIMIT,
    HINT_MINUTES,
    buildComposerHintPrompt,
    canRefreshComposerHint,
    defaultChatSkinPreferencesForRole,
    hasEnoughComposerHintContext,
    normalizeChatSkinPreferences,
    normalizeComposerHint
};
