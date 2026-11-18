import { useLayoutEffect, useRef, useState } from "react";
import { authSession } from "./auth-session.js";
import { settingsSaveScope } from "./settings-save-scope.js";
import { kiwiHealthReceipt, memoryUiFailure, useMemoryUiRequest } from "./memory-ui-feedback.js";
import { emitMemoryChanged, invalidKiwiReceipt, kiwiMemoryDeleteReceipt, kiwiMemoryId, kiwiMemoryListReceipt, kiwiMemoryLockReceipt, kiwiMemoryWriteReceipt } from "./kiwi-memory-receipt.js";
import MemoryPrivacyNotice from "./MemoryPrivacyNotice.jsx";
import { describeKiwiListPage } from "./kiwi-list-presentation.js";
import { formatMemorySummaryDate } from "./memory-summary-feedback.js";
import "./memory-summary-list.css";

export default function MemoryGatewayStatus({ scopeKey = settingsSaveScope(authSession.getSnapshot()) }) {
  const [view, setView] = useState({ scopeKey, status: null, error: "", busy: false });
  const { status, error, busy } = view.scopeKey === scopeKey ? view : { status: null, error: "", busy: false };
  const [items, setItems] = useState(null);
  const [itemsError, setItemsError] = useState("");
  const [itemsBusy, setItemsBusy] = useState(false);
  const [mutatingId, setMutatingId] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState({ title: "", content: "" });
  const requestRef = useRef(null);
  const itemsRef = useRef(null);
  const actionRef = useRef(null);
  const [listState, setListState] = useState(null);
  const changeVersion = useRef(0);
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  useLayoutEffect(() => {
    requestRef.current = null;
    itemsRef.current = null;
    actionRef.current = null;
    setView({ scopeKey, status: null, error: "", busy: false, stale: false });
    setQuery("");
    setMutatingId("");
    setListState(null);
    setItems(null);
    setItemsError("");
    setItemsBusy(false);
    setEditingId("");
    setEditDraft({ title: "", content: "" });
    const changed = event => {
      if (event.detail?.scopeKey !== scopeKey || !isCurrent()) return;
      changeVersion.current++;
      setView(previous => ({ ...previous, stale: true }));
      if (["chat-job-succeeded", "consolidated", "memory-write"].includes(event.detail.source)) {
        setListState(previous => previous ? { ...previous, stale: true } : previous);
      }
    };
    window.addEventListener?.("dengta:memory-updated", changed);
    return () => window.removeEventListener?.("dengta:memory-updated", changed);
  }, [scopeKey, isCurrent]);
  async function check() {
    if (requestRef.current || !isCurrent()) return;
    const operation = { revision: changeVersion.current };
    requestRef.current = operation;
    setView(previous => ({ ...previous, scopeKey, status: previous.scopeKey === scopeKey ? previous.status : null, error: "", busy: true }));
    try {
      const result = await request("/api/v2/memory/health", { timeoutMs: 10_000 });
      if (!isCurrent() || requestRef.current !== operation) return;
      const health = kiwiHealthReceipt(result);
      setView({ scopeKey, status: health, stale: changeVersion.current !== operation.revision, busy: true, error: health.error ? memoryUiFailure({ code: health.error, status: health.status }, { gateway: true }) : "" });
    } catch (failure) {
      if (isCurrent() && requestRef.current === operation) setView(previous => ({ ...previous, stale: true, error: memoryUiFailure(failure) }));
    } finally {
      if (isCurrent() && requestRef.current === operation) { requestRef.current = null; setView(previous => ({ ...previous, busy: false })); }
    }
  }
  async function loadItems() {
    if (itemsRef.current || actionRef.current || !isCurrent()) return;
    const operation = { revision: changeVersion.current, query: query.trim() };
    itemsRef.current = operation;
    setItemsBusy(true);
    setItemsError("");
    try {
      const data = await request(`/api/v2/memory/items?limit=20${operation.query ? `&q=${encodeURIComponent(operation.query)}` : ""}`, { timeoutMs: 10_000 });
      if (!isCurrent() || itemsRef.current !== operation) return;
      const receipt = kiwiMemoryListReceipt(data);
      if (!operation.query && receipt.mode !== "list") throw invalidKiwiReceipt();
      setItems(receipt.memories);
      setListState({ total: receipt.total, partial: receipt.partial, hasMore: receipt.has_more, query: operation.query, stale: changeVersion.current !== operation.revision });
    } catch (failure) {
      if (isCurrent() && itemsRef.current === operation) { setItemsError(memoryUiFailure(failure)); setListState(previous => previous ? { ...previous, stale: true } : previous); }
    } finally {
      if (isCurrent() && itemsRef.current === operation) {
        itemsRef.current = null;
        setItemsBusy(false);
      }
    }
  }
  async function mutateItem(item, action) {
    if (actionRef.current || !isCurrent()) return;
    const numericId = item.id;
    if (!kiwiMemoryId(numericId)) { setItemsError(memoryUiFailure(invalidKiwiReceipt())); return; }
    if (action === "delete" && !window.confirm("确定删除这条 Kiwi 记忆吗？此操作不可撤销。")) return;
    const operation = {};
    actionRef.current = operation;
    itemsRef.current = null;
    setItemsBusy(false);
    setMutatingId(item.id);
    setItemsError("");
    try {
      if (action === "delete") {
        const data = await request(`/api/v2/memory/items/${numericId}`, { method: "DELETE", timeoutMs: 10_000 });
        if (!isCurrent() || actionRef.current !== operation) return;
        kiwiMemoryDeleteReceipt(data, numericId);
        setItems(previous => (previous || []).filter(entry => entry.id !== item.id));
      } else {
        const data = await request(`/api/v2/memory/items/${numericId}/lock`, {
          method: "POST", body: { permanent: !item.permanent }, timeoutMs: 10_000
        });
        if (!isCurrent() || actionRef.current !== operation) return;
        kiwiMemoryLockReceipt(data, numericId, !item.permanent);
        setItems(previous => (previous || []).map(entry => entry.id === item.id ? { ...entry, permanent: data.permanent === true } : entry));
      }
      emitMemoryChanged(scopeKey, "memory-write");
      void check();
    } catch (failure) {
      if (isCurrent()) setItemsError(memoryUiFailure(failure, { mutation: true }));
    } finally {
      if (isCurrent() && actionRef.current === operation) { actionRef.current = null; setMutatingId(""); }
    }
  }
  function startEdit(item) {
    if (item.permanent) { setItemsError("永久记忆需先取消永久，再编辑内容。"); return; }
    setEditingId(item.id);
    setEditDraft({ title: item.title || "", content: item.summary });
    setItemsError("");
  }
  async function saveEdit(item) {
    if (actionRef.current || !isCurrent()) return;
    const numericId = item.id;
    if (!kiwiMemoryId(numericId) || !editDraft.content.trim()) { setItemsError("记忆编号无效或内容为空，请重新读取后核对。"); return; }
    const operation = {};
    const submitted = { title: editDraft.title, content: editDraft.content };
    actionRef.current = operation;
    itemsRef.current = null;
    setItemsBusy(false);
    setMutatingId(item.id);
    setItemsError("");
    try {
      const data = await request(`/api/v2/memory/items/${numericId}`, {
        method: "PUT",
        body: submitted,
        timeoutMs: 15_000
      });
      if (!isCurrent() || actionRef.current !== operation) return;
      const saved = kiwiMemoryWriteReceipt(data, numericId, submitted.content.trim());
      setItems(previous => (previous || []).map(entry => entry.id === item.id
        ? saved
        : entry));
      setEditingId("");
      setEditDraft({ title: "", content: "" });
      emitMemoryChanged(scopeKey, "memory-write");
      void check();
    } catch (failure) {
      if (isCurrent()) setItemsError(memoryUiFailure(failure, { mutation: true }));
    } finally {
      if (isCurrent() && actionRef.current === operation) { actionRef.current = null; setMutatingId(""); }
    }
  }
  const listDescription = listState && describeKiwiListPage(listState, items?.length ?? 0);
  const queryChanged = listState && query.trim() !== (listState.query ?? "");
  const previousList = itemsError || itemsBusy || listState?.stale || queryChanged;
  return <section className="memory-gateway-status" aria-label="Kiwi 记忆连接检查">
    <div><strong>Kiwi 主记忆库</strong><button type="button" onClick={() => void check()} disabled={busy}>{busy ? "检测中…" : "检测连接与账号范围"}</button></div>
    <p>检测只查询当前账号与伴侣的服务状态。要查看记忆正文，请另行读取列表。</p>
    <MemoryPrivacyNotice />
    {error && <div role="alert"><p>{error}</p><p>点击“检测连接与账号范围”可重新检查，不会导入或修改记忆。</p></div>}
    {status?.ok === true && status.tenant_verified && status.reachable && <div>
      <div role="status">
        <p>{error || busy || view.stale ? "上次检测：" : ""}服务可达 · 账号与伴侣范围已确认</p>
        <p>{!status.memory_enabled ? "网关未确认记忆功能可用，当前记忆数量未知。" : Number.isSafeInteger(status.total_memories) ? `${status.total_memories} 条记忆（网关统计）` : "网关未返回记忆总数。"}</p>
        <p>{status.embedding_available ? "嵌入服务报告可用；实际聊天召回仍待验证。" : "嵌入服务暂不可用；本次检测未验证聊天中的实际召回。"}</p>
        {status.diagnostics?.recall?.at && <p>{`最近一次召回：${status.diagnostics.recall.ok === true ? Number.isSafeInteger(status.diagnostics.recall.count) ? `返回 ${status.diagnostics.recall.count} 条` : "数量尚未确认" : status.diagnostics.recall.ok === false ? "失败" : "结果未知"} · ${formatMemorySummaryDate(status.diagnostics.recall.at)}`}</p>}
        {status.diagnostics?.report?.at && <p>{`最近一次上报：${status.diagnostics.report.ok === true ? "已受理；是否保存请看整理结果" : status.diagnostics.report.ok === false ? "失败" : "结果未知"} · ${formatMemorySummaryDate(status.diagnostics.report.at)}`}</p>}
      </div>
      <div className="memory-gateway-search">
        <input type="search" value={query} maxLength={200} placeholder="搜索 Kiwi 记忆（可留空）" aria-label="搜索 Kiwi 记忆" onChange={event => setQuery(event.currentTarget.value)} />
        <button type="button" className="memory-gateway-load" disabled={itemsBusy} onClick={() => void loadItems()}>{itemsBusy ? "读取中…" : items ? "搜索网关记忆" : "查看 / 搜索网关记忆"}</button>
      </div>
      {itemsError && <p role="alert" className="memory-gateway-items-error">{itemsError}</p>}
      {listDescription && <p role="status">{previousList ? "上次读取：" : ""}{listDescription.count}{queryChanged ? "。输入已改变，请重新搜索。" : ""}{listState.hasMore ? " 可使用关键词查找其他记忆。" : ""}</p>}
      {items && <div className="memory-gateway-items" aria-label="Kiwi 网关记忆">
        {items.length === 0 ? (!previousList && listDescription && <p>{listDescription.empty}</p>) : items.map(item => <article key={item.id} className="memory-gateway-item">
          {editingId === item.id ? <div className="memory-gateway-edit">
            <input value={editDraft.title} disabled={Boolean(mutatingId)} maxLength={200} placeholder="记忆标题" aria-label="记忆标题" onChange={event => setEditDraft({ ...editDraft, title: event.currentTarget.value })} />
            <textarea value={editDraft.content} disabled={Boolean(mutatingId)} maxLength={10000} rows={4} aria-label="记忆内容" onChange={event => setEditDraft({ ...editDraft, content: event.currentTarget.value })} />
            <div className="memory-gateway-item-actions">
              <button type="button" disabled={Boolean(mutatingId)} onClick={() => void saveEdit(item)}>{mutatingId === item.id ? "保存中…" : "保存修改"}</button>
              <button type="button" disabled={Boolean(mutatingId)} onClick={() => { setEditingId(""); setItemsError(""); }}>取消</button>
            </div>
          </div> : <>
            <div><strong>{item.title || item.category_name || "记忆"}</strong>{item.permanent && <span className="memory-gateway-permanent">永久</span>}</div>
            <p>{item.summary}</p>
            <small>{formatMemorySummaryDate(item.created_at)}{item.importance ? ` · 重要度 ${item.importance}` : ""}</small>
            <div className="memory-gateway-item-actions">
              <button type="button" disabled={Boolean(mutatingId) || item.permanent} onClick={() => startEdit(item)}>{item.permanent ? "先取消永久再编辑" : "编辑"}</button>
              <button type="button" disabled={Boolean(mutatingId)} onClick={() => void mutateItem(item, "lock")}>{mutatingId === item.id ? "处理中…" : item.permanent ? "取消永久" : "设为永久"}</button>
              <button type="button" className="is-danger" disabled={Boolean(mutatingId)} onClick={() => void mutateItem(item, "delete")}>删除</button>
            </div>
          </>}
        </article>)}
      </div>}
    </div>}
  </section>;
}
