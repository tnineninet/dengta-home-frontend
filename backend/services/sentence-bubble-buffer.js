"use strict";

const DEFAULT_MAX_BUFFER_CHARS = 2000;
const DEFAULT_FIRST_BUBBLE_MAX_WAIT_MS = 1500;
const DEFAULT_MIN_BUBBLE_CHARS = 0;
const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "…"]);
const CLOSERS = new Set(["”", "’", '"', "'", "）", ")", "】", "]", "»"]);

function isStructuredStart(text) {
    const source = String(text || "").replace(/^\s+/, "");
    if (!source) return false;
    if (source.startsWith("```") || source.startsWith("~~~")) return true;
    // 列表/引用/表格：只要当前未 flush 的 buffer 里出现结构化行，
    // 就保护这段内容，避免后续标点把列表项/引用行拆开。
    return source
        .split(/\r?\n/)
        .some((line) => /^(?:[-*+]\s|\d+[.)]\s|>\s?|\|)/.test(line.trimStart()));
}

function hasFenceMarker(text) {
    // 保守保护：只要当前未 flush 的 buffer 出现代码围栏，就等 flushFinal/块结束；
    // 宁可把前面的普通句和代码块放在同一气泡，也不切碎代码块。
    return /```|~~~/.test(String(text || ""));
}

function findSentenceBoundary(text) {
    const source = String(text || "");
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (SENTENCE_END.has(char)) {
            let end = index + 1;
            while (end < source.length && CLOSERS.has(source[end])) end += 1;
            // 句末紧跟空行时把空行并入当前气泡，避免产生只含空白的空气泡。
            if (source[end] === "\n" && source[end + 1] === "\n") end += 2;
            return end;
        }
        if (char === "\n" && source[index + 1] === "\n") {
            return index + 2;
        }
    }
    return -1;
}

function findBubbleBoundary(text, minChars) {
    const source = String(text || "");
    const minimum = Math.max(0, Number(minChars) || 0);
    let offset = 0;
    while (offset < source.length) {
        const boundary = findSentenceBoundary(source.slice(offset));
        if (boundary <= 0) return -1;
        const end = offset + boundary;
        const content = source.slice(0, end);
        if (content.length >= minimum || content.includes("\n\n")) return end;
        offset = end;
    }
    return -1;
}

class SentenceBubbleBuffer {
    constructor({
        maxBufferChars = DEFAULT_MAX_BUFFER_CHARS,
        firstBubbleMaxWaitMs = DEFAULT_FIRST_BUBBLE_MAX_WAIT_MS,
        minBubbleChars = DEFAULT_MIN_BUBBLE_CHARS,
        immediate = false,
        now = Date.now
    } = {}) {
        this.maxBufferChars = Math.max(200, Number(maxBufferChars) || DEFAULT_MAX_BUFFER_CHARS);
        this.firstBubbleMaxWaitMs = Math.max(
            200,
            Number(firstBubbleMaxWaitMs) || DEFAULT_FIRST_BUBBLE_MAX_WAIT_MS
        );
        this.minBubbleChars = Math.max(
            0,
            Number(minBubbleChars) || DEFAULT_MIN_BUBBLE_CHARS
        );
        this.now = typeof now === "function" ? now : Date.now;
        this.immediate = immediate === true;
        this.buffer = "";
        this.bufferStartedAt = null;
        this.firstBubbleEmitted = false;
        this.bubbleIndex = 0;
        this.boundaries = [];
        this.emittedChars = 0;
        this.segments = [];
        this.currentBubbleChars = 0;
        this.currentBubbleText = "";
    }

    _isProtected() {
        return isStructuredStart(this.buffer) || hasFenceMarker(this.buffer);
    }

    _emit(content, final) {
        const text = String(content || "");
        if (!text || !text.trim()) return null;
        this.emittedChars += text.length;
        this.boundaries.push(this.emittedChars);
        this.segments.push(text);
        const event = {
            type: "text",
            content: text,
            bubble_index: this.bubbleIndex,
            final: final === true
        };
        this.bubbleIndex += 1;
        this.firstBubbleEmitted = true;
        this.bufferStartedAt = null;
        return event;
    }

    _emitWholeBuffer(final) {
        if (!this.buffer) return [];
        const event = this._emit(this.buffer, final);
        this.buffer = "";
        return event ? [event] : [];
    }

    _sealImmediateBubble() {
        if (!this.currentBubbleText) return;
        this.boundaries.push(this.emittedChars);
        this.segments.push(this.currentBubbleText);
        this.bubbleIndex += 1;
        this.currentBubbleChars = 0;
        this.currentBubbleText = "";
    }

    _pushImmediate(text) {
        let content = String(text || "");
        if (!content) return [];
        if (!this.currentBubbleText) {
            // Do not let blank lines at a bubble boundary create a visually
            // empty top half in the next bubble.
            content = content.replace(/^\s+/u, "");
            if (!content) return [];
        }
        this.bufferStartedAt = null;
        this.emittedChars += content.length;
        this.currentBubbleChars += content.length;
        this.currentBubbleText += content;
        this.firstBubbleEmitted = true;
        const event = {
            type: "text",
            content,
            bubble_index: this.bubbleIndex,
            final: false
        };
        const paragraphBreak = content.includes("\n\n");
        const sentenceBoundary = findSentenceBoundary(content) > 0;
        if (
            paragraphBreak ||
            (sentenceBoundary && this.currentBubbleChars >= this.minBubbleChars) ||
            this.currentBubbleChars >= this.maxBufferChars
        ) {
            this._sealImmediateBubble();
        }
        return [event];
    }

    push(delta) {
        const text = String(delta || "");
        if (!text) return [];
        if (this.immediate) return this._pushImmediate(text);
        if (this.bufferStartedAt === null) this.bufferStartedAt = this.now();
        this.buffer += text;
        const events = [];
        while (this.buffer && !this._isProtected()) {
            const boundary = findBubbleBoundary(
                this.buffer,
                this.minBubbleChars
            );
            if (boundary <= 0) break;
            const content = this.buffer.slice(0, boundary);
            this.buffer = this.buffer.slice(boundary);
            const event = this._emit(content, false);
            if (event) events.push(event);
            if (this.buffer) this.bufferStartedAt = this.now();
        }
        // 模型长时间不输出标点时，避免 buffer 无限增长；代码/列表块不强制切。
        if (
            this.buffer &&
            !this._isProtected() &&
            this.buffer.length >= this.maxBufferChars
        ) {
            const event = this._emit(this.buffer, false);
            this.buffer = "";
            if (event) events.push(event);
        }
        return events;
    }

    nextFlushDelay(now = this.now()) {
        if (this.immediate) return null;
        if (!this.buffer || this._isProtected()) return null;
        if (this.buffer.length >= this.maxBufferChars) return 0;
        if (this.firstBubbleEmitted || this.bufferStartedAt === null) return null;
        const remaining =
            this.firstBubbleMaxWaitMs -
            (typeof now === "number" ? now : this.now()) +
            this.bufferStartedAt;
        return Math.max(0, remaining);
    }

    flushDue(now = this.now()) {
        if (this.immediate) return [];
        if (!this.buffer) return [];
        if (this._isProtected()) return [];
        const current = typeof now === "number" ? now : this.now();
        const waited =
            this.bufferStartedAt === null
                ? 0
                : current - this.bufferStartedAt;
        const tooLong = this.buffer.length >= this.maxBufferChars;
        const firstTooSlow =
            !this.firstBubbleEmitted &&
            waited >= this.firstBubbleMaxWaitMs;
        if (!tooLong && !firstTooSlow) return [];
        const event = this._emit(this.buffer, false);
        this.buffer = "";
        return event ? [event] : [];
    }

    flushFinal() {
        if (this.immediate) {
            this._sealImmediateBubble();
            return [];
        }
        return this._emitWholeBuffer(true);
    }

    hasPending() {
        return this.immediate ? false : this.buffer.length > 0;
    }

    getState() {
        return {
            version: 1,
            count: this.boundaries.length,
            boundaries: [...this.boundaries]
        };
    }

    getSegments() {
        return [...this.segments];
    }
}

module.exports = {
    DEFAULT_MAX_BUFFER_CHARS,
    DEFAULT_FIRST_BUBBLE_MAX_WAIT_MS,
    DEFAULT_MIN_BUBBLE_CHARS,
    SentenceBubbleBuffer,
    findSentenceBoundary,
    hasFenceMarker,
    isStructuredStart
};
