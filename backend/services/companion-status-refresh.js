const {
    UPDATE_COMPANION_STATUS_TOOL,
    applyCompanionStatusUpdate,
    parseCompanionStatusToolArguments,
    sanitizeCompanionStatusSnapshot
} = require("./companion-status");

function clean(value, max = 2000) {
    return Array.from(String(value ?? "").trim()).slice(0, max).join("");
}

function fallbackSnapshot(current, messages, now, liveState = null) {
    const base = sanitizeCompanionStatusSnapshot(current, now);
    const liveMood = String(liveState?.emotion?.label || "").trim();
    return sanitizeCompanionStatusSnapshot({
        ...base,
        mood: liveMood || base.mood,
        statusSource: "interaction_fallback",
        updatedAt: now.toISOString(),
        revision: Math.min(1_000_000_000, Number(base.revision || 0) + 1)
    }, now);
}

async function refreshCompanionStatus({
    settings,
    messages = [],
    currentStatus = null,
    generateReply,
    liveState = null,
    now = new Date()
}) {
    if (typeof generateReply !== "function") {
        return fallbackSnapshot(currentStatus, messages, now, liveState);
    }
    let captured = null;
    const instruction = [
        "请只根据最近真实对话，更新 AI 伴侣此刻可见的状态。",
        "必须调用一次 update_companion_status，保留八个基础字段，并生成与最近对话一致的 psychology、feeling、mood_level、patience_level。",
        "状态要符合当前语境、人设和心情，不要沿用旧状态，也不要把状态写成系统说明或对用户的评价。",
        "psychology 和 feeling 各一到两句话，合计不超过 120 字；mood 和 note 必须和最近对话一致。",
        "psychology 写她此刻心里主动想让对方看见的想法；feeling 写她身体或情绪上的具体感受。两段必须是不同内容，禁止把同一句话、聊天回复或回复片段同时复制进 psychology 和 feeling。",
        "状态字段不要混入聊天正文；只输出状态更新所需内容。"
    ].join("\n");
    try {
        await generateReply({
            settings: {
                ...settings,
                // This is a small hidden status-only call. Keep it short so it
                // cannot compete with the next visible chat turn.
                max_tokens: 512,
                temperature: Math.min(0.7, Number(settings?.temperature) || 0.4)
            },
            messages: [
                ...(Array.isArray(messages) ? messages : []).slice(-12),
                { role: "user", content: instruction }
            ],
            tools: [UPDATE_COMPANION_STATUS_TOOL],
            executeTool: async (toolCall) => {
                if (toolCall?.name !== UPDATE_COMPANION_STATUS_TOOL.name) {
                    return { ok: false, error: "只允许更新伴侣状态。" };
                }
                const parsed = parseCompanionStatusToolArguments(toolCall.arguments ?? "");
                if (parsed.ok) captured = parsed.value;
                return parsed.ok
                    ? { ok: true, message: "状态已更新。" }
                    : { ok: false, error: parsed.error || "状态参数不完整。" };
            }
        });
    } catch {
        // A failed supplementary status call must not affect the saved reply.
    }
    if (captured) {
        return applyCompanionStatusUpdate(
            sanitizeCompanionStatusSnapshot(currentStatus, now),
            captured,
            now
        );
    }
    return fallbackSnapshot(currentStatus, messages, now, liveState);
}

module.exports = { refreshCompanionStatus };
