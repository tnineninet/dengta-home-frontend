// 把长回复拆成聊天句，流式时每完成一句就形成一个独立段落；不改动保存的原文。
const SENTENCE_PATTERN = /[^。！？!?…]+[。！？!?…]+[”’"']?|[^。！？!?…]+$/g;
const STRUCTURED_LINE = /^\s*(?:[-*+] |\d+[.)] |> |\|)/;

function splitParagraph(value) {
    const text = String(value || "").trim();
    if (!text) return [];
    const matches = text.match(SENTENCE_PATTERN) || [];
    return matches.map(part => part.trim()).filter(Boolean);
}

export function splitChatSegments(value, replyBubbles = null) {
    const text = String(value || "");
    const boundaries = Array.isArray(replyBubbles?.boundaries)
        ? replyBubbles.boundaries
        : [];
    if (
        replyBubbles?.version === 1 &&
        Number(replyBubbles.count) === boundaries.length &&
        boundaries.length > 0
    ) {
        const segments = [];
        let start = 0;
        let valid = true;
        for (const raw of boundaries) {
            const end = Number(raw);
            if (!Number.isInteger(end) || end <= start || end > text.length) {
                valid = false;
                break;
            }
            segments.push(text.slice(start, end));
            start = end;
        }
        if (valid) {
            if (start < text.length) segments.push(text.slice(start));
            if (segments.some((segment) => segment.trim())) {
                return segments;
            }
        }
    }
    return splitChatFallback(text);
}

function splitChatFallback(value) {
    const text = String(value || "");
    if (!text.trim()) return [];
    // 代码块/表格/列表不强行按句号拆，避免破坏格式。
    if (text.includes("```") || /\n\s*\|/.test(text)) return [text];
    const segments = [];
    for (const block of text.split(/\n{2,}/)) {
        let paragraph = [];
        const flush = () => {
            if (!paragraph.length) return;
            segments.push(...splitParagraph(paragraph.join(" ")));
            paragraph = [];
        };
        for (const line of block.split("\n")) {
            if (STRUCTURED_LINE.test(line)) {
                flush();
                segments.push(line.trim());
            } else {
                paragraph.push(line.trim());
            }
        }
        flush();
    }
    return segments.length ? segments : [text];
}
