import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMemoryUiRequest } from "./memory-ui-feedback.js";
import { formatMemorySummaryDate, memorySummaryFailure, memorySummaryListReceipt, memorySummaryPatchReceipt, readMemorySummaryDelete, readMemorySummaryJson } from "./memory-summary-feedback.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import { assertKiwiReceipt, emitMemoryChanged, invalidKiwiReceipt, kiwiAcceptedJob, kiwiJobReceipt, kiwiMemoryId } from "./kiwi-memory-receipt.js";
import "./memory-summary-list.css";
import { describeKiwiListPage } from "./kiwi-list-presentation.js";

const PATH = "/api/v2/memories";

export default function LocalMemorySummaries({ scopeKey, conversationId = "", items = [], drafts = {}, onItemsChange, onDraftsChange, onNotice }) {
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  const [reading, setReading] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [listState, setListState] = useState(null);
  const [job, setJob] = useState(null);
  const jobRef = useRef(null);
  const jobTimer = useRef(null);
  const jobPollCount = useRef(0);
  const polling = useRef(null);
  const sender = useRef(Symbol("memory-list"));
  const readVersion = useRef(0);
  const writeLock = useRef(null);
  const pendingRefresh = useRef(false);
  const draftVersions = useRef({});
  const draftsRef = useRef(drafts);
  useLayoutEffect(() => { draftsRef.current = drafts; }, [drafts]);

  const showFailure = useCallback((error, endpoint, mutation = false) => {
    const detail = memorySummaryFailure(error, mutation);
    recordOperationFailure(scopeKey, endpoint, error);
    setFeedback({ ...detail, error: true });
    onNotice?.(detail.message);
  }, [scopeKey, onNotice]);

  const refresh = useCallback(async ({ preserveFeedback = false } = {}) => {
    if (!isCurrent()) return;
    if (writeLock.current) { pendingRefresh.current = true; return; }
    pendingRefresh.current = false;
    const version = ++readVersion.current;
    setReading(true);
    try {
      const data = await request(PATH, { responseReader: readMemorySummaryJson });
      if (!isCurrent() || readVersion.current !== version) return;
      const memories = memorySummaryListReceipt(data);
      onItemsChange(memories);
      setListState({ total: data.total, partial: data.partial, hasMore: data.has_more, limit: data.limit, offset: data.offset });
      setConfirmed(true);
      if (!preserveFeedback) setFeedback(null);
    } catch (error) {
      if (isCurrent() && readVersion.current === version) showFailure(error, PATH);
    } finally {
      if (isCurrent() && readVersion.current === version) setReading(false);
    }
  }, [isCurrent, request, onItemsChange, showFailure]);

  async function pollJob(id) {
    if (!isCurrent() || jobRef.current !== id || polling.current === id) return;
    polling.current = id;
    if (jobTimer.current !== null) window.clearTimeout(jobTimer.current);
    jobTimer.current = null;
    try {
      const receipt = await request(`/api/v2/memory/jobs/${encodeURIComponent(id)}`, { responseReader: readMemorySummaryJson });
      if (!isCurrent() || jobRef.current !== id) return;
      const next = kiwiJobReceipt(receipt, id);
      setJob(next);
      if (next.status === "pending" || next.status === "running") {
        setFeedback({ error: false, message: "整理任务仍在处理，尚未确认记忆、摘要或画像已保存。" });
        if (++jobPollCount.current < 60) jobTimer.current = window.setTimeout(() => void pollJob(id), 2000);
        return;
      }
      jobRef.current = null;
      writeLock.current = null;
      setConsolidating(false);
      if (next.status === "failed") {
        const failure = Object.assign(new Error("整理未完成。"), { code: next.error_code || "memory_job_failed" });
        showFailure(failure, `/api/v2/memory/jobs/${id}`, true);
      } else if (next.status === "cancelled") {
        setFeedback({ error: false, message: "整理已取消，本次未确认有新记忆。" });
      } else if (next.status === "succeeded") {
        setFeedback({ error: false, message: `本次整理完成：Kiwi 已保存 ${next.result.extraction.saved} 条，跳过 ${next.result.extraction.skipped} 条。摘要和自动画像以各自的更新状态为准。` });
        emitMemoryChanged(scopeKey, "consolidated", sender.current);
      }
      await refresh({ preserveFeedback: true });
    } catch (error) {
      if (isCurrent() && jobRef.current === id) {
        showFailure(error, `/api/v2/memory/jobs/${id}`);
        // Keep the job and lock: a failed status read does not cancel the remote job.
      }
    } finally {
      if (polling.current === id) polling.current = null;
    }
  }

  const consolidate = async () => {
    if (!conversationId || writeLock.current || !isCurrent()) return;
    const operation = { type: "consolidate" };
    writeLock.current = operation;
    readVersion.current += 1;
    setConsolidating(true);
    setFeedback(null);
    try {
      const data = await request("/api/v2/memories/consolidate", {
        method: "POST",
        body: { conversation_id: conversationId, request_id: globalThis.crypto?.randomUUID?.() },
        responseReader: readMemorySummaryJson,
        timeoutMs: 90_000,
      });
      if (!isCurrent() || writeLock.current !== operation) return;
      assertKiwiReceipt(data);
      if (data.accepted === true) {
        kiwiAcceptedJob(data);
        jobRef.current = data.job_id;
        jobPollCount.current = 0;
        setJob({ id: data.job_id, status: data.status === "running" ? "running" : "pending" });
        setFeedback({ error: false, message: "整理任务已受理，正在等待 Kiwi 完成保存；现在还不能确认有新记忆。" });
        void pollJob(data.job_id);
        return;
      }
      if (data.compressed === true) {
        throw invalidKiwiReceipt();
      } else {
        const reason = {
          not_enough_messages: "当前对话消息还不够，至少需要 3 条可见消息。",
          nothing_worth_remembering: "模型认为当前对话没有值得长期保留的新内容。",
          duplicate_memory: "整理出的内容与已有记忆重复，没有重复保存。",
          model_unavailable: "当前接口没有可用模型或密钥，暂时无法整理。",
          already_running: "已有一条整理任务在进行，请稍后再看。",
          below_threshold: "当前对话内容还不到自动整理阈值。",
        }[data.reason];
        if (!reason || data.compressed !== false) throw invalidKiwiReceipt();
        setFeedback({ message: reason, error: data.reason === "model_unavailable" });
      }
      writeLock.current = null;
      await refresh({ preserveFeedback: true });
    } catch (error) {
      if (isCurrent()) showFailure(error, "/api/v2/memories/consolidate", true);
    } finally {
      if (isCurrent() && !jobRef.current) { if (writeLock.current === operation) writeLock.current = null; setConsolidating(false); }
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    const imported = event => {
      if (event.detail?.scopeKey === scopeKey && event.detail.sender !== sender.current &&
          ["chat-job-succeeded", "consolidated", "memory-write"].includes(event.detail.source)) void refresh({ preserveFeedback: true });
    };
    window.addEventListener("dengta:memory-updated", imported);
    return () => { cancelled = true; pendingRefresh.current = false; readVersion.current += 1; window.removeEventListener("dengta:memory-updated", imported); };
  }, [refresh, scopeKey]);
  useEffect(() => () => { jobRef.current = null; if (jobTimer.current !== null) window.clearTimeout(jobTimer.current); }, []);

  function edit(id, value) {
    draftVersions.current[id] = (draftVersions.current[id] || 0) + 1;
    draftsRef.current = { ...draftsRef.current, [id]: value };
    onDraftsChange(current => ({ ...current, [id]: value }));
  }

  function cancelEdit(id) {
    draftVersions.current[id] = (draftVersions.current[id] || 0) + 1;
    const next = { ...draftsRef.current }; delete next[id]; draftsRef.current = next;
    onDraftsChange(current => { const next = { ...current }; delete next[id]; return next; });
  }

  async function mutate(item, deleting = false) {
    if (!isCurrent() || writeLock.current) return;
    if (!kiwiMemoryId(item.id)) { showFailure(invalidKiwiReceipt(), PATH, true); return; }
    const draft = draftsRef.current[item.id];
    const summary = String(draft || "").trim();
    if (!deleting && (!summary || summary.length > 4000)) {
      onNotice?.(!summary ? "记忆内容不能为空。" : "记忆编辑最多 4000 字符，请保留原文后调整此次修改。");
      return;
    }
    const action = { id: item.id, version: draftVersions.current[item.id] || 0, draft };
    writeLock.current = action;
    if (deleting && !window.confirm("确定删除当前账号和伴侣的这条 Kiwi 记忆吗？")) {
      writeLock.current = null;
      return;
    }
    readVersion.current += 1;
    setReading(false);
    setBusyId(item.id);
    setFeedback(null);
    const endpoint = `${PATH}/${item.id}`;
    try {
      const data = await request(endpoint, deleting
        ? { method: "DELETE", responseReader: response => readMemorySummaryDelete(response, item.id) }
        : { method: "PATCH", body: { summary }, responseReader: readMemorySummaryJson });
      if (!isCurrent() || writeLock.current !== action) return;
      const receipt = deleting ? data : memorySummaryPatchReceipt(data, item.id, summary);
      readVersion.current += 1;
      onItemsChange(current => receipt.deleted ? current.filter(memory => memory.id !== item.id) : current.map(memory => memory.id === item.id ? receipt.memory : memory));
      if (receipt.deleted) setListState(previous => previous ? { ...previous, total: previous.total === null ? null : Math.max(0, previous.total - 1) } : previous);
      const unchanged = draftVersions.current[item.id] === action.version || (action.version === 0 && draftVersions.current[item.id] === undefined);
      const hasNewerDraft = !unchanged || draftsRef.current[item.id] !== action.draft;
      if (!hasNewerDraft) onDraftsChange(current => { if (current[item.id] !== action.draft) return current; const next = { ...current }; delete next[item.id]; return next; });
      const message = `${receipt.deleted ? deleting ? "记忆已经删除。" : "服务端已确认删除这条残留内容。" : "记忆已经保存。"}${hasNewerDraft ? " 新输入已保留，尚未保存。" : ""}`;
      setFeedback({ error: false, message });
      emitMemoryChanged(scopeKey, "memory-write", sender.current);
      onNotice?.(message);
    } catch (error) {
      if (isCurrent() && writeLock.current === action) showFailure(error, endpoint, true);
    } finally {
      if (writeLock.current === action) {
        writeLock.current = null;
        if (isCurrent()) {
          setBusyId("");
          if (pendingRefresh.current) void refresh();
        }
      }
    }
  }

  const displayed = confirmed && listState ? items : [];
  const itemIds = new Set(displayed.map(item => item.id));
  const orphanDrafts = Object.entries(drafts).filter(([id]) => !itemIds.has(id));
  const listDescription = confirmed && listState && describeKiwiListPage(listState, displayed.length);
  const previousList = reading || feedback?.error || listState?.stale;

  return (
    <section className="local-memory-summaries" aria-label="Kiwi 长期记忆">
      <div className="memory-source-heading local-memory-heading">
        <div><span className="eyebrow">KIWI</span><h3>长期记忆</h3></div>
        <span className="local-memory-count">{listDescription ? `${previousList ? "上次读取：" : ""}${listDescription.count}` : "总数尚未确认"}</span>
      </div>
      <div className="memory-summary-toolbar">
        <p role="status">{reading ? "正在读取 Kiwi 长期记忆…" : listDescription ? previousList ? "保留上次确认的记忆，当前结果尚未确认。" : "已读取 Kiwi 为当前账号与伴侣确认的记忆。" : "尚未成功读取当前账号与伴侣的 Kiwi 记忆。"}</p>
        <button type="button" onClick={() => void refresh()} disabled={reading || Boolean(busyId)}>{reading ? "读取中…" : "重新读取记忆"}</button>
        <button
          type="button"
          className="memory-consolidate-button"
          onClick={() => void consolidate()}
          disabled={!conversationId || consolidating || reading || Boolean(busyId)}
          title={conversationId ? "提交当前会话以提取记忆" : "请先在聊天里打开一个会话"}
        >
          {consolidating ? "整理中…" : "立即整理当前对话"}
        </button>
      </div>
      {!conversationId && <p>先打开一个聊天会话，才能整理该会话的记忆。</p>}
      {conversationId && <p className="memory-consolidate-help">整理会把当前会话提交给 Kiwi 提取记忆。是否新增记忆，请以任务结果为准。</p>}
      {listState?.hasMore && <p>还有其他记忆，可在记忆页用关键词查找。</p>}
      {job && <p role="status">整理状态：{({ pending: "等待处理", running: "处理中", succeeded: "已完成", failed: "失败", cancelled: "已取消" })[job.status]} {consolidating && <button type="button" onClick={() => void pollJob(job.id)}>查看整理进度</button>}</p>}
      {feedback && <div className={`memory-summary-feedback${feedback.error ? " is-error" : ""}`} role={feedback.error ? "alert" : "status"}>
        <p>{feedback.message}</p>
        {feedback.error && <details><summary>技术详情</summary><dl><dt>错误代码</dt><dd>{feedback.code}</dd>{feedback.status && <><dt>后端 HTTP</dt><dd>{feedback.status}</dd></>}{feedback.logId && <><dt>日志编号</dt><dd>{feedback.logId}</dd></>}</dl></details>}
      </div>}
      <div className="memory-grid">
        {displayed.length === 0 ? (!previousList && listDescription && <div className="empty-card">{listDescription.empty}</div>) : displayed.map(item => (
          <article className="memory-card" key={item.id}>
            <span>{formatMemorySummaryDate(item.updated_at || item.created_at)}</span>
            {item.permanent && <span className="memory-gateway-permanent">永久 · 编辑前请在记忆页取消永久</span>}
            {Object.hasOwn(drafts, item.id) ? <textarea className="memory-editor" value={drafts[item.id]} onChange={event => edit(item.id, event.target.value)} maxLength={4000} rows={5} aria-label="修改长期记忆" /> : <p>{item.summary}</p>}
            <div className="memory-card-actions">
              {Object.hasOwn(drafts, item.id) ? <>
                <button type="button" onClick={() => void mutate(item)} disabled={Boolean(busyId) || item.permanent}>{busyId === item.id ? "保存中…" : "保存"}</button>
                <button type="button" onClick={() => cancelEdit(item.id)} disabled={busyId === item.id}>取消</button>
              </> : <>
                <button type="button" onClick={() => edit(item.id, item.summary)} disabled={busyId === item.id || item.permanent}>修改</button>
                <button type="button" className="danger" onClick={() => void mutate(item, true)} disabled={Boolean(busyId)}>{busyId === item.id ? "删除中…" : "删除"}</button>
              </>}
            </div>
          </article>
        ))}
      </div>
      {orphanDrafts.length > 0 && <div className="memory-summary-orphan-drafts" aria-label="未保存的记忆草稿">
        <h4>仍然保留的输入</h4>
        <p>{listDescription ? "当前记忆列表未找到对应记录。" : "尚未读取到可与草稿核对的记忆列表。"}这些输入尚未保存，可以复制或丢弃。</p>
        {orphanDrafts.map(([id, draft]) => <div key={id}>
          <textarea readOnly value={draft} rows={4} aria-label="选择并复制未保存的记忆草稿" onFocus={event => event.currentTarget.select()} />
          <button type="button" disabled={Boolean(busyId)} onClick={() => {
            if (writeLock.current) return;
            if (window.confirm("确定丢弃这段未保存的输入吗？这只移除此草稿，不会修改服务器记忆。")) cancelEdit(id);
          }}>丢弃这段草稿</button>
        </div>)}
      </div>}
    </section>
  );
}
