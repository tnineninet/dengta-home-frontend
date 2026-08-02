import { useId } from "react";

export default function RainbowAgentMark() {
  const gradientId = useId().replace(/:/g, "");

  return (
    <span className="rainbow-agent-mark" aria-hidden="true">
      <span className="rainbow-agent-mark-lens">
        <span className="rainbow-agent-mark-caustic" />
        <svg
          className="rainbow-agent-mark-star"
          viewBox="0 0 64 64"
          focusable="false"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop className="rainbow-star-stop rainbow-star-stop-top" offset="0" />
              <stop className="rainbow-star-stop rainbow-star-stop-middle" offset="0.52" />
              <stop className="rainbow-star-stop rainbow-star-stop-bottom" offset="1" />
            </linearGradient>
          </defs>
          <path
            fill={`url(#${gradientId})`}
            d="M32 5C35.1 20.2 42.5 28.5 58 32c-15.5 3.5-22.9 11.8-26 27-3.1-15.2-10.5-23.5-26-27 15.5-3.5 22.9-11.8 26-27Z"
          />
        </svg>
      </span>
    </span>
  );
}
