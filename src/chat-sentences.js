// 把长回复拆成聊天句，流式时每完成一句就形成一个独立段落；不改动保存的原文。
const SENTENCE_PATTERN = /[^。！？!?…]+[。！？!?…]+[”’"']?|[^。！？!?…]+$/g;
const STRUCTURED_LINE = /^\s*(?:[-*+] |\d+[.)] |> |\|)/;

function splitParagraph(value) {
    const text = String(value || "").trim();
    if (!text) return [];
    const matches = text.match(SENTENCE_PATTERN) || [];
    return matches.map(part => part.trim()).filter(Boolean);
}

export function splitChatSegments(value) {
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
