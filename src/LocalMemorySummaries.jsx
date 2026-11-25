import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMemoryUiRequest } from "./memory-ui-feedback.js";
import { formatMemorySummaryDate, memorySummaryFailure, memorySummaryListReceipt, memorySummaryPatchReceipt, readMemorySummaryDelete, readMemorySummaryJson } from "./memory-summary-feedback.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import "./memory-summary-list.css";

const PATH = "/api/v2/memories";
const MEMORY_CONTEXT_CHAR_BUDGET = 8000;
const PREVIEW_MEMORY_SUMMARIES = Object.freeze([
  {
    id: "preview-memory-1",
    summary: "桃桃喜欢晚上散步和听舒缓纯音乐，聊天时偏好温暖、直接、不说教的回应节奏。",
    updated_at: "2026-11-24T21:15:00+08:00",
    created_at: "2026-11-24T21:15:00+08:00",
  },
  {
    id: "preview-memory-2",
    summary: "常备药箱与眼科复查提醒已归档至灯塔医疗 AI 专区，重要症状建议结合病历原文核对。",
    updated_at: "2026-11-25T09:30:00+08:00",
    created_at: "2026-11-25T09:30:00+08:00",
  },
]);

export default function LocalMemorySummaries({ scopeKey, conversationId = "", items = [], drafts = {}, onItemsChange, onDraftsChange, onNotice, visualPreview = false }) {
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  const [reading, setReading] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [confirmed, setConfirmed] = useState(visualPreview);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [authHint, setAuthHint] = useState("");
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

  const refresh = useCallback(async ({ manual = false } = {}) => {
    if (visualPreview) {
      setConfirmed(true);
      if (manual) {
        setFeedback({ error: false, message: "当前为无登录本地预览模式，已展示离线示例摘要；请前往主入口登录后读取真实 Supabase 长期记忆。" });
      }
      return;
    }
    if (!isCurrent()) {
      if (manual) setAuthHint("请先在主入口登录账号并选择伴侣，再读取云端对话摘要。");
      return;
    }
    setAuthHint("");
    if (writeLock.current) { pendingRefresh.current = true; return; }
    pendingRefresh.current = false;
    const version = ++readVersion.current;
    setReading(true);
    try {
      const data = await request(PATH, { responseReader: readMemorySummaryJson });
      if (!isCurrent() || readVersion.current !== version) return;
      const memories = memorySummaryListReceipt(data);
      onItemsChange(memories);
      setConfirmed(true);
      setFeedback(null);
    } catch (error) {
      if (isCurrent() && readVersion.current === version) showFailure(error, PATH);
    } finally {
      if (isCurrent() && readVersion.current === version) setReading(false);
    }
  }, [isCurrent, request, onItemsChange, showFailure, visualPreview]);

  const consolidate = useCallback(async () => {
    if (visualPreview) {
      setFeedback({ error: false, message: "本地预览模式下不会向云端写入摘要；请在主入口登录后整理当前对话。" });
      return;
    }
    if (!conversationId || consolidating || !isCurrent()) return;
    setConsolidating(true);
    setFeedback(null);
    try {
      const data = await request("/api/v2/memories/consolidate", {
        method: "POST",
        body: { conversation_id: conversationId },
        responseReader: readMemorySummaryJson,
        timeoutMs: 90_000,
      });
      if (!isCurrent()) return;
      if (data?.ok !== true) throw new Error("记忆整理回执不完整。");
      if (data.compressed === true) {
        setFeedback({ message: `已整理当前对话，保存了 1 条新摘要，隐去 ${data.hidden_message_count || 0} 条已整理消息。`, error: false });
        onNotice?.("当前对话的长期记忆已更新。");
      } else {
        const reason = {
          not_enough_messages: "当前对话消息还不够，至少需要 3 条可见消息。",
          nothing_worth_remembering: "模型认为当前对话没有值得长期保留的新内容。",
          duplicate_memory: "整理出的内容与已有记忆重复，没有重复保存。",
          model_unavailable: "当前接口没有可用模型或密钥，暂时无法整理。",
          already_running: "已有一条整理任务在进行，请稍后再看。",
          below_threshold: "当前对话内容还不到自动整理阈值。",
        }[data.reason] || "当前对话暂时没有生成新摘要。";
        setFeedback({ message: `${reason}`, error: false });
      }
      await refresh();
    } catch (error) {
      if (isCurrent()) showFailure(error, "/api/v2/memories/consolidate", true);
    } finally {
      if (isCurrent()) setConsolidating(false);
    }
  }, [conversationId, consolidating, isCurrent, onNotice, refresh, request, showFailure, visualPreview]);

  useEffect(() => {
    if (visualPreview) return undefined;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    const imported = () => { void refresh(); };
    window.addEventListener("dengta:memories-imported", imported);
    return () => { cancelled = true; pendingRefresh.current = false; readVersion.current += 1; window.removeEventListener("dengta:memories-imported", imported); };
  }, [refresh, visualPreview]);

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
    if (visualPreview) {
      setFeedback({ error: false, message: "当前为本地预览示例，登录后可修改或删除真实长期记忆。" });
      return;
    }
    if (!isCurrent() || writeLock.current) return;
    const draft = draftsRef.current[item.id];
    const summary = String(draft || "").trim();
    if (!deleting && (!summary || summary.length > 4000)) {
      onNotice?.(!summary ? "记忆内容不能为空。" : "记忆编辑最多 4000 字符，请保留原文后调整此次修改。");
      return;
    }
    const action = { id: item.id, version: draftVersions.current[item.id] || 0, draft };
    writeLock.current = action;
    if (deleting && !window.confirm("确定删除这条长期记忆吗？删除后不会再注入对话。")) {
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
        ? { method: "DELETE", responseReader: readMemorySummaryDelete }
        : { method: "PATCH", body: { summary }, responseReader: readMemorySummaryJson });
      if (!isCurrent() || writeLock.current !== action) return;
      const receipt = deleting ? data : memorySummaryPatchReceipt(data, item.id, summary);
      readVersion.current += 1;
      onItemsChange(current => receipt.deleted ? current.filter(memory => memory.id !== item.id) : current.map(memory => memory.id === item.id ? receipt.memory : memory));
      const unchanged = draftVersions.current[item.id] === action.version || (action.version === 0 && draftVersions.current[item.id] === undefined);
      const hasNewerDraft = !unchanged || draftsRef.current[item.id] !== action.draft;
      if (!hasNewerDraft) onDraftsChange(current => { if (current[item.id] !== action.draft) return current; const next = { ...current }; delete next[item.id]; return next; });
      const message = `${receipt.deleted ? deleting ? "记忆已经删除。" : "服务端已确认删除这条残留内容。" : "记忆已经保存。"}${hasNewerDraft ? " 新输入已保留，尚未保存。" : ""}`;
      setFeedback({ error: false, message });
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

  const effectiveItems = visualPreview ? PREVIEW_MEMORY_SUMMARIES : items;
  const normalizedFilter = filterQuery.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    if (!normalizedFilter) return effectiveItems;
    return effectiveItems.filter(item => String(item?.summary || "").toLowerCase().includes(normalizedFilter));
  }, [effectiveItems, normalizedFilter]);
  const totalChars = useMemo(
    () => effectiveItems.reduce((sum, item) => sum + String(item?.summary || "").length, 0),
    [effectiveItems],
  );
  const budgetPercent = Math.min(100, Math.round((totalChars / MEMORY_CONTEXT_CHAR_BUDGET) * 100));
  const budgetTone = budgetPercent >= 95 ? "is-full" : budgetPercent >= 75 ? "is-warn" : "";

  async function copySummariesMarkdown() {
    if (!visibleItems.length) return;
    const markdown = visibleItems
      .map((item, idx) => `${idx + 1}. [${formatMemorySummaryDate(item.updated_at || item.created_at)}] ${String(item.summary || "").trim()}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(markdown);
      setFeedback({ error: false, message: `已复制 ${visibleItems.length} 条记忆摘要（Markdown）。` });
    } catch {
      setFeedback({ error: false, message: "浏览器未允许剪贴板复制，请手动选中卡片文字复制。" });
    }
  }

  const itemIds = new Set(effectiveItems.map(item => item.id));
  const orphanDrafts = visualPreview ? [] : Object.entries(drafts).filter(([id]) => !itemIds.has(id));

  return (
    <section className="local-memory-summaries" aria-label="对话摘要">
      <div className="memory-source-heading local-memory-heading">
        <div><span className="eyebrow">SUPABASE</span><h3>对话摘要</h3></div>
        <span className="local-memory-count">{visualPreview ? `${effectiveItems.length} 条 · 本地预览` : confirmed || items.length ? `${items.length} 条${!confirmed ? " · 上次读取" : ""}` : "尚未确认"}</span>
      </div>
      {visualPreview && (
        <div className="memory-preview-banner" role="note">
          <span>当前为无登录本地预览模式，下方为离线演示摘要；前往主入口登录后读取并整理真实 Supabase 长期记忆。</span>
          <a href="/">前往主入口登录</a>
        </div>
      )}
      <div className="memory-summary-toolbar">
        <p role="status">{visualPreview ? "本地预览模式：展示对话摘要布局与检索能力。" : reading ? "正在读取对话摘要…" : authHint ? authHint : feedback?.error && (confirmed || items.length) ? "保留上次确认的摘要，本次结果尚未确认。" : confirmed ? "已读取当前账号与伴侣的摘要。" : items.length ? "保留上次读取的摘要，本次尚未确认。" : "尚未成功读取对话摘要。"}</p>
        <button type="button" onClick={() => void refresh({ manual: true })} disabled={reading || Boolean(busyId)}>{reading ? "读取中…" : "重新读取摘要"}</button>
        <button
          type="button"
          className="memory-consolidate-button"
          onClick={() => void consolidate()}
          disabled={(!conversationId && !visualPreview) || consolidating || reading}
          title={visualPreview ? "登录后可立即整理当前聊天" : conversationId ? "立即整理当前聊天，不等待自动阈值" : "请先在聊天里打开一个会话"}
        >
          {consolidating ? "整理中…" : "立即整理当前对话"}
        </button>
      </div>
      {(effectiveItems.length > 0 || filterQuery) && (
        <div className="memory-summary-controls">
          <input
            type="search"
            className="memory-summary-search"
            value={filterQuery}
            onChange={event => setFilterQuery(event.target.value)}
            placeholder="关键词筛选摘要…"
            aria-label="筛选对话摘要"
            maxLength={120}
          />
          <span className="memory-summary-budget" title={`后端单次上下文记忆注入上限为 ${MEMORY_CONTEXT_CHAR_BUDGET} 字符`}>
            <span>注入预算 {totalChars}/{MEMORY_CONTEXT_CHAR_BUDGET} 字</span>
            <span className={`memory-summary-budget-bar ${budgetTone}`} aria-hidden="true">
              <i style={{ width: `${budgetPercent}%` }} />
            </span>
          </span>
          <button type="button" onClick={() => void copySummariesMarkdown()} disabled={visibleItems.length === 0}>
            复制摘要
          </button>
        </div>
      )}
      {feedback && <div className={`memory-summary-feedback${feedback.error ? " is-error" : ""}`} role={feedback.error ? "alert" : "status"}>
        <p>{feedback.message}</p>
        {feedback.error && <details><summary>技术详情</summary><dl><dt>错误代码</dt><dd>{feedback.code}</dd>{feedback.status && <><dt>后端 HTTP</dt><dd>{feedback.status}</dd></>}{feedback.logId && <><dt>日志编号</dt><dd>{feedback.logId}</dd></>}</dl></details>}
      </div>}
      <div className="memory-grid">
        {confirmed && effectiveItems.length === 0 ? <div className="empty-card">暂时没有长期记忆。每聊满 3 轮或说出「记住…」时会自动提炼，也可随时点击上方「立即整理当前对话」。</div> : visibleItems.length === 0 && normalizedFilter ? <div className="empty-card">没有匹配“{filterQuery.trim()}”的记忆摘要。</div> : visibleItems.map(item => (
          <article className="memory-card" key={item.id}>
            <span>{formatMemorySummaryDate(item.updated_at || item.created_at)}</span>
            {Object.hasOwn(drafts, item.id) && !visualPreview ? <textarea className="memory-editor" value={drafts[item.id]} onChange={event => edit(item.id, event.target.value)} maxLength={4000} rows={5} aria-label="修改长期记忆" /> : <p>{item.summary}</p>}
            {!visualPreview && (
              <div className="memory-card-actions">
                {Object.hasOwn(drafts, item.id) ? <>
                  <button type="button" onClick={() => void mutate(item)} disabled={Boolean(busyId)}>{busyId === item.id ? "保存中…" : "保存"}</button>
                  <button type="button" onClick={() => cancelEdit(item.id)} disabled={busyId === item.id}>取消</button>
                </> : <>
                  <button type="button" onClick={() => edit(item.id, item.summary)} disabled={busyId === item.id}>修改</button>
                  <button type="button" className="danger" onClick={() => void mutate(item, true)} disabled={Boolean(busyId)}>{busyId === item.id ? "删除中…" : "删除"}</button>
                </>}
              </div>
            )}
          </article>
        ))}
      </div>
      {orphanDrafts.length > 0 && <div className="memory-summary-orphan-drafts" aria-label="未保存的记忆草稿">
        <h4>仍然保留的输入</h4>
        <p>当前摘要列表未找到对应记录。这些输入尚未保存，可以选中全文复制，或手动丢弃。</p>
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
