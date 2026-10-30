import { useEffect, useRef, useState } from "react";

// 通用打字机组件：把文本按字逐字显示（默认 22ms/字）。
// Streaming text arrives in small chunks. A naive effect restarts the
// animation from character 0 on every chunk, which makes a fast stream look
// like it is crawling. Keep one animation loop and only append new characters
// when the incoming text extends what is already shown.
export default function TypewriterText({ text, stepMs = 22, onDone }) {
  const [shown, setShown] = useState("");
  const onDoneRef = useRef(onDone);
  const targetRef = useRef("");
  const shownRef = useRef("");
  const doneRef = useRef(false);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const full = String(text || "");
    const current = shownRef.current;
    if (!full) {
      shownRef.current = "";
      targetRef.current = "";
      doneRef.current = false;
      const reset = globalThis.requestAnimationFrame?.(() => setShown("")) || 0;
      onDoneRef.current?.();
      return () => {
        if (reset) globalThis.cancelAnimationFrame?.(reset);
      };
    }
    if (!full.startsWith(current)) {
      shownRef.current = "";
      globalThis.requestAnimationFrame?.(() => setShown(""));
    }
    targetRef.current = full;
    doneRef.current = false;
  }, [text]);

  useEffect(() => {
    const interval = Math.max(8, Number(stepMs) || 22);
    let frame = 0;
    let last = 0;
    const tick = (now) => {
      if (!last) last = now;
      const target = targetRef.current;
      const current = shownRef.current;
      if (target && current !== target) {
        const room = Math.max(1, Math.floor((now - last) / interval));
        const next = target.slice(
          0,
          Math.min(target.length, current.length + room)
        );
        if (next !== current) {
          shownRef.current = next;
          setShown(next);
        }
        if (next === target && !doneRef.current) {
          doneRef.current = true;
          onDoneRef.current?.();
        }
      }
      last = now;
      frame = globalThis.requestAnimationFrame?.(tick) || 0;
    };
    frame = globalThis.requestAnimationFrame?.(tick) || 0;
    if (!frame && targetRef.current) {
      shownRef.current = targetRef.current;
      setShown(targetRef.current);
    }
    return () => {
      if (frame) globalThis.cancelAnimationFrame?.(frame);
    };
  }, [stepMs]);

  return <>{shown}</>;
}
