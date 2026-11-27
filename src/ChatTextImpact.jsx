import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sparkles, X } from "lucide-react";
import { createPortal } from "react-dom";
import { readTextImpactPreference, saveTextImpactPreference, subscribeTextImpactPreference } from "./text-impact-preferences.js";
import "./chat-text-impact.css";

export default function ChatTextImpact({ rowRef, scopeKey = "", messageId, recent = false, generating = false, reducedMotion = false, onAvatarHit }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [position, setPosition] = useState({ left: 16, top: 16, width: 252 });
  const triggerRef = useRef(null), menuRef = useRef(null);
  const completed = useRef(false);
  const playRequest = useRef(0);
  const activeStop = useRef(null);
  const preference = useSyncExternalStore(subscribeTextImpactPreference,
    () => readTextImpactPreference(scopeKey), () => readTextImpactPreference(""));

  useEffect(() => {
    completed.current = false;
    return () => {
      playRequest.current += 1;
      activeStop.current?.();
    };
  }, [scopeKey, messageId]);

  function composerGlyphs() {
    const textarea = document.querySelector(".composer textarea");
    const value = String(textarea?.value || "");
    if (!textarea || !value.trim()) return { textarea, glyphs: [] };
    const rect = textarea.getBoundingClientRect();
    if (!rect.width || !rect.height) return { textarea, glyphs: [] };
    const style = getComputedStyle(textarea);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return { textarea, glyphs: [] };
    const fontSize = parseFloat(style.fontSize) || 16;
    const font = `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily || "sans-serif"}`;
    context.font = font;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.45;
    const left = rect.left + (parseFloat(style.paddingLeft) || 0);
    const top = rect.top + (parseFloat(style.paddingTop) || 0);
    const right = rect.right - (parseFloat(style.paddingRight) || 0);
    const glyphs = [];
    let x = left;
    let y = top;
    for (const character of Array.from(value).slice(0, 360)) {
      if (character === "\n") {
        x = left;
        y += lineHeight;
        continue;
      }
      const width = Math.max(1, context.measureText(character).width);
      if (x + width > right) {
        x = left;
        y += lineHeight;
      }
      if (y + lineHeight > rect.bottom) break;
      glyphs.push({
        text: character,
        x,
        y,
        width,
        height: lineHeight,
        font,
        color: style.color || "#444"
      });
      x += width;
      if (glyphs.length >= 96) break;
    }
    return { textarea, glyphs };
  }

  async function playComposerImpact(mode) {
    const { textarea, glyphs } = composerGlyphs();
    if (!textarea) return { started: false, reason: "composer_not_found" };
    if (!glyphs.length) return { started: false, reason: "empty_input" };
    const { playTextImpact } = await import("./text-impact-player.js");
    return playTextImpact(textarea, {
      mode,
      target: mode === "burst" ? "none" : "floor",
      glyphs,
      scopeKey
    });
  }

  function extractBubbleGlyphs(container) {
    if (!container || typeof container.getBoundingClientRect !== "function") return [];
    const rect = container.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return [];
    const text = String(container.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    const style = typeof getComputedStyle === "function" ? getComputedStyle(container) : {};
    const fontSize = parseFloat(style.fontSize) || 15;
    const font = `${style.fontStyle || "normal"} ${style.fontWeight || "500"} ${fontSize}px ${style.fontFamily || "sans-serif"}`;
    const color = style.color || "#3d3338";
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.45;
    const glyphs = [];

    if (typeof document !== "undefined" && typeof document.createTreeWalker === "function" && typeof document.createRange === "function") {
      try {
        const walker = document.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
        let node = walker.nextNode();
        while (node && glyphs.length < 72) {
          const val = String(node.nodeValue || "");
          for (let i = 0; i < val.length && glyphs.length < 72; i += 1) {
            const ch = val[i];
            if (!ch || /\s/.test(ch)) continue;
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
              glyphs.push({
                text: ch,
                x: r.left,
                y: r.top,
                width: Math.max(1, r.width),
                height: Math.max(1, r.height),
                font,
                color,
              });
            }
          }
          node = walker.nextNode();
        }
      } catch {
        // Fall through to canvas layout estimation
      }
    }

    if (glyphs.length > 0) return glyphs;
    if (typeof document === "undefined" || typeof document.createElement !== "function") return [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return [];
    ctx.font = font;
    const padX = 12;
    const left = rect.left + padX;
    const right = Math.max(left + 40, rect.right - padX);
    let x = left;
    let y = rect.top + 8;
    for (const ch of Array.from(text).slice(0, 72)) {
      if (/\s/.test(ch)) {
        x += fontSize * 0.4;
        continue;
      }
      const w = Math.max(1, ctx.measureText(ch).width);
      if (x + w > right) {
        x = left;
        y += lineHeight;
      }
      if (y + lineHeight > rect.bottom + 8) break;
      glyphs.push({ text: ch, x, y, width: w, height: lineHeight, font, color });
      x += w;
    }
    return glyphs;
  }

  async function playBubbleTextImpact(mode) {
    const row = rowRef.current || triggerRef.current?.closest?.(".message-row");
    const targetEl = row?.querySelector?.(".message-content") || row?.querySelector?.(".message-bubble") || row;
    if (!targetEl) return { started: false, reason: "bubble_not_found" };

    const className = mode === "burst" ? "text-impact-bubble-burst" : "text-impact-bubble-fall";
    targetEl.classList?.remove?.("text-impact-bubble-burst", "text-impact-bubble-fall");
    void targetEl.offsetWidth;
    targetEl.classList?.add?.(className);
    let timer = 0;
    let canvasStop = null;
    const cleanup = () => {
      window.clearTimeout(timer);
      targetEl.removeEventListener?.("animationend", cleanup);
      targetEl.classList?.remove?.(className);
      canvasStop?.();
    };
    targetEl.addEventListener?.("animationend", cleanup, { once: true });
    timer = window.setTimeout(cleanup, mode === "burst" ? 900 : 1400);
    activeStop.current = cleanup;

    try {
      const glyphs = extractBubbleGlyphs(targetEl);
      if (glyphs.length > 0) {
        const { playTextImpact } = await import("./text-impact-player.js");
        const canvasResult = await playTextImpact(targetEl, {
          mode,
          target: mode === "burst" ? "none" : "floor",
          glyphs,
          scopeKey,
        });
        if (canvasResult?.stop) canvasStop = canvasResult.stop;
      }
    } catch {
      // CSS bubble animation already started and guarantees visible feedback on mobile WebView.
    }

    if (mode === "burst") {
      try { onAvatarHit?.({ messageId, mode, target: "bubble" }); } catch { /* interaction is optional */ }
    }
    return { started: true, effectiveTarget: "bubble", stop: cleanup };
  }

  async function playAvatarImpact(mode) {
    const row = rowRef.current || triggerRef.current?.closest?.(".message-row");
    const avatar = row?.querySelector?.(".message-avatar");
    const isAvatarVisible = Boolean(avatar) && (
      typeof avatar.getBoundingClientRect !== "function"
      || (() => {
        const rect = avatar.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        if (typeof getComputedStyle === "function") {
          const cs = getComputedStyle(avatar);
          if (cs?.display === "none" || cs?.visibility === "hidden" || Number(cs?.opacity) === 0) return false;
        }
        return true;
      })()
    );
    if (!isAvatarVisible) {
      const bubbleResult = await playBubbleTextImpact(mode);
      if (bubbleResult?.started) return bubbleResult;
      return { started: false, reason: "avatar_not_found" };
    }
    const className = mode === "burst" ? "text-impact-avatar-burst" : "text-impact-avatar-fall";
    avatar.classList.remove("text-impact-avatar-burst", "text-impact-avatar-fall");
    void avatar.offsetWidth;
    avatar.classList.add(className);
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      avatar.removeEventListener?.("animationend", cleanup);
      avatar.classList.remove(className);
    };
    avatar.addEventListener?.("animationend", cleanup, { once: true });
    // Safety net for background tabs / interrupted animations: the fall effect
    // must never leave an avatar transparent or missing.
    timer = window.setTimeout(cleanup, mode === "burst" ? 900 : 1600);
    activeStop.current = cleanup;
    if (mode === "burst") {
      try { onAvatarHit?.({ messageId, mode, target: "avatar" }); } catch { /* interaction is optional */ }
    }
    return { started: true, effectiveTarget: "avatar", stop: activeStop.current };
  }

  async function play(mode, target) {
    if (reducedMotion) return { started: false, reason: "reduced_motion" };
    const request = ++playRequest.current;
    try {
      const result = target === "composer"
        ? await playComposerImpact(mode)
        : target === "bubble"
          ? await playBubbleTextImpact(mode)
          : await playAvatarImpact(mode);
      if (request !== playRequest.current) {
        result?.stop?.();
        return null;
      }
      activeStop.current = result?.stop || activeStop.current;
      return result;
    } catch {
      return request === playRequest.current
        ? { started: false, reason: "exception" }
        : null;
    }
  }

  function playManually(mode) {
    const target = preference.target === "composer"
      ? "composer"
      : preference.target === "bubble"
        ? "bubble"
        : "avatar";
    saveTextImpactPreference(scopeKey, { mode, target });
    setOpen(false);
    const pending = play(mode, target);
    const request = playRequest.current;
    void pending.then(result => {
      if (request !== playRequest.current) return;
      if (!result) {
        setFeedback("没有找到可播放的内容");
        return;
      }
      if (result.started) {
        const shownTarget = result.effectiveTarget || target;
        setFeedback(shownTarget === "avatar"
          ? mode === "burst" ? "TA 的头像被弹了一下" : "TA 的头像掉下来了"
          : shownTarget === "bubble"
            ? mode === "burst" ? "消息文字弹起来了 ✨" : "消息文字散落啦 ✨"
            : mode === "burst" ? "输入框里的字弹起来了" : "输入框里的字掉下来了");
        return;
      }
      setFeedback(result.reason === "empty_input"
        ? "输入框里还没有文字（可切到「消息文字」）"
        : `动效未启动：${result.reason || "unavailable"}`);
    });
  }

  useEffect(() => {
    if (!recent || generating || completed.current) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || completed.current) return;
      completed.current = true;
      if (preference.auto && !reducedMotion) void play(preference.mode, preference.target);
    });
    return () => { cancelled = true; };
    // Only a newly completed reply can start automatic playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, generating, preference, reducedMotion, scopeKey, messageId]);

  useEffect(() => {
    if (!open) return undefined;
    const escape = event => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    const outside = event => { if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false); };
    const close = () => setOpen(false);
    const anchor = triggerRef.current?.getBoundingClientRect();
    const closeWhenAnchorMoves = event => {
      if (menuRef.current?.contains(event.target)) return;
      const next = triggerRef.current?.getBoundingClientRect();
      if (!anchor || !next || Math.abs(next.top - anchor.top) > 28 || Math.abs(next.right - anchor.right) > 28) close();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close, { passive: true });
    window.addEventListener("scroll", closeWhenAnchorMoves, { passive: true, capture: true });
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeWhenAnchorMoves, true);
    };
  }, [open]);

  if (generating || reducedMotion) return null;
  return <span className="text-impact-control">
    <button type="button" className="message-reference-button text-impact-trigger"
      ref={triggerRef} aria-expanded={open} aria-label="文字弹弹乐" onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const width = Math.min(276, window.innerWidth - 28);
        setPosition({ width, left: Math.max(14, Math.min(window.innerWidth - width - 14, rect.right - width)),
          top: Math.max(14, Math.min(window.innerHeight - 300, rect.top - 280)) });
        setOpen(value => !value); setFeedback("");
      }}>
      <Sparkles size={12} aria-hidden="true" />弹字
    </button>
    {open && createPortal(<span ref={menuRef} className="text-impact-menu" role="group" aria-label="文字弹弹乐选项"
      style={{ width: position.width, left: position.left, top: position.top }}>
      <span className="text-impact-menu-heading"><strong>文字弹弹乐</strong><button type="button" aria-label="关闭文字弹弹乐" onClick={() => setOpen(false)}><X size={14} /></button></span>
      <span className="text-impact-targets" aria-label="弹字落点">
        <button type="button" aria-label="对方头像" aria-pressed={preference.target === "avatar"} onClick={() => saveTextImpactPreference(scopeKey, { target: "avatar" })}>对方头像</button>
        <button type="button" aria-label="输入框" aria-pressed={preference.target === "composer"} onClick={() => saveTextImpactPreference(scopeKey, { target: "composer" })}>输入框</button>
        <button type="button" aria-label="消息文字" aria-pressed={preference.target === "bubble"} onClick={() => saveTextImpactPreference(scopeKey, { target: "bubble" })}>消息文字</button>
      </span>
      <span className="text-impact-modes">
        <button type="button" onClick={() => playManually("burst")}>文字弹弹</button>
        <button type="button" onClick={() => playManually("scatter")}>重力散落</button>
      </span>
      <label className="text-impact-auto"><input type="checkbox" checked={preference.auto} disabled={!scopeKey}
        onChange={event => saveTextImpactPreference(scopeKey, { auto: event.target.checked })} />新回复自动播放</label>
      <label className="text-impact-auto"><input type="checkbox" checked={preference.enabled !== false} disabled={!scopeKey}
        onChange={event => saveTextImpactPreference(scopeKey, { enabled: event.target.checked })} />让 TA 感受到弹字</label>
      <small>手机端无头像时会自动对本条消息文字播放弹字动效，原文完全保留。</small>
    </span>, document.body)}
    <span className="text-impact-feedback" role="status">{feedback}</span>
  </span>;
}
