import { useLayoutEffect, useRef, useState } from "react";
import { authSession } from "./auth-session.js";
import { settingsSaveScope } from "./settings-save-scope.js";
import { kiwiHealthReceipt, memoryUiFailure, useMemoryUiRequest } from "./memory-ui-feedback.js";

export default function MemoryGatewayStatus({ scopeKey = settingsSaveScope(authSession.getSnapshot()), visualPreview = false }) {
  const [view, setView] = useState({ scopeKey, status: null, error: "", busy: false });
  const { status, error, busy } = view.scopeKey === scopeKey ? view : { status: null, error: "", busy: false };
  const [items, setItems] = useState(null);
  const [itemsError, setItemsError] = useState("");
  const [itemsBusy, setItemsBusy] = useState(false);
  const [mutatingId, setMutatingId] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState({ title: "", content: "" });
  const [authHint, setAuthHint] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
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
    setAuthHint("");
    setSyncing(false);
    setSyncMessage("");
  }, [scopeKey]);
  async function check() {
    if (visualPreview) {
      setAuthHint("当前处于本地无登录预览页（/visual-preview.html），请前往主入口登录后检测真实 Kiwi 记忆网关连接。");
      return;
    }
    if (requestRef.current) return;
    if (!isCurrent()) {
      setAuthHint("请先在主入口登录账号并选择伴侣，再检测 Kiwi 连接与账号范围。");
      return;
    }
    setAuthHint("");
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
  async function syncToKiwi() {
    if (syncing || !isCurrent()) return;
    setSyncing(true);
    setSyncMessage("");
    setItemsError("");
    try {
      const data = await request("/api/v2/memory/sync-to-kiwi", {
        method: "POST",
        body: {},
        timeoutMs: 45_000,
      });
      if (!isCurrent()) return;
      if (data?.ok !== true) throw new Error("kiwi_sync_invalid");
      const parts = [];
      if (data.imported > 0) parts.push(`已同步 ${data.imported} 条长期摘要至 Kiwi`);
      else if (data.supabase_count === 0) parts.push("当前尚无已确认的 Supabase 长期摘要可同步");
      else parts.push(`已校验 ${data.supabase_count} 条摘要（无新增重复）`);
      if (data.extract_action === "extract_failed") {
        parts.push(`Kiwi 网关提取器报错（${data.extract_reason || "请检查 Kiwi 面板模型/Key"}）`);
      } else if (data.extract_saved > 0) {
        parts.push(`Kiwi 新提取 ${data.extract_saved} 条记忆`);
      }
      setSyncMessage(`${parts.join("；")}，网关当前共 ${data.total ?? 0} 条记忆。`);
      void check();
    } catch (failure) {
      if (isCurrent()) {
        setSyncMessage(
          failure?.status === 404
            ? "当前连接的后端尚未升级同步接口（POST /api/v2/memory/sync-to-kiwi）。"
            : memoryUiFailure(failure, { gateway: true }),
        );
      }
    } finally {
      if (isCurrent()) setSyncing(false);
    }
  }
  const recallDiag = status?.diagnostics?.recall;
  const reportDiag = status?.diagnostics?.report;
  const storeDiag = status?.diagnostics?.store;
  const hasRecallCount = Number.isFinite(recallDiag?.totalSuccess);
  const hasReportCount = Number.isFinite(reportDiag?.totalSuccess);
  const usageActive = Boolean(
    status?.usage_active ||
    (Number(recallDiag?.totalSuccess) || 0) > 0 ||
    (Number(reportDiag?.totalSuccess) || 0) > 0 ||
    (Number(storeDiag?.totalSuccess) || 0) > 0 ||
    recallDiag?.ok === true ||
    reportDiag?.ok === true,
  );
  const usageCounterText = hasRecallCount || hasReportCount
    ? `召回成功 ${Number(recallDiag?.totalSuccess) || 0} 次 · 上报成功 ${Number(reportDiag?.totalSuccess) || 0} 次${(Number(storeDiag?.totalSuccess) || 0) > 0 ? ` · 同步写入 ${Number(storeDiag.totalSuccess)} 次` : ""}`
    : usageActive
      ? "已记录聊天召回/上报（服务端版本未返回累计计数）"
      : "尚未产生聊天召回或上报记录";
  const embeddingDescription = status?.embedding_state === "empty_no_memories_yet"
    ? "当前租户尚无 Kiwi 记忆（语义召回未通过仅因尚未入库），首轮对话入库或点击下方「同步摘要到 Kiwi」后再核验向量覆盖率。"
    : status?.embedding_available
      ? usageActive && status?.total_memories > 0
        ? "嵌入服务可用且已有向量记忆参与聊天召回。"
        : status?.total_memories > 0
          ? "嵌入服务报告可用；实际聊天召回仍待验证。"
          : "嵌入服务报告可用；当前租户尚无入库记忆，实际聊天召回仍待验证（可聊满 3 轮或点击「同步摘要到 Kiwi」入库）。"
      : "嵌入服务不可用，语义召回未通过；请检查 Kiwi 的嵌入模型配置。";

  return <section className="memory-gateway-status" aria-label="Kiwi 记忆连接检查">
    <div><strong>Kiwi 服务器记忆</strong><button type="button" onClick={() => void check()} disabled={busy}>{busy ? "检测中…" : "检测连接与账号范围"}</button></div>
    <p>按当前账号和伴侣检查连接，不读取记忆正文。聊天每轮自动调用 Kiwi 召回（recallMemories）并在回复落库后上报（reportChatTurn），不可用时静默降级为 Supabase 记忆。</p>
    {visualPreview && (
      <div className="memory-preview-banner" role="note">
        <span>本地预览模式：Kiwi 网关需经后端按 <code>userId:companionId</code> 租户隔离鉴权检测，登录后可核验可达性、向量覆盖率与聊天真实调用次数。</span>
        <a href="/">前往主入口登录</a>
      </div>
    )}
    {authHint && <div role="status" className="memory-preview-banner"><span>{authHint}</span><a href="/">前往主入口登录</a></div>}
    {error && <div role="alert"><p>{error}</p><p>点击“检测连接与账号范围”可重新检查，不会导入或修改记忆。</p></div>}
    {status?.tenant_verified && status.reachable && <div role="status">
      <p>{error || busy ? "上次检测：" : ""}服务可达 · 账号与伴侣范围已确认{Number.isFinite(status.latency_ms) ? `（${status.latency_ms} ms）` : ""}</p>
      <p>{status.memory_enabled ? `${status.total_memories} 条记忆（网关统计）` : "网关未确认记忆功能可用；请检查记忆功能和统计端点。"}</p>
      <p>{embeddingDescription}</p>
      <div className="memory-gateway-metrics">
        <div className="memory-gateway-metric">
          <small>聊天真实使用实况</small>
          <strong>{usageActive ? "已在聊天中实际调用" : "本进程尚未记录聊天调用"}</strong>
          <span>{usageCounterText}</span>
        </div>
        <div className="memory-gateway-metric">
          <small>向量嵌入模型与覆盖率</small>
          <strong>{status.embedding_model || (status.embedding_available ? "已就绪" : "待配置 / 未入库")}</strong>
          <span>{status.coverage && status.coverage !== "N/A" ? `覆盖率 ${status.coverage}` : status.embedding_state === "empty_no_memories_yet" ? "空库等待首次写入" : "覆盖率暂未返回"}</span>
        </div>
      </div>
      {recallDiag?.at && <p>{`最近一次聊天召回：${recallDiag.ok ? `成功 ${recallDiag.count || 0} 条${Number.isFinite(recallDiag.latencyMs) ? `（${recallDiag.latencyMs} ms）` : ""}` : `失败（${recallDiag.error || "未知错误"}）`} · ${new Date(recallDiag.at).toLocaleString()}`}</p>}
      {reportDiag?.at && <p>{`最近一次对话上报：${reportDiag.ok ? `成功${reportDiag.lastAction ? `（${reportDiag.lastAction}${reportDiag.savedCount ? ` · 新增 ${reportDiag.savedCount} 条` : ""}）` : ""}${Number.isFinite(reportDiag.latencyMs) ? `（${reportDiag.latencyMs} ms）` : ""}` : `失败（${reportDiag.extractReason || reportDiag.error || "未知错误"}）`} · ${new Date(reportDiag.at).toLocaleString()}`}</p>}
      <div className="memory-gateway-search">
        <input type="search" value={query} maxLength={200} placeholder="搜索 Kiwi 记忆（可留空）" aria-label="搜索 Kiwi 记忆" onChange={event => setQuery(event.currentTarget.value)} />
        <button type="button" className="memory-gateway-load" disabled={itemsBusy} onClick={() => void loadItems()}>{itemsBusy ? "读取中…" : items ? "搜索网关记忆" : "查看 / 搜索网关记忆"}</button>
        <button type="button" className="memory-gateway-load" disabled={syncing || busy} onClick={() => void syncToKiwi()}>{syncing ? "同步中…" : "同步摘要到 Kiwi"}</button>
      </div>
      {syncMessage && <p role="status">{syncMessage}</p>}
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
