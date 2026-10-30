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
  const frameRef = useRef(0);
  const startLoopRef = useRef(() => {});

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
    startLoopRef.current();
  }, [text]);

  useEffect(() => {
    const interval = Math.max(8, Number(stepMs) || 22);
    let last = 0;
    const tick = (now) => {
      frameRef.current = 0;
      const target = targetRef.current;
      const current = shownRef.current;
      if (!target) return;
      if (!last) last = now;
      if (current !== target) {
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
          return;
        }
      }
      last = now;
      frameRef.current = globalThis.requestAnimationFrame?.(tick) || 0;
    };
    startLoopRef.current = () => {
      if (frameRef.current) return;
      frameRef.current = globalThis.requestAnimationFrame?.(tick) || 0;
    };
    startLoopRef.current();
    return () => {
      if (frameRef.current) globalThis.cancelAnimationFrame?.(frameRef.current);
      frameRef.current = 0;
    };
  }, [stepMs]);

  return <>{shown}</>;
}
