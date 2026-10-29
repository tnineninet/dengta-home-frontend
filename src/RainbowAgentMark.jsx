import { useState } from "react";

// The 288-frame, 426KB animated WebP is too expensive to decode continuously
// (especially on Android). Use a 15KB static first frame by default and only
// start the animation on pointer hover, where it is a deliberate interaction.
export default function RainbowAgentMark() {
  const [animate, setAnimate] = useState(false);

  function startAnimation(event) {
    if (event?.pointerType && event.pointerType !== "mouse") return;
    const hoverPointer =
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
    if (!hoverPointer) return;
    const reduceMotion =
      (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) ||
      document.documentElement.dataset.dengtaReducedMotion === "true";
    if (reduceMotion) return;
    setAnimate(true);
  }

  return (
    <span
      className="rainbow-agent-mark"
      aria-hidden="true"
      onPointerEnter={startAnimation}
      onPointerLeave={() => setAnimate(false)}
    >
      <img
        className="rainbow-agent-mark-reference"
        src={
          animate
            ? "/assets/rainbow-agent-mark.webp"
            : "/assets/rainbow-agent-mark-static.png"
        }
        width="92"
        height="92"
        alt=""
        draggable="false"
      />
      <span className="rainbow-agent-mark-glint" />
    </span>
  );
}
