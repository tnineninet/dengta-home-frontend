import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Database, Download, Plug, RefreshCw, Search, ShieldCheck, Sparkles, Square } from "lucide-react";
import {
  commitMcpMemory,
  discoverMcpMemory,
  listMcpMemorySources,
  previewMcpMemory,
} from "./content-import-api.js";

const DEFAULT_PRESETS = [
  { id: "anthropic_knowledge_graph", label: "Knowledge Graph MCP", hint: "read_graph / search_nodes（@modelcontextprotocol/server-memory）", endpointHint: "https://your-memory-mcp.example.com/mcp" },
  { id: "mem0_openmemory", label: "Mem0 / OpenMemory", hint: "get_all_memories / search_memories", endpointHint: "https://your-mem0-mcp.example.com/mcp" },
  { id: "zep_graphiti", label: "Zep / Graphiti", hint: "get_episodes / search_memory_facts", endpointHint: "https://your-zep-mcp.example.com/mcp" },
  { id: "ombre_brain", label: "Ombre Brain MCP", hint: "breath_search / list_memories", endpointHint: "https://your-ombre.example.com/mcp" },
  { id: "kiwi_local_kb", label: "本机 DengTa 知识库 MCP", hint: "local_kb_search（本机 127.0.0.1:18088/mcp）", endpointHint: "http://127.0.0.1:18088/mcp" },
  { id: "generic_mcp", label: "通用只读记忆 MCP", hint: "Qdrant / Chroma / Obsidian / 自定义 Streamable HTTP MCP", endpointHint: "https://your-mcp.example.com/mcp" },
];

