import { useState } from "react";
import { readXhsNotifications } from "./xhs-write-confirmation.js";

const DEFAULT_OPERATIONS = { read: readXhsNotifications };

function formatCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

export default function XhsNotificationsPanel({ operations = DEFAULT_OPERATIONS }) {
  const [state, setState] = useState("idle");
  const [unread, setUnread] = useState(null);
  const [items, setItems] = useState([]);
  const [feedback, setFeedback] = useState("");
  async function load() {
    if (state === "loading") return;
    setState("loading");
    setFeedback("");
    try {
      const receipt = await operations.read();
      setUnread(receipt?.unread || null);
      setItems(Array.isArray(receipt?.list?.notifications) ? receipt.list.notifications : []);
      setState("ready");
    } catch (error) {
      setState("error");
      setFeedback(
        error?.code === "xhs_action_not_supported"
          ? "当前小红书服务尚未支持通知。"
          : error?.message || "小红书通知读取失败。",
      );
    }
  }
  return (
    <section className="xhs-write-panel" aria-label="小红书通知">
      <div className="xhs-write-heading">
        <div>
          <strong>小红书通知</strong>
          <span>只读通知列表；回复/点赞通知后续走确认流程</span>
        </div>
      </div>
      <div className="xhs-write-actions">
        <button type="button" onClick={load} disabled={state === "loading"}>
          {state === "loading" ? "正在读取…" : "读取通知"}
        </button>
      </div>
      {state === "ready" ? (
        <div className="xhs-write-preview" aria-label="小红书通知列表">
          <div className="xhs-write-preview-head">
            <strong>未读汇总</strong>
            <span>
              评论/at {formatCount(unread?.comments)} · 点赞/收藏 {formatCount(unread?.likes)} · 关注 {formatCount(unread?.follows)}
            </span>
          </div>
          {items.length ? items.slice(0, 10).map((item) => (
            <p key={item.id || `${item.type}-${item.content}`}>
              {item.type || "通知"}：{String(item.content || "").slice(0, 120)}
            </p>
          )) : <p>暂无通知。</p>}
        </div>
      ) : null}
      {state === "error" && feedback ? <p className="xhs-write-error" role="alert">{feedback}</p> : null}
    </section>
  );
}
