import { useEffect, useRef, useState } from "react";

// 通用打字机组件：把文本按字逐字显示（默认 22ms/字）。
// text 变化时自动从头重新打字；onDone 在整段打完时回调。
export default function TypewriterText({ text, stepMs = 22, onDone }) {
  const [shown, setShown] = useState("");
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const full = String(text || "");
    if (!full) {
      const reset = globalThis.requestAnimationFrame?.(() => setShown("")) || 0;
      onDoneRef.current?.();
      return () => { if (reset) globalThis.cancelAnimationFrame?.(reset); };
    }
    let frame = 0;
    let startedAt = 0;
    let done = false;
    const interval = Math.max(8, Number(stepMs) || 22);
    // Re-render at most once per animation frame instead of once per character.
    // This keeps long moments/nursery text smooth on phones.
    const tick = (now) => {
      if (done) return;
      if (!startedAt) startedAt = now;
      const count = Math.min(full.length, Math.max(1, Math.floor((now - startedAt) / interval)));
      setShown((current) => {
        const next = full.slice(0, count);
        return next === current ? current : next;
      });
      if (count >= full.length) {
        done = true;
        onDoneRef.current?.();
        return;
      }
      frame = globalThis.requestAnimationFrame?.(tick) || 0;
    };
    frame = globalThis.requestAnimationFrame?.(tick) || 0;
    if (!frame) setShown(full);
    return () => {
      done = true;
      if (frame) globalThis.cancelAnimationFrame?.(frame);
    };
  }, [text, stepMs]);
  return <>{shown}</>;
}
