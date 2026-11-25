import { useMemo } from "react";
import { X } from "lucide-react";
import {
  XINCHAO_DRIVE_LABELS,
  localizeConsciousness,
  localizeXinchaoEmotion,
} from "./emotion-state";

function percent(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
}

export default function XinchaoDetails({ state, aiName = "TA", onClose, style, rootRef, inline = false }) {
  const drives = useMemo(
    () =>
      Object.entries(state?.drives || {})
        .map(([key, value]) => ({
          key,
          label: XINCHAO_DRIVE_LABELS[key] || key,
          value: Number(value) || 0,
        }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 7),
    [state],
  );
  const emotion = localizeXinchaoEmotion(state?.emotion?.label);
  const consciousnessText = localizeConsciousness(state?.consciousness);
  const lastTalk = state?.lastConversationAt
    ? new Date(state.lastConversationAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div
      ref={rootRef}
      className={`xinchao-details${inline ? " is-inline" : ""}`}
      style={style}
      role={inline ? "region" : "dialog"}
      aria-modal={inline ? undefined : false}
      aria-label={`${aiName}的心潮状态`}
    >
      <header className="xinchao-details-header">
        <div>
          <small>{aiName} · 心潮起伏</small>
          <strong>{emotion}</strong>
        </div>
        {typeof onClose === "function" && (
          <button type="button" aria-label="关闭心潮详情" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="xinchao-details-drives">
        {drives.map((drive) => (
          <div className="xinchao-details-drive" key={drive.key}>
            <span>{drive.label}</span>
            <span className="xinchao-details-track" aria-hidden="true">
              <span style={{ width: `${percent(drive.value)}%` }} />
            </span>
            <b>{percent(drive.value)}</b>
          </div>
        ))}
      </div>
      <footer className="xinchao-details-meta">
        <span>{consciousnessText}</span>
        {lastTalk && <span>上次细聊 {lastTalk}</span>}
        {state?.revision ? <span>第 {state.revision} 次心绪起伏</span> : null}
      </footer>
    </div>
  );
}
