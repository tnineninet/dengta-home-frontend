import { useEffect, useRef, useState } from "react";
import CompanionStatus from "../src/CompanionStatus.jsx";
import { createDefaultCompanionStatus, createDefaultCompanionInteractionStats, recordCompanionInteraction } from "../src/companion-status.js";
import "../src/index.css";
import "../src/cozy-theme.css";
import "../src/native-feel.css";
import "../src/apple-ui.css";
import "../src/sun-glass-ui.css";
import "../src/sun-glass-chat.css";

export function Preview() {
  const [status, setStatus] = useState(() => ({ ...createDefaultCompanionStatus(), mood: "好奇", psychology: "留意着你刚才的靠近。", feeling: "像是安静的夜晚，多了一点小小的期待。", moodLevel: 78, patienceLevel: 86, statusSource: "model" }));
  const [stats, setStats] = useState(createDefaultCompanionInteractionStats);
  const [feedback, setFeedback] = useState({ state: "idle", message: "" });
  const [failure, setFailure] = useState(false);
  const timers = useRef([]);
  const latestStats = useRef(stats);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  function interact(id) {
    timers.current.forEach(clearTimeout);
    const next = recordCompanionInteraction(latestStats.current, id);
    latestStats.current = next; setStats(next);
    setFeedback({ state: "generating", message: "" });
    timers.current = [setTimeout(() => {
      if (failure) { setFeedback({ state: "failed", message: "虚构连接中断；上次状态已保留，再点一次可重试。" }); return; }
      setStatus(current => ({ ...current, mood: next.streakCount > 3 ? "被你逗笑" : "有点惊喜", psychology: next.streakCount > 3 ? "已经认出你这一连串的小动作，忍不住想笑。" : "想看看你接下来还会怎么逗我。", feeling: next.streakCount > 3 ? "热闹里有一点反应不过来的甜。" : "刚才那一下，让这个夜晚变得轻快了。", moodLevel: Math.min(95, 78 + next.streakCount), patienceLevel: Math.max(40, 86 - next.streakCount * 2), statusSource: "model", revision: current.revision + 1 }));
      setFeedback({ state: "idle", message: "" });
    }, 800)];
    return next;
  }
  return <div className="app-shell"><main className="main-panel view-chat" style={{ minHeight: "100dvh", background: "#172941", color: "#fff8ee" }}>
    <p style={{ margin: 16, fontSize: 12 }}>本地虚构状态预览 · 不调用模型，不修改账号数据</p>
    <label style={{ display: "block", margin: 16, fontSize: 13 }}><input type="checkbox" checked={failure} onChange={event => setFailure(event.target.checked)} />模拟连接失败</label>
    <CompanionStatus aiName="小灯" aiPronoun="TA" status={status} interactionStats={stats} onChange={setStatus} onInteract={interact} isResponding={feedback.state === "generating"} interactionFeedback={feedback} />
  </main></div>;
}