export default function McpMemoryImporter({ api }) {
  const [sources, setSources] = useState([]);
  const [sourceMode, setSourceMode] = useState("manual");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [presetId, setPresetId] = useState("anthropic_knowledge_graph");
  const [endpoint, setEndpoint] = useState("");
  const [authType, setAuthType] = useState("bearer");
  const [authHeader, setAuthHeader] = useState("X-API-Key");
  const [credential, setCredential] = useState("");
  const [discovered, setDiscovered] = useState(null);
  const [toolName, setToolName] = useState("");
  const [toolArgsText, setToolArgsText] = useState("{}");
  const [preview, setPreview] = useState(null);
  const [selectedIds, setSelectedIds] = useState({});
  const [editedSummaries, setEditedSummaries] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    listMcpMemorySources(api)
      .then((data) => {
        if (!alive) return;
        const saved = Array.isArray(data?.saved_connections) ? data.saved_connections : [];
        setSources(saved);
        if (saved.length > 0) {
          setSourceMode("saved");
          setSelectedConnectionId(saved[0].id);
        }
      })
      .catch(() => {
        /* graceful in preview or offline mode */
      });
    return () => { alive = false; };
  }, [api]);

  function targetPayload() {
    if (sourceMode === "saved" && selectedConnectionId) {
      return { connection_id: selectedConnectionId };
    }
    return {
      endpoint: endpoint.trim(),
      auth_type: authType,
      ...(authType === "custom_header" ? { auth_header: authHeader.trim() } : {}),
      ...(authType !== "none" && credential.trim() ? { credential: credential.trim() } : {}),
    };
  }

  async function handleDiscover() {
    setBusy("discover");
    setError("");
    setNotice("");
    setPreview(null);
    try {
      const data = await discoverMcpMemory(targetPayload(), api);
      const res = data?.result || data;
      setDiscovered(res);
      setToolName(res.recommended_tool || res.read_only_tools?.[0]?.name || "");
      setToolArgsText(JSON.stringify(res.suggested_args || {}, null, 2));
      setNotice(`已连接「${res.server_name || res.source_label}」，识别为 ${res.adapter_label}（发现 ${res.read_only_tools?.length || 0} 个安全只读工具）。`);
    } catch (err) {
      setError(err?.message || "连接外部 MCP 记忆库失败，请检查地址和认证凭据。");
    } finally {
      setBusy("");
    }
  }

  async function handlePreview() {
    setBusy("preview");
    setError("");
    setNotice("");
    let parsedArgs;
    try {
      const trimmed = toolArgsText.trim();
      parsedArgs = trimmed ? JSON.parse(trimmed) : {};
    } catch {
      setBusy("");
      setError("工具参数必须是合法的 JSON 对象（例如 {} 或 {\"query\":\"记忆\"}）。");
      return;
    }
    try {
      const data = await previewMcpMemory({
        ...targetPayload(),
        ...(toolName ? { tool_name: toolName } : {}),
        tool_args: parsedArgs,
      }, api);
      const res = data?.result || data;
      setPreview(res);
      const initialSelected = {};
      for (const item of res.items || []) {
        initialSelected[item.id] = !item.duplicate_of_existing;
      }
      setSelectedIds(initialSelected);
      setEditedSummaries({});
      setNotice(`只读拉取完成：共 ${res.total} 条记忆（新增 ${res.new_count} 条，已存在去重 ${res.duplicate_count} 条）。尚未写入。`);
    } catch (err) {
      setError(err?.message || "拉取外部 MCP 记忆预览失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleCommit() {
    if (!preview?.items?.length) return;
    const chosen = preview.items
      .filter((item) => selectedIds[item.id])
      .map((item) => ({
        ...item,
        summary: editedSummaries[item.id] ?? item.summary,
      }));
    if (!chosen.length) {
      setError("请至少勾选一条要导入的记忆。");
      return;
    }
    setBusy("commit");
    setError("");
    setNotice("");
    try {
      const data = await commitMcpMemory({
        endpoint: preview.endpoint,
        source_label: preview.source_label,
        skip_duplicates: skipDuplicates,
        items: chosen,
      }, api);
      const res = data?.result || data;
      setNotice(`导入完成：新增同步 ${res.imported} 条外部记忆到 DengTa 记忆库（跳过 ${res.skipped} 条重复或无效项）。外部记忆库未被修改。`);
      window.dispatchEvent(new CustomEvent("dengta:memories-imported", { detail: res }));
      setPreview(null);
    } catch (err) {
      setError(err?.message || "写入 DengTa 记忆库失败，请稍后重试。");
    } finally {
      setBusy("");
    }
  }

  const filteredItems = useMemo(() => {
    const items = preview?.items || [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      String(item.title || "").toLowerCase().includes(q)
      || String(editedSummaries[item.id] ?? item.summary ?? "").toLowerCase().includes(q)
      || (item.tags || []).some((t) => String(t).toLowerCase().includes(q))
    );
  }, [preview, searchTerm, editedSummaries]);

  const chosenCount = useMemo(
    () => (preview?.items || []).filter((item) => selectedIds[item.id]).length,
    [preview, selectedIds],
  );

  const canConnect = sourceMode === "saved" ? Boolean(selectedConnectionId) : Boolean(endpoint.trim());

  return (
    <section className="freedom-panel" aria-labelledby="mcp-memory-import-title">
      <div className="freedom-card settings-card">
        <div className="freedom-card-head">
          <div>
            <span className="eyebrow">MCP MEMORY BRIDGE</span>
            <h4 id="mcp-memory-import-title">从外部记忆库 MCP 导入记忆</h4>
            <p>支持 Knowledge Graph、Mem0、OpenMemory、Zep/Graphiti、Ombre Brain、本机知识库及任意只读 Streamable HTTP MCP。先预览去重，再确认导入。</p>
          </div>
          <span className="freedom-badge"><ShieldCheck size={14} aria-hidden="true" /> 仅调用只读工具</span>
        </div>

        <div className="freedom-preset-strip" role="group" aria-label="外部记忆库 MCP 预设">
          {DEFAULT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`freedom-chip${presetId === preset.id ? " is-active" : ""}`}
              onClick={() => {
                setPresetId(preset.id);
                if (preset.id === "kiwi_local_kb") {
                  setSourceMode("manual");
                  setEndpoint("http://127.0.0.1:18088/mcp");
                  setAuthType("none");
                }
              }}
              title={preset.hint}
            >
              <Plug size={13} aria-hidden="true" />
              <span>{preset.label}</span>
            </button>
          ))}
        </div>

        <div className="freedom-source-switch" role="group" aria-label="MCP 连接来源">
          <button type="button" className={sourceMode === "saved" ? "is-active" : ""} disabled={!sources.length} onClick={() => setSourceMode("saved")}>
            选用已保存 MCP（{sources.length}）
          </button>
          <button type="button" className={sourceMode === "manual" ? "is-active" : ""} onClick={() => setSourceMode("manual")}>
            手动填写外部 MCP 地址
          </button>
        </div>

        {sourceMode === "saved" && sources.length > 0 ? (
          <label className="freedom-field">
            <span>选择已配置的 MCP 服务器</span>
            <select aria-label="选择已配置的 MCP 服务器" value={selectedConnectionId} onChange={(e) => { setSelectedConnectionId(e.target.value); setDiscovered(null); setPreview(null); }}>
              {sources.map((src) => (
                <option key={src.id} value={src.id}>
                  {src.name} · {src.endpoint}（{src.tool_count} 工具）
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="freedom-grid-2">
            <label className="freedom-field freedom-col-span-2">
              <span>MCP 服务地址（Streamable HTTP）</span>
              <input
                aria-label="外部 MCP 服务地址"
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={DEFAULT_PRESETS.find((p) => p.id === presetId)?.endpointHint || "https://memory-mcp.example.com/mcp"}
              />
            </label>
            <label className="freedom-field">
              <span>认证方式</span>
              <select aria-label="MCP 认证方式" value={authType} onChange={(e) => setAuthType(e.target.value)}>
                <option value="none">无需认证</option>
                <option value="bearer">Bearer Token</option>
                <option value="custom_header">自定义请求头</option>
              </select>
            </label>
            {authType === "custom_header" && (
              <label className="freedom-field">
                <span>请求头名称</span>
                <input aria-label="MCP 自定义请求头" value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} placeholder="X-API-Key" />
              </label>
            )}
            {authType !== "none" && (
              <label className="freedom-field">
                <span>访问令牌（仅本次请求使用，不会落盘泄露）</span>
                <input aria-label="MCP 访问令牌" type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="输入 Bearer Token 或密钥" autoComplete="new-password" />
              </label>
            )}
          </div>
        )}

        <div className="freedom-actions">
          <button type="button" className="content-import-primary" disabled={!canConnect || Boolean(busy)} onClick={() => void handleDiscover()}>
            <RefreshCw size={15} aria-hidden="true" />
            {busy === "discover" ? "正在探测 MCP 工具…" : "1. 探测服务与记忆工具"}
          </button>
          <button type="button" className="content-import-secondary" disabled={!canConnect || Boolean(busy)} onClick={() => void handlePreview()}>
            <Sparkles size={15} aria-hidden="true" />
            {busy === "preview" ? "正在拉取记忆…" : "2. 拉取只读记忆预览"}
          </button>
        </div>

        {discovered && (
          <div className="freedom-subbox">
            <div className="freedom-subbox-head">
              <strong>已识别适配：{discovered.adapter_label}</strong>
              <span>{discovered.server_name || discovered.endpoint} · 协议 {discovered.protocol_version}</span>
            </div>
            <div className="freedom-grid-2">
              <label className="freedom-field">
                <span>选择只读记忆工具（已屏蔽写/删类工具）</span>
                <select
                  aria-label="选择 MCP 只读记忆工具"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                >
                  {(discovered.read_only_tools || []).map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}{t.description ? ` — ${t.description.slice(0, 48)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="freedom-field">
                <span>调用参数（JSON）</span>
                <textarea
                  aria-label="MCP 工具调用参数"
                  rows={2}
                  value={toolArgsText}
                  onChange={(e) => setToolArgsText(e.target.value)}
                  placeholder='{"query": "记忆", "limit": 50}'
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {error && <div className="content-import-error" role="alert">{error}</div>}
      {notice && <div className="content-import-success" role="status">{notice}</div>}

      {preview && (
        <div className="freedom-card settings-card">
          <div className="freedom-card-head">
            <div>
              <span className="eyebrow">READ-ONLY PREVIEW</span>
              <h4>外部 MCP 记忆预览（共 {preview.total} 条 · 新增 {preview.new_count} · 重复 {preview.duplicate_count}）</h4>
              <p>来源工具：<code>{preview.tool_name}</code>。你可以勾选、搜索或编辑内容后再写入 DengTa。</p>
            </div>
            <div className="freedom-inline-tools">
              <button type="button" className="content-import-secondary" onClick={() => {
                const next = {};
                for (const item of preview.items) next[item.id] = !item.duplicate_of_existing;
                setSelectedIds(next);
              }}>仅选新增</button>
              <button type="button" className="content-import-secondary" onClick={() => {
                const next = {};
                for (const item of preview.items) next[item.id] = true;
                setSelectedIds(next);
              }}>全选</button>
              <button type="button" className="content-import-secondary" onClick={() => setSelectedIds({})}>全不选</button>
            </div>
          </div>

          <div className="freedom-search-row">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="筛选外部 MCP 记忆"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="按关键词、实体名或标签筛选预览记忆…"
            />
            <label className="freedom-checkbox">
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
              <span>自动跳过已存在记忆</span>
            </label>
          </div>

          {filteredItems.length === 0 ? (
            <p className="content-import-empty">当前筛选下没有可显示的外部记忆条目。</p>
          ) : (
            <div className="freedom-memory-list">
              {filteredItems.map((item) => {
                const checked = Boolean(selectedIds[item.id]);
                return (
                  <article key={item.id} className={`freedom-memory-item${checked ? " is-selected" : ""}${item.duplicate_of_existing ? " is-dup" : ""}`}>
                    <div className="freedom-memory-item-head">
                      <button
                        type="button"
                        className="freedom-check-btn"
                        aria-pressed={checked}
                        onClick={() => setSelectedIds((cur) => ({ ...cur, [item.id]: !cur[item.id] }))}
                      >
                        {checked ? <CheckSquare size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
                        <strong>{item.title}</strong>
                      </button>
                      <div className="freedom-tags">
                        {item.duplicate_of_existing && <span className="freedom-tag is-warn">已存在（去重）</span>}
                        <span className="freedom-tag">{item.category}</span>
                        {(item.tags || []).slice(0, 3).map((tag) => <span key={tag} className="freedom-tag">{tag}</span>)}
                      </div>
                    </div>
                    <textarea
                      aria-label={`编辑外部记忆 ${item.title}`}
                      rows={2}
                      value={editedSummaries[item.id] ?? item.summary}
                      onChange={(e) => setEditedSummaries((cur) => ({ ...cur, [item.id]: e.target.value }))}
                    />
                  </article>
                );
              })}
            </div>
          )}

          <div className="freedom-commit-bar">
            <span><Database size={15} aria-hidden="true" /> 已选 <strong>{chosenCount}</strong> / {preview.total} 条准备导入 DengTa 长期记忆</span>
            <button type="button" className="content-import-primary" disabled={!chosenCount || Boolean(busy)} onClick={() => void handleCommit()}>
              {busy === "commit" ? "正在写入记忆库…" : <><Download size={15} aria-hidden="true" /> 确认导入选中的记忆</>}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
