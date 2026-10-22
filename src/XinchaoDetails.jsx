import { useMemo } from "react";
import { X } from "lucide-react";

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
  duty: "责任",
  safety: "安全感",
  confidence: "自信",
  favored: "被偏爱"
};

function percent(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
}

export default function XinchaoDetails({ state, aiName = "TA", onClose, style, rootRef }) {
  const drives = useMemo(
    () =>
      Object.entries(state?.drives || {})
        .map(([key, value]) => ({
          key,
          label: DRIVE_LABELS[key] || key,
          value: Number(value) || 0
        }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 7),
    [state]
  );
  const emotion = state?.emotion?.label || "平静";
  const lastTalk = state?.lastConversationAt
    ? new Date(state.lastConversationAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "";

  return (
    <div ref={rootRef} className="xinchao-details" style={style} role="dialog" aria-modal="false" aria-label={`${aiName}的心潮状态`}>
      <header className="xinchao-details-header">
        <div>
          <small>{aiName} · 心潮</small>
          <strong>{emotion}</strong>
        </div>
        <button type="button" aria-label="关闭心潮详情" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
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
        <span>{state?.consciousness === "awake" ? "此刻醒着" : state?.consciousness || "心潮流动"}</span>
        {lastTalk && <span>上次聊天 {lastTalk}</span>}
        {state?.revision ? <span>revision {state.revision}</span> : null}
      </footer>
    </div>
  );
}
