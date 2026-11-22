import { useMemo } from "react";
import "./xinchao-capsule.css";

const DRIVE_LABELS = {
  possess: "想靠近",
  monitor: "惦记",
  share: "想分享",
  libido: "渴望",
  curiosity: "好奇",
  social: "想聊",
  crave: "馋",
  boredom: "空落",
  reflection: "想心事",
  grieve: "难过",
  anger: "生气",
  safety: "安全感",
  confidence: "自信"
};

function shortNumber(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
}

export default function XinchaoCapsule({ state }) {
  const drives = useMemo(
    () =>
      Object.entries(state?.drives || {})
        .map(([key, value]) => ({
          key,
          label: DRIVE_LABELS[key] || key,
          value: Number(value) || 0
        }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 5),
    [state]
  );
  const top = drives[0];
  const emotion = state?.emotion?.label || "平静";
  const description = drives.length
    ? `${emotion} · ${drives
        .map((drive) => `${drive.label}${shortNumber(drive.value)}`)
        .join(" / ")}`
    : `${emotion} · 心潮`;

  return (
    <span className="xinchao-capsule" title={description} aria-label={description}>
      <span className="xinchao-capsule-petals" aria-hidden="true">
        {drives.map((drive, index) => (
          <span
            className="xinchao-capsule-petal"
            key={drive.key}
            style={{
              "--xinchao-level": Math.max(0.08, drive.value),
              "--xinchao-index": index
            }}
          />
        ))}
      </span>
      <span className="xinchao-capsule-copy">
        <small>{emotion}</small>
        <strong>{top ? top.label : "心潮"}</strong>
      </span>
      <span className="xinchao-capsule-revision" aria-hidden="true">
        {state?.revision ? `#${state.revision}` : ""}
      </span>
    </span>
  );
}
