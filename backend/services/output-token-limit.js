const { resolveContextWindow } = require("./context-budget");

const MIN_OUTPUT_TOKENS = 512;
const MAX_OUTPUT_RATIO = 0.5;

function clampOutputTokens(value, model) {
    const configured = Number(value);
    if (!Number.isFinite(configured) || configured <= 0) return configured > 0 ? configured : 0;
    const capacity = Math.max(2048, Number(resolveContextWindow(model)) || 2048);
    const cap = Math.max(MIN_OUTPUT_TOKENS, Math.floor(capacity * MAX_OUTPUT_RATIO));
    return Math.min(Math.round(configured), cap);
}

// 只限制本轮生成请求的输出预算，不改写用户保存的设置。
function withClampedOutputTokens(settings = {}) {
    return {
        ...settings,
        max_tokens: clampOutputTokens(settings.max_tokens, settings.model)
    };
}

module.exports = { clampOutputTokens, withClampedOutputTokens };
