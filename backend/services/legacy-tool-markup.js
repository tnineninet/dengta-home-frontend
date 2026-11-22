"use strict";

const {
    validateCompanionStatusToolArguments
} = require("./companion-status");

const KNOWN_TOOL_TAGS = Object.freeze([
    "update_companion_status",
    "select_companion_sticker",
    "select_reply_suggestions",
    "post_moment"
]);
const MAX_HELD_TAG_CHARS = 32_000;
const FUNCTION_TOOL_ALIASES = Object.freeze({
    neteseplaysong: "netease_play_song",
    neteaseplaysong: "netease_play_song",
    netease_play_song: "netease_play_song"
});

function normalizeToolKey(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

const KNOWN_TOOL_KEYS = new Set(KNOWN_TOOL_TAGS.map(normalizeToolKey));
const TOOL_KEY_TO_NAME = new Map(
    KNOWN_TOOL_TAGS.map(name => [normalizeToolKey(name), name])
);

function isFunctionTagStart(text, index) {
    const suffix = text.slice(index);
    return /^<\s*function\s*=/i.test(suffix)
        || /^<\s*\/?\s*toolcall\b/i.test(suffix);
}

function isFunctionPartialStart(text, index) {
    const suffix = text.slice(index).toLowerCase();
    if (!suffix.startsWith("<")) return false;
    const body = suffix.slice(1).replace(/^\//, "");
    return "function".startsWith(body) || body.startsWith("function")
        || "toolcall".startsWith(body) || body.startsWith("toolcall");
}

function normalizeLegacyToolName(value) {
    const raw = String(value || "").trim();
    const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    return FUNCTION_TOOL_ALIASES[key] || raw;
}

function decodeParameterValue(value) {
    return String(value || "")
        .replace(/^\s+|\s+$/g, "")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
}

function parseLegacyFunctionBlock(block) {
    const text = String(block || "");
    const nameMatch = /<\s*function\s*=\s*([A-Za-z0-9_-]+)/i.exec(text);
    if (!nameMatch) return [];
    const args = {};
    const parameterPattern = /<\s*parameter\s*=\s*([A-Za-z0-9_-]+)\s*>([\s\S]*?)<\s*\/\s*parameter\s*>/gi;
    let match;
    while ((match = parameterPattern.exec(text))) {
        args[match[1]] = decodeParameterValue(match[2]);
    }
    return [{ name: normalizeLegacyToolName(nameMatch[1]), arguments: JSON.stringify(args) }];
}

function matchKnownToolMarkup(text, index) {
    const suffix = text.slice(index);
    const match = /^<[|/]?\s*([A-Za-z_][A-Za-z0-9_-]*)/i.exec(suffix);
    if (!match) return null;
    const key = normalizeToolKey(match[1]);
    const name = TOOL_KEY_TO_NAME.get(key);
    if (!name) return null;
    const rest = suffix.slice(match[0].length);
    if (rest === "") return { key, name, partial: true };
    if (!/^[:|\s/>]/.test(rest)) return null;
    return { key, name, partial: false };
}

function isKnownTagStart(text, index) {
    const match = matchKnownToolMarkup(text, index);
    return Boolean(match && !match.partial);
}

function isPartialTagStart(text, index) {
    const suffix = text.slice(index).toLowerCase();
    if (!suffix.startsWith("<")) return false;
    const match = matchKnownToolMarkup(text, index);
    if (match) return match.partial;
    const body = suffix.slice(1).replace(/^[|/]/, "");
    if (!body) return true;
    const bodyKey = normalizeToolKey(body);
    return KNOWN_TOOL_KEYS.size > 0 && [...KNOWN_TOOL_KEYS].some(
        key => key.startsWith(bodyKey) || bodyKey.startsWith(key)
    );
}

function findTagEnd(text, start) {
    const name = /^<\s*([A-Za-z_][A-Za-z0-9_-]*)/.exec(text.slice(start))?.[1] || "";
    const closeMarker = name ? `</${name.toLowerCase()}` : "";
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (escaped) { escaped = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if (quote) {
            if (char === quote) quote = "";
            continue;
        }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char === ">" && (text[index - 1] === "/" || text[index - 1] === "|")) return index + 1;
        if (closeMarker && char === "<" && text.slice(index).toLowerCase().startsWith(closeMarker)) {
            const closeEnd = text.indexOf(">", index);
            if (closeEnd >= 0) return closeEnd + 1;
        }
    }
    return -1;
}

function parseTagAttributes(tag) {
    const attributes = {};
    // 同时接受 mood="..." 与 energy_level=88 / hot_zones=["heart"]。
    const pattern = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s/>]+))/g;
    let match;
    while ((match = pattern.exec(tag))) {
        const key = match[1];
        let value = String(match[2] ?? match[3] ?? match[4] ?? "")
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
        if (key === "hot_zones") {
            try { value = JSON.parse(value); } catch { continue; }
        } else if (["energy_level", "pulse_bpm", "mood_level", "patience_level"].includes(key)) {
            const number = Number(value);
            if (Number.isFinite(number)) value = number;
        }
        attributes[key] = value;
    }
    return attributes;
}

