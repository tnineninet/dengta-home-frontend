import { useLayoutEffect, useRef, useState } from "react";
import { authSession } from "./auth-session.js";
import { settingsSaveScope } from "./settings-save-scope.js";
import { kiwiHealthReceipt, memoryUiFailure, useMemoryUiRequest } from "./memory-ui-feedback.js";

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
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  useLayoutEffect(() => {
    requestRef.current = null;
    itemsRef.current = null;
    setItems(null);
    setItemsError("");
    setItemsBusy(false);
    setEditingId("");
    setEditDraft({ title: "", content: "" });
  }, [scopeKey]);
  async function check() {
    if (requestRef.current || !isCurrent()) return;
    const operation = {};
    requestRef.current = operation;
    setView(previous => ({ scopeKey, status: previous.scopeKey === scopeKey ? previous.status : null, error: "", busy: true }));
    try {
      const result = await request("/api/v2/memory/health", { timeoutMs: 10_000 });
      if (!isCurrent() || requestRef.current !== operation) return;
      const health = kiwiHealthReceipt(result);
      setView({ scopeKey, status: health, busy: true, error: health.error ? memoryUiFailure({ code: health.error, status: health.status }, { gateway: true }) : "" });
    } catch (failure) {
      if (isCurrent() && requestRef.current === operation) setView(previous => ({ ...previous, error: memoryUiFailure(failure) }));
    } finally {
      if (isCurrent() && requestRef.current === operation) { requestRef.current = null; setView(previous => ({ ...previous, busy: false })); }
    }
  }
  async function loadItems() {
    if (itemsRef.current || !isCurrent()) return;
    const operation = {};
    itemsRef.current = operation;
    setItemsBusy(true);
    setItemsError("");
    try {
      const data = await request(`/api/v2/memory/items?limit=20${query ? `&q=${encodeURIComponent(query)}` : ""}`, { timeoutMs: 10_000 });
      if (!isCurrent() || itemsRef.current !== operation) return;
      if (data?.ok !== true || !Array.isArray(data.memories)) throw new Error("kiwi_memory_list_invalid");
      setItems(data.memories);
    } catch (failure) {
      if (isCurrent() && itemsRef.current === operation) setItemsError(memoryUiFailure(failure));
    } finally {
      if (isCurrent() && itemsRef.current === operation) {
        itemsRef.current = null;
        setItemsBusy(false);
      }
    }
  }
  async function mutateItem(item, action) {
    if (mutatingId || !isCurrent()) return;
    const numericId = String(item.id).match(/(\d+)$/)?.[1];
    if (!numericId) { setItemsError("这条记忆没有可管理的网关编号。"); return; }
    if (action === "delete" && !window.confirm("确定删除这条 Kiwi 记忆吗？此操作不可撤销。")) return;
    setMutatingId(item.id);
    setItemsError("");
    try {
      if (action === "delete") {
        await request(`/api/v2/memory/items/${numericId}`, { method: "DELETE", timeoutMs: 10_000 });
        setItems(previous => (previous || []).filter(entry => entry.id !== item.id));
      } else {
        const data = await request(`/api/v2/memory/items/${numericId}/lock`, {
          method: "POST", body: { permanent: !item.permanent }, timeoutMs: 10_000
        });
        if (data?.ok !== true) throw new Error("kiwi_memory_lock_invalid");
        setItems(previous => (previous || []).map(entry => entry.id === item.id ? { ...entry, permanent: data.permanent === true } : entry));
      }
    } catch (failure) {
      if (isCurrent()) setItemsError(memoryUiFailure(failure, { mutation: true }));
    } finally {
      if (isCurrent()) setMutatingId("");
    }
  }
  function startEdit(item) {
    if (item.permanent) { setItemsError("永久记忆需先取消永久，再编辑内容。"); return; }
    setEditingId(item.id);
    setEditDraft({ title: item.title || "", content: item.content || "" });
    setItemsError("");
  }
  async function saveEdit(item) {
    if (mutatingId || !isCurrent()) return;
    const numericId = String(item.id).match(/(\d+)$/)?.[1];
    if (!numericId || !editDraft.content.trim()) { setItemsError("记忆内容不能为空。"); return; }
    setMutatingId(item.id);
    setItemsError("");
    try {
      const data = await request(`/api/v2/memory/items/${numericId}`, {
        method: "PUT",
        body: { title: editDraft.title, content: editDraft.content },
        timeoutMs: 15_000
      });
      if (data?.ok !== true || !data.memory_id) throw new Error("kiwi_memory_update_invalid");
      setItems(previous => (previous || []).map(entry => entry.id === item.id
        ? { ...entry, id: String(data.memory_id), title: data.title || "", content: data.content || editDraft.content, permanent: false }
        : entry));
      setEditingId("");
      setEditDraft({ title: "", content: "" });
    } catch (failure) {
      if (isCurrent()) setItemsError(memoryUiFailure(failure, { mutation: true }));
    } finally {
      if (isCurrent()) setMutatingId("");
    }
  }
  return <section className="memory-gateway-status" aria-label="Kiwi 记忆连接检查">
    <div><strong>Kiwi 服务器记忆</strong><button type="button" onClick={() => void check()} disabled={busy}>{busy ? "检测中…" : "检测连接与账号范围"}</button></div>
    <p>按当前账号和伴侣检查连接，不读取记忆正文。连接通过后，还需在聊天中验证实际召回。</p>
    {error && <div role="alert"><p>{error}</p><p>点击“检测连接与账号范围”可重新检查，不会导入或修改记忆。</p></div>}
    {status?.tenant_verified && status.reachable && <div role="status">
      <p>{error || busy ? "上次检测：" : ""}服务可达 · 账号与伴侣范围已确认</p>
      <p>{status.memory_enabled ? `${status.total_memories} 条记忆（网关统计）` : "网关未确认记忆功能可用；请检查记忆功能和统计端点。"}</p>
      <p>{status.embedding_available ? "嵌入服务报告可用；实际聊天召回仍待验证。" : "嵌入服务不可用，语义召回未通过；请检查 Kiwi 的嵌入模型配置。"}</p>
      {status.diagnostics?.recall?.at && <p>{`最近一次召回：${status.diagnostics.recall.ok ? `成功 ${status.diagnostics.recall.count || 0} 条` : `失败（${status.diagnostics.recall.error || "未知错误"}）`} · ${new Date(status.diagnostics.recall.at).toLocaleString()}`}</p>}
      {status.diagnostics?.report?.at && <p>{`最近一次上报：${status.diagnostics.report.ok ? "成功" : `失败（${status.diagnostics.report.error || "未知错误"}）`} · ${new Date(status.diagnostics.report.at).toLocaleString()}`}</p>}
      <div className="memory-gateway-search">
        <input type="search" value={query} maxLength={200} placeholder="搜索 Kiwi 记忆（可留空）" aria-label="搜索 Kiwi 记忆" onChange={event => setQuery(event.currentTarget.value)} />
        <button type="button" className="memory-gateway-load" disabled={itemsBusy} onClick={() => void loadItems()}>{itemsBusy ? "读取中…" : items ? "搜索网关记忆" : "查看 / 搜索网关记忆"}</button>
      </div>
      {itemsError && <p role="alert" className="memory-gateway-items-error">{itemsError}</p>}
      {items && <div className="memory-gateway-items" aria-label="Kiwi 网关记忆">
        {items.length === 0 ? <p>没有匹配的 Kiwi 记忆。</p> : items.map(item => <article key={item.id} className="memory-gateway-item">
          {editingId === item.id ? <div className="memory-gateway-edit">
            <input value={editDraft.title} maxLength={200} placeholder="记忆标题" aria-label="记忆标题" onChange={event => setEditDraft({ ...editDraft, title: event.currentTarget.value })} />
            <textarea value={editDraft.content} maxLength={10000} rows={4} aria-label="记忆内容" onChange={event => setEditDraft({ ...editDraft, content: event.currentTarget.value })} />
            <div className="memory-gateway-item-actions">
              <button type="button" disabled={Boolean(mutatingId)} onClick={() => void saveEdit(item)}>{mutatingId === item.id ? "保存中…" : "保存修改"}</button>
              <button type="button" disabled={Boolean(mutatingId)} onClick={() => { setEditingId(""); setItemsError(""); }}>取消</button>
            </div>
          </div> : <>
            <div><strong>{item.title || item.category_name || "记忆"}</strong>{item.permanent && <span className="memory-gateway-permanent">永久</span>}</div>
            <p>{item.content}</p>
            <small>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}{item.importance ? ` · 重要度 ${item.importance}` : ""}</small>
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
