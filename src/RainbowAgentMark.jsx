export default function RainbowAgentMark() {
  return (
    <span className="rainbow-agent-mark" aria-hidden="true">
      <img
        className="rainbow-agent-mark-reference"
        src="/assets/rainbow-agent-mark.webp"
        alt=""
        draggable="false"
      />
      <span className="rainbow-agent-mark-glint" />
    </span>
  );
}
