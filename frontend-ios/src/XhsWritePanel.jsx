import { useRef, useState } from "react";
import {
  confirmXhsWrite,
  newXhsIdempotencyKey,
  previewXhsWrite,
} from "./xhs-write-confirmation.js";
import "./xhs-write.css";

const ACTIONS = [
  { id: "like", label: "点赞笔记", target: "note" },
  { id: "comment", label: "评论笔记", target: "note", content: true },
  { id: "favorite", label: "收藏笔记", target: "note" },
  { id: "follow", label: "关注用户", target: "user" },
  { id: "reply", label: "回复评论", target: "note", content: true, comment: true },
];
const DEFAULT_OPERATIONS = {
  preview: previewXhsWrite,
  confirm: confirmXhsWrite,
};

function feedbackFor(error, fallback) {
  const code = String(error?.code || "");
  if (code === "xhs_idempotency_conflict") {
    return "这个幂等键已经用于另一条写操作，请重新预览。";
  }
  if (code === "xhs_write_token_reused") {
    return "这次确认已经使用过，请重新预览。";
  }
  if (code === "xhs_write_token_expired") {
    return "确认已过期，请重新预览。";
  }
  return String(error?.message || fallback || "小红书操作失败，请重试。");
}

export default function XhsWritePanel({ scope = "", operations = DEFAULT_OPERATIONS }) {
  const [action, setAction] = useState("like");
  const [target, setTarget] = useState("");
  const [content, setContent] = useState("");
  const [commentId, setCommentId] = useState("");
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState(null);
  const idempotencyKeyRef = useRef("");
  const requestRef = useRef(0);
  const definition = ACTIONS.find((item) => item.id === action) || ACTIONS[0];
  const busy = status === "previewing" || status === "confirming";

  function reset() {
    requestRef.current += 1;
    setPreview(null);
    setStatus("idle");
    setFeedback("");
    setResult(null);
    idempotencyKeyRef.current = "";
  }

  async function handlePreview(event) {
    event.preventDefault();
    if (busy || !target.trim()) {
      setFeedback(definition.target === "user" ? "请填写小红书用户 ID 或主页链接。" : "请填写小红书笔记 ID 或链接。");
      return;
    }
    const request = ++requestRef.current;
    setStatus("previewing");
    setFeedback("");
    setResult(null);
    try {
      const receipt = await operations.preview({
        action,
        ...(definition.target === "note"
          ? { note_id: target.trim() }
          : { user_id: target.trim() }),
        ...(definition.content ? { content: content.trim() } : {}),
        ...(definition.comment ? { comment_id: commentId.trim() } : {}),
      });
      if (request !== requestRef.current) return;
      if (!receipt?.confirmation_token) throw new Error("小红书没有返回有效确认令牌。");
      setPreview(receipt);
      idempotencyKeyRef.current = newXhsIdempotencyKey();
      setStatus("preview_ready");
    } catch (error) {
      if (request !== requestRef.current) return;
      setStatus("error");
      setFeedback(feedbackFor(error, "无法生成小红书操作预览。"));
    }
  }

  async function handleConfirm() {
    if (!preview || busy) return;
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newXhsIdempotencyKey();
    const request = ++requestRef.current;
    setStatus("confirming");
    setFeedback("");
    try {
      const receipt = await operations.confirm({
        confirmationToken: preview.confirmation_token,
        idempotencyKey: idempotencyKeyRef.current,
      });
      if (request !== requestRef.current) return;
      setResult(receipt);
      setStatus(receipt?.replayed ? "replayed" : "success");
    } catch (error) {
      if (request !== requestRef.current) return;
      const code = String(error?.code || "");
      setStatus(
        code === "xhs_idempotency_conflict" || code === "xhs_write_token_reused"
          ? "conflict"
          : "error",
      );
      setFeedback(feedbackFor(error, "小红书写操作失败。"));
    }
  }

  return (
    <section className="xhs-write-panel" aria-label="小红书操作确认" data-scope={scope || undefined}>
      <div className="xhs-write-heading">
        <div>
          <strong>小红书操作确认</strong>
          <span>{busy ? "正在处理后端确认…" : "先预览，再确认；AI 不能自动执行写操作"}</span>
        </div>
      </div>

      {!preview ? (
        <form className="xhs-write-form" onSubmit={handlePreview}>
          <label>
            <span>操作</span>
            <select value={action} onChange={(event) => { setAction(event.target.value); setFeedback(""); }}>
              {ACTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>{definition.target === "user" ? "用户 ID / 主页链接" : "笔记 ID / 链接"}</span>
            <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="粘贴目标 ID 或链接" />
          </label>
          {definition.content ? (
            <label>
              <span>内容</span>
              <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} rows={2} />
            </label>
          ) : null}
          {definition.comment ? (
            <label>
              <span>目标评论 ID</span>
              <input value={commentId} onChange={(event) => setCommentId(event.target.value)} />
            </label>
          ) : null}
          <div className="xhs-write-actions">
            <button type="submit" disabled={busy}>{status === "previewing" ? "正在预览…" : "生成预览卡"}</button>
          </div>
        </form>
      ) : (
        <div className="xhs-write-preview" aria-label="小红书写操作预览卡">
          <div className="xhs-write-preview-head">
            <strong>{preview.summary || "小红书写操作"}</strong>
            <span>{preview.expires_at ? `确认有效期至 ${new Date(preview.expires_at).toLocaleTimeString("zh-CN")}` : "需要用户确认"}</span>
          </div>
          <p>目标：{preview.target_id || target}</p>
          <div className="xhs-write-actions">
            {status === "preview_ready" || status === "confirming" || status === "error" || status === "conflict" ? (
              <button type="button" onClick={handleConfirm} disabled={busy}>
                {status === "confirming" ? "正在确认…" : "确认执行一次"}
              </button>
            ) : null}
            <button type="button" className="xhs-write-secondary" onClick={reset} disabled={busy}>
              取消
            </button>
          </div>
          {status === "success" ? <p className="xhs-write-success" role="status">操作已完成。</p> : null}
          {status === "replayed" ? <p className="xhs-write-success" role="status">已返回同一幂等收据，没有重复执行。</p> : null}
          {status === "conflict" ? <p className="xhs-write-error" role="alert">幂等冲突：请取消并重新预览。</p> : null}
          {status === "error" && feedback ? <p className="xhs-write-error" role="alert">{feedback}</p> : null}
        </div>
      )}

      {!preview && feedback ? <p className="xhs-write-error" role="alert">{feedback}</p> : null}
      {result ? <small className="xhs-write-result">操作回执：{result.action || preview?.action || "已确认"}</small> : null}
    </section>
  );
}