function parseToolMarkupBlock(block) {
    let inner = String(block || "")
        .trim()
        .replace(/^<\s*\/?\s*\|?/, "")
        .replace(/\|?\s*>\s*$/, "")
        .trim();
    const colon = inner.indexOf(":");
    const rawName = (colon >= 0 ? inner.slice(0, colon) : inner)
        .replace(/[^A-Za-z0-9_-]+/g, "")
        .trim();
    const name = TOOL_KEY_TO_NAME.get(normalizeToolKey(rawName)) || "";
    if (!name) return null;
    let args = colon >= 0 ? inner.slice(colon + 1).trim() : "";
    args = args.replace(/\|\s*$/, "").trim();
    return { name, args };
}

function statusFromTag(tag) {
    const parsedTool = parseToolMarkupBlock(tag);
    if (parsedTool?.name === "update_companion_status" && parsedTool.args) {
        try {
            const args = JSON.parse(parsedTool.args);
            const parsed = validateCompanionStatusToolArguments(args);
            if (parsed.ok) return parsed.value;
        } catch {
            // Fall through to the legacy attribute form below.
        }
    }
    if (!/^<\s*\/?\s*\|?\s*update_companion_status\b/i.test(tag)) return null;
    const parsed = validateCompanionStatusToolArguments(parseTagAttributes(tag));
    return parsed.ok ? parsed.value : null;
}

function createVisibleToolMarkupFilter() {
    let buffer = "";
    let status = null;
    const toolCalls = [];

    function consume(final = false) {
        let output = "";
        while (buffer) {
            const start = buffer.indexOf("<");
            if (start < 0) { output += buffer; buffer = ""; break; }
            if (start > 0) { output += buffer.slice(0, start); buffer = buffer.slice(start); }
            if (isFunctionTagStart(buffer, 0)) {
                if (/^<\s*\/\s*toolcall/i.test(buffer)) {
                    const closeEnd = buffer.indexOf(">");
                    if (closeEnd >= 0) { buffer = buffer.slice(closeEnd + 1); continue; }
                    if (final) { buffer = ""; break; }
                    break;
                }
                const end = findTagEnd(buffer, 0);
                if (end < 0) {
                    if (final) { buffer = ""; break; }
                    if (buffer.length > MAX_HELD_TAG_CHARS) buffer = buffer.slice(1);
                    break;
                }
                const block = buffer.slice(0, end);
                toolCalls.push(...parseLegacyFunctionBlock(block));
                buffer = buffer.slice(end);
                continue;
            }
            if (isKnownTagStart(buffer, 0)) {
                const end = findTagEnd(buffer, 0);
                if (end < 0) {
                    if (buffer.length > MAX_HELD_TAG_CHARS) buffer = buffer.slice(1);
                    break;
                }
                const tag = buffer.slice(0, end);
                const parsed = statusFromTag(tag);
                if (parsed && !status) status = parsed;
                buffer = buffer.slice(end);
                continue;
            }
            if (!final && (isPartialTagStart(buffer, 0) || isFunctionPartialStart(buffer, 0))) break;
            output += "<";
            buffer = buffer.slice(1);
        }
        return output;
    }

    return {
        push(value) { buffer += String(value || ""); return consume(false); },
        finish() { return consume(true).replace(/\n{3,}/g, "\n\n"); },
        companionStatus() { return status; },
        toolCalls() { return toolCalls.slice(); }
    };
}

function stripVisibleToolMarkup(value) {
    const filter = createVisibleToolMarkupFilter();
    const text = filter.push(value) + filter.finish();
    return {
        text: text.replace(/\n{3,}/g, "\n\n").trim(),
        companionStatus: filter.companionStatus(),
        toolCalls: filter.toolCalls()
    };
}

module.exports = {
    KNOWN_TOOL_TAGS,
    createVisibleToolMarkupFilter,
    stripVisibleToolMarkup
};
