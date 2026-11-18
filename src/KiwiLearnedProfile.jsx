import { useCallback, useEffect, useRef, useState } from "react";
import { useMemoryUiRequest, memoryUiFailure } from "./memory-ui-feedback.js";
import { kiwiProfileReceipt } from "./kiwi-memory-receipt.js";
import { formatMemorySummaryDate, readMemorySummaryJson } from "./memory-summary-feedback.js";
import "./memory-summary-list.css";

export default function KiwiLearnedProfile(props) {
  return <ScopedKiwiProfile key={props.scopeKey} {...props} />;
}

function ScopedKiwiProfile({ scopeKey }) {
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState(() => ({ pending: new Set(), outcome: "" }));
  const version = useRef(0);
  const requested = useRef(false);
  const refresh = useCallback(async () => {
    if (!isCurrent()) return;
    requested.current = true;
    const current = ++version.current;
    setBusy(true);
    try {
      const data = await request("/api/v2/memory/profile", { responseReader: readMemorySummaryJson });
      if (!isCurrent() || version.current !== current) return;
      setReceipt(kiwiProfileReceipt(data));
      setError("");
    } catch (failure) {
      if (isCurrent() && version.current === current) setError(memoryUiFailure(failure));
    } finally {
      if (isCurrent() && version.current === current) setBusy(false);
    }
  }, [request, isCurrent]);
  useEffect(() => {
    const changed = event => {
      if (event.detail?.scopeKey !== scopeKey || !isCurrent()) return;
      const { source, jobId } = event.detail;
      if (["chat-job-accepted", "chat-job-succeeded", "chat-job-failed", "chat-job-cancelled", "chat-job-unconfirmed"].includes(source)) {
        setJobs(previous => {
          const pending = new Set(previous.pending);
          if (source === "chat-job-accepted") pending.add(jobId);
          else pending.delete(jobId);
          return { pending, outcome: source };
        });
      }
      if (requested.current && ["chat-job-succeeded", "consolidated"].includes(source)) void refresh();
    };
    window.addEventListener("dengta:memory-updated", changed);
    return () => { version.current += 1; window.removeEventListener("dengta:memory-updated", changed); };
  }, [refresh, scopeKey, isCurrent]);
  return <section className="kiwi-learned-profile" aria-label="Kiwi 自动画像与对话摘要">
    <div className="memory-source-heading"><div><span className="eyebrow">KIWI</span><h3>自动画像与对话摘要</h3></div><button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "读取中…" : receipt ? "刷新画像与摘要" : "查看画像与摘要"}</button></div>
    <p>这里展示 Kiwi 从聊天整理的结果。你手动填写的「个性化指令」和「你的详情」在设置中编辑。</p>
    {jobs.pending.size > 0 && <p role="status">聊天记忆正在整理中。{receipt ? "下方是上次确认的画像与摘要。" : "尚未确认这次整理的结果。"}</p>}
    {["chat-job-failed", "chat-job-cancelled", "chat-job-unconfirmed"].includes(jobs.outcome) && <p role="status">{({ "chat-job-failed": "最近一次聊天整理失败。", "chat-job-cancelled": "最近一次聊天整理已取消。", "chat-job-unconfirmed": "最近一次聊天整理结果尚未确认。" })[jobs.outcome]}{receipt ? "仍显示上次确认的画像与摘要。" : "尚未确认画像或摘要有变化。"}</p>}
    {error && <p role="alert">{error}{receipt ? " 保留上次确认的内容。" : " 尚未确认画像状态。"}</p>}
    {!receipt && !error && <p role="status">{busy ? "正在读取 Kiwi 画像与摘要…" : "尚未读取。点击查看当前账号和伴侣的结果。"}</p>}
    {receipt && !receipt.available && <p role="status">Kiwi 暂未提供适用于当前对话范围的画像或摘要。</p>}
    {receipt?.available && <>
      {receipt.fresh !== true && <p role="status">以下是上次确认的画像与摘要，尚未确认已覆盖最新对话。</p>}
      {busy && <p role="status">正在更新，下面是上次读取的内容。</p>}
      <article><h4>自动画像</h4><p>{receipt.profile || "Kiwi 当前没有返回画像内容。"}</p>{receipt.updated_at && <small>画像更新时间：{formatMemorySummaryDate(receipt.updated_at)}</small>}</article>
      <article><h4>对话摘要</h4><p>{receipt.summary || "Kiwi 当前没有返回摘要内容。"}</p>{receipt.summary_updated_at && <small>摘要更新时间：{formatMemorySummaryDate(receipt.summary_updated_at)}</small>}</article>
      {receipt.manual_persona_source === "settings" && receipt.manual_persona_authoritative === true && <p>服务已确认：手动设置优先，自动画像不会覆盖你的设定。</p>}
    </>}
  </section>;
}
