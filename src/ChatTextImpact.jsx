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

  function playAvatarImpact(mode) {
    const row = rowRef.current || triggerRef.current?.closest?.(".message-row");
    const avatar = row?.querySelector(".message-avatar");
    if (!avatar) return { started: false, reason: "avatar_not_found" };
    const className = mode === "burst" ? "text-impact-avatar-burst" : "text-impact-avatar-fall";
    avatar.classList.remove("text-impact-avatar-burst", "text-impact-avatar-fall");
    void avatar.offsetWidth;
    avatar.classList.add(className);
    const cleanup = () => avatar.classList.remove(className);
    const timer = window.setTimeout(cleanup, mode === "burst" ? 620 : 1050);
    activeStop.current = () => {
      window.clearTimeout(timer);
      cleanup();
    };
    if (mode === "burst") {
      try { onAvatarHit?.({ messageId, mode, target: "avatar" }); } catch { /* interaction is optional */ }
    }
    return { started: true, stop: activeStop.current };
  }

  async function play(mode, target) {
    if (reducedMotion) return { started: false, reason: "reduced_motion" };
    const request = ++playRequest.current;
    try {
      const result = target === "composer"
        ? await playComposerImpact(mode)
        : playAvatarImpact(mode);
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
    const target = preference.target === "composer" ? "composer" : "avatar";
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
        setFeedback(target === "avatar"
          ? mode === "burst" ? "TA 的头像被弹了一下" : "TA 的头像掉下来了"
          : mode === "burst" ? "输入框里的字弹起来了" : "输入框里的字掉下来了");
        return;
      }
      setFeedback(result.reason === "empty_input"
        ? "输入框里还没有内容"
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
      if (!anchor || !next || Math.abs(next.top - anchor.top) > 1 || Math.abs(next.right - anchor.right) > 1) close();
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
        const width = Math.min(252, window.innerWidth - 32);
        setPosition({ width, left: Math.max(16, Math.min(window.innerWidth - width - 16, rect.right - width)),
          top: Math.max(16, Math.min(window.innerHeight - 290, rect.top - 270)) });
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
      </span>
      <span className="text-impact-modes">
        <button type="button" onClick={() => playManually("burst")}>文字弹弹</button>
        <button type="button" onClick={() => playManually("scatter")}>重力散落</button>
      </span>
      <label className="text-impact-auto"><input type="checkbox" checked={preference.auto} disabled={!scopeKey}
        onChange={event => saveTextImpactPreference(scopeKey, { auto: event.target.checked })} />新回复自动播放</label>
      <label className="text-impact-auto"><input type="checkbox" checked={preference.enabled !== false} disabled={!scopeKey}
        onChange={event => saveTextImpactPreference(scopeKey, { enabled: event.target.checked })} />让 TA 感受到弹字</label>
      <small>仅播放动效，原消息和输入内容都会保留。</small>
    </span>, document.body)}
    <span className="text-impact-feedback" role="status">{feedback}</span>
  </span>;
}
