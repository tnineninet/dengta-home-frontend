import { useRef, useState } from "react";
import {
  confirmXhsWrite,
  newXhsIdempotencyKey,
  previewXhsWrite,
} from "./xhs-write-confirmation.js";

const DEFAULT_OPERATIONS = {
  preview: previewXhsWrite,
  confirm: confirmXhsWrite,
};

function errorText(error) {
  if (error?.code === "xhs_idempotency_conflict") return "幂等冲突：请取消后重新预览。";
  if (error?.code === "xhs_write_token_expired") return "确认已过期，请重新预览。";
  if (error?.code === "xhs_write_token_reused") return "这次确认已经使用过，请重新预览。";
  return error?.message || "小红书发布失败，请重试。";
}

export default function XhsPublishPanel({ operations = DEFAULT_OPERATIONS }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState("");
  const [tags, setTags] = useState("");
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [feedback, setFeedback] = useState("");
  const keyRef = useRef("");
  const requestRef = useRef(0);
  const busy = status === "previewing" || status === "confirming";

  function cancel() {
    requestRef.current += 1;
    setPreview(null);
    setStatus("idle");
    setFeedback("");
    keyRef.current = "";
  }

  async function handlePreview(event) {
    event.preventDefault();
    if (busy) return;
    setStatus("previewing");
    setFeedback("");
    const request = ++requestRef.current;
    try {
      const receipt = await operations.preview({
        action: "publish",
        title: title.trim(),
        content: content.trim(),
        images: images.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
        tags: tags.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      });
      if (request !== requestRef.current) return;
      if (!receipt?.confirmation_token) throw new Error("没有收到发布确认令牌。");
      setPreview(receipt);
      keyRef.current = newXhsIdempotencyKey();
      setStatus("preview_ready");
    } catch (error) {
      if (request !== requestRef.current) return;
      setStatus("error");
      setFeedback(errorText(error));
    }
  }

  async function handleConfirm() {
    if (!preview || busy) return;
    const request = ++requestRef.current;
    setStatus("confirming");
    setFeedback("");
    if (!keyRef.current) keyRef.current = newXhsIdempotencyKey();
    try {
      const receipt = await operations.confirm({
        confirmationToken: preview.confirmation_token,
        idempotencyKey: keyRef.current,
      });
      if (request !== requestRef.current) return;
      setStatus(receipt?.replayed ? "replayed" : "success");
    } catch (error) {
      if (request !== requestRef.current) return;
      setStatus("error");
      setFeedback(errorText(error));
    }
  }

  return (
    <section className="xhs-write-panel" aria-label="小红书图文发布">
      <div className="xhs-write-heading">
        <div>
          <strong>小红书图文发布</strong>
          <span>只生成草稿预览，确认后才调用发布接口；图片仅允许公开 https 链接</span>
        </div>
      </div>
      {!preview ? (
        <form className="xhs-write-form" onSubmit={handlePreview}>
          <label><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} /></label>
          <label><span>正文</span><textarea value={content} onChange={(event) => setContent(event.target.value)} rows={3} maxLength={2000} /></label>
          <label><span>图片 https 链接（每行一张，最多 9 张）</span><textarea value={images} onChange={(event) => setImages(event.target.value)} rows={2} /></label>
          <label><span>标签（逗号分隔）</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
          <div className="xhs-write-actions">
            <button type="submit" disabled={busy}>{status === "previewing" ? "正在准备草稿…" : "生成发布预览"}</button>
          </div>
        </form>
      ) : (
        <div className="xhs-write-preview" aria-label="小红书发布预览卡">
          <div className="xhs-write-preview-head">
            <strong>{preview.summary || "小红书图文草稿"}</strong>
            <span>{preview.expires_at ? `确认有效期至 ${new Date(preview.expires_at).toLocaleTimeString("zh-CN")}` : "等待确认"}</span>
          </div>
          <p>标题：{preview.preview?.title || title}</p>
          <p>图片：{preview.preview?.images?.length || 0} 张</p>
          <div className="xhs-write-actions">
            <button type="button" onClick={handleConfirm} disabled={busy}>
              {status === "confirming" ? "正在发布…" : "确认发布"}
            </button>
            <button type="button" className="xhs-write-secondary" onClick={cancel} disabled={busy}>取消</button>
          </div>
          {status === "success" ? <p className="xhs-write-success" role="status">已提交发布。</p> : null}
          {status === "replayed" ? <p className="xhs-write-success" role="status">已返回同一幂等收据，没有重复发布。</p> : null}
          {status === "error" && feedback ? <p className="xhs-write-error" role="alert">{feedback}</p> : null}
        </div>
      )}
      {!preview && feedback ? <p className="xhs-write-error" role="alert">{feedback}</p> : null}
    </section>
  );
}
