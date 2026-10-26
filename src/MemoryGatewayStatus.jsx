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
  const [query, setQuery] = useState("");
  const requestRef = useRef(null);
  const itemsRef = useRef(null);
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  useLayoutEffect(() => {
    requestRef.current = null;
    itemsRef.current = null;
    setItems(null);
    setItemsError("");
    setItemsBusy(false);
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
          <div><strong>{item.title || item.category_name || "记忆"}</strong>{item.permanent && <span className="memory-gateway-permanent">永久</span>}</div>
          <p>{item.content}</p>
          <small>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}{item.importance ? ` · 重要度 ${item.importance}` : ""}</small>
        </article>)}
      </div>}
    </div>}
  </section>;
}
