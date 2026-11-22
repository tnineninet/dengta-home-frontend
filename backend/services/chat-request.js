const { normalizeClientMessageId } = require("./chat-idempotency");
const {
    normalizeEnvironmentContext
} = require("./environment-context");
const {
    parseMessageReference
} = require("./message-reference");

function cleanText(value, maxLength) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function parseTurnContext(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string") {
        const error = new Error("turn_context 必须是字符串。");
        error.status = 400;
        throw error;
    }
    const normalized = value.trim();
    if (Array.from(normalized).length > 4000) {
        const error = new Error("turn_context 不能超过 4000 个字符。");
        error.status = 400;
        throw error;
    }
    return normalized;
}

function parseChatBoolean(value) {
    return value === true || String(value || "").trim().toLowerCase() === "true";
}

function parseChatObject(value, fieldName) {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        // 统一在下方返回可读的 400 错误。
    }
    const error = new Error(`${fieldName} 格式不正确。`);
    error.status = 400;
    throw error;
}

function parseAttachmentInstructionMode(value) {
    const normalized = String(value || "untrusted").trim().toLowerCase();
    if (["", "untrusted"].includes(normalized)) return "untrusted";
    if (normalized === "system") return "system";

    const error = new Error("attachment_instruction_mode 只能是 untrusted 或 system。");
    error.status = 400;
    throw error;
}

function parseAttachmentStorageMode(value) {
    const normalized = String(value || "persistent").trim().toLowerCase();
    if (["", "persistent"].includes(normalized)) return "persistent";
    if (normalized === "ephemeral") return "ephemeral";

    const error = new Error(
        "attachment_storage_mode 只能是 persistent 或 ephemeral。"
    );
    error.status = 400;
    throw error;
}

function normalizeChatBody(bodyValue, filesValue) {
    const body = bodyValue && typeof bodyValue === "object" ? bodyValue : {};
    const attachmentInstructionMode = parseAttachmentInstructionMode(
        body.attachment_instruction_mode
    );
    const attachmentStorageMode = parseAttachmentStorageMode(
        body.attachment_storage_mode
    );
    if (
        attachmentStorageMode === "ephemeral" &&
        attachmentInstructionMode !== "untrusted"
    ) {
        const error = new Error(
            "短时视觉附件必须保持 untrusted 安全隔离。"
        );
        error.status = 400;
        throw error;
    }
    return {
        message: cleanText(body.message, 30000),
        conversationId: cleanText(
            body.session_id || body.conversation_id,
            80
        ),
        requestedModel: cleanText(body.model, 160),
        clientMessageId: normalizeClientMessageId(body.client_message_id),
        emotionUnderstandingEnabled: parseChatBoolean(
            body.emotion_understanding_enabled
        ),
        voiceAnalysisRetentionEnabled:
            body.voice_analysis_retention_enabled === undefined ||
            body.voice_analysis_retention_enabled === ""
                ? true
                : parseChatBoolean(body.voice_analysis_retention_enabled),
        publicReasoningSummary: parseChatBoolean(body.public_reasoning_summary),
        attachmentInstructionMode,
        attachmentStorageMode,
        companionStatus: parseChatObject(
            body.companion_status,
            "companion_status"
        ),
        environmentContext: normalizeEnvironmentContext(
            body.environment_context,
            body.weather_context
        ),
        turnContext: parseTurnContext(body.turn_context),
        // 通道桥接专用：微信/QQ 只剩用户勾选的人设小节与记忆时，用这份文本
        // 覆盖本回合的 unified_system_prompt；不落库、不影响网页端会话。
        channelPersona: cleanText(body.channel_persona, 60000),
        messageReference: parseMessageReference(body.message_reference),
        clientTime: cleanText(body.client_time, 80),
        timezone: cleanText(body.timezone, 80),
        files: Array.isArray(filesValue) ? filesValue : []
    };
}

module.exports = {
    normalizeChatBody,
    parseAttachmentInstructionMode,
    parseAttachmentStorageMode,
    parseChatBoolean,
    parseChatObject,
    parseMessageReference,
    parseTurnContext
};
