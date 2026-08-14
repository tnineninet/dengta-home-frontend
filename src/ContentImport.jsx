import { useEffect, useMemo, useState } from "react";
import { commitContentImport, listContentImports, previewContentImport } from "./content-import-api.js";
import WorldBookManager from "./WorldBookManager.jsx";

const TYPE_META = Object.freeze({
  memory: {
    label: "稳定记忆",
    defaultTarget: "memories",
    targets: [["memories", "稳定记忆"], ["user_details", "你的详情"]],
  },
  style: {
    label: "表达风格",
    defaultTarget: "unified_system_prompt",
    targets: [["unified_system_prompt", "个性化指令"]],
  },
  world_book: {
    label: "世界书",
    defaultTarget: "world_book_entries",
    targets: [["world_book_entries", "世界书条目"]],
  },
  calendar: {
    label: "日历线索",
    defaultTarget: "memory_calendar",
    targets: [["memory_calendar", "记忆日历"]],
  },
});

function collectionOf(data, keys) {
  for (const key of keys) {
    const value = data?.[key] ?? data?.preview?.[key] ?? data?.result?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeImportPreview(data = {}) {
  const candidates = collectionOf(data, ["candidates", "items"]).map((item, index) => {
    const candidateType = item.type ?? item.candidate_type;
    const type = TYPE_META[candidateType] ? candidateType : "memory";
    return {
      ...item,
      clientKey: String(item.id ?? item.candidate_id ?? `${type}-${index}`),
      candidateId: item.id ?? item.candidate_id ?? index,
      type,
      source: String(item.source || item.source_label || "导入内容"),
      title: String(item.title || "未命名候选"),
      content: String(item.content ?? item.text ?? ""),
      target: String(item.target || TYPE_META[type].defaultTarget),
      keywords: Array.isArray(item.keywords ?? item.metadata?.keywords) ? [...(item.keywords ?? item.metadata.keywords)] : [],
      enabled: (item.enabled ?? item.metadata?.enabled) !== false,
      priority: Number(item.priority ?? item.metadata?.priority ?? 100),
      constant: (item.constant ?? item.metadata?.constant) === true,
      match_mode: String(item.match_mode ?? item.metadata?.match_mode ?? "any"),
      case_sensitive: (item.case_sensitive ?? item.metadata?.case_sensitive) === true,
      position: String(item.position ?? item.metadata?.position ?? "dynamic_context"),
      sort_order: Number(item.sort_order ?? item.metadata?.sort_order ?? index),
      decision: "pending",
    };
  });
  return {
    id: data.id ?? data.import_id ?? data.import?.id ?? data.preview?.id ?? data.result?.id ?? data.result?.import?.id,
    candidates,
    counts: data.counts ?? data.preview?.counts ?? data.result?.counts ?? (data.result?.count == null ? {} : { total: data.result.count }),
    warnings: collectionOf(data, ["warnings"]),
    digest: String(data.digest ?? data.preview?.digest ?? data.result?.digest ?? ""),
  };
}

function recentImportsOf(data) {
  return Array.isArray(data) ? data : collectionOf(data, ["imports", "items", "results"]);
}

function countText(counts) {
  const labels = { accepted: "接受", rejected: "拒绝", total: "候选" };
  const entries = Object.entries(counts || {}).filter(([, value]) => Number.isFinite(Number(value)));
  return entries.length
    ? entries.map(([key, value]) => `${TYPE_META[key]?.label || labels[key] || key} ${value}`).join(" · ")
    : "后端未返回分类计数";
}

function committedResult(data) {
  const value = data?.result || data || {};
  if (value.counts || value.stats) return value.counts || value.stats;
  return {
    accepted: value.accepted_count,
    rejected: value.rejected_count,
  };
}

export default function ContentImport({ api }) {
  const client = api || undefined;
  const [activeTab, setActiveTab] = useState("import");
  const [kind, setKind] = useState("world_book");
  const [format, setFormat] = useState("auto");
  const [inputMode, setInputMode] = useState("file");
  const [file, setFile] = useState(null);
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(null);
  const [recentImports, setRecentImports] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function refreshRecent() {
    try {
      setRecentImports(recentImportsOf(await listContentImports(client)));
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    let active = true;
    listContentImports(client).then(
      (data) => {
        if (active) setRecentImports(recentImportsOf(data));
      },
      (loadError) => {
        if (active) setError(loadError.message);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  const summary = useMemo(() => (preview?.candidates || []).reduce(
    (value, item) => ({
      accepted: value.accepted + Number(item.decision === "accepted"),
      rejected: value.rejected + Number(item.decision === "rejected"),
      pending: value.pending + Number(item.decision === "pending"),
    }),
    { accepted: 0, rejected: 0, pending: 0 },
  ), [preview]);

  function updateCandidate(clientKey, patch) {
    setPreview((current) => ({
      ...current,
      candidates: current.candidates.map((item) => item.clientKey === clientKey ? { ...item, ...patch } : item),
    }));
  }

  function decideAll(decision) {
    setPreview((current) => ({
      ...current,
      candidates: current.candidates.map((item) => ({ ...item, decision })),
    }));
  }

  async function handlePreview() {
    setBusy("preview");
    setError("");
    setResult(null);
    try {
      const data = await previewContentImport({
        kind,
        format,
        file: inputMode === "file" ? file : null,
        content: inputMode === "paste" ? content : "",
      }, client);
      setPreview(normalizeImportPreview(data));
    } catch (previewError) {
      setPreview(null);
      setError(previewError.message);
    } finally {
      setBusy("");
    }
  }

  async function handleCommit() {
    if (!preview?.id || summary.pending > 0) return;
    setBusy("commit");
    setError("");
    try {
      const decisions = preview.candidates.map((item) => ({
        id: item.candidateId,
        candidate_id: item.candidateId,
        decision: item.decision,
        accepted: item.decision === "accepted",
        title: item.title,
        content: item.content,
        target: item.target,
        ...(item.type === "world_book" ? {
          keywords: item.keywords,
          enabled: item.enabled,
          priority: Number(item.priority),
          constant: item.constant,
          match_mode: item.match_mode,
          case_sensitive: item.case_sensitive,
          position: item.position,
          sort_order: Number(item.sort_order),
        } : {}),
      }));
      const committed = await commitContentImport(preview.id, decisions, client);
      setResult(committedResult(committed));
      setPreview(null);
      window.dispatchEvent(new CustomEvent("dengta:memories-imported", { detail: committed.result || committed }));
      await refreshRecent();
    } catch (commitError) {
      setError(commitError.message);
    } finally {
      setBusy("");
    }
  }

  const groupedCandidates = useMemo(() => Object.keys(TYPE_META).map((type) => ({
    type,
    items: (preview?.candidates || []).filter((item) => item.type === type),
  })), [preview]);

  return (
    <section className="content-import" aria-labelledby="content-import-title">
      <header className="content-import-hero">
        <span className="eyebrow">把旧故事带回灯塔</span>
        <h3 id="content-import-title">世界书与聊天记录</h3>
        <p>先生成预览，再逐项决定去留。未经你的明确确认，任何候选都不会写入。</p>
      </header>

      <div className="content-import-tabs" role="tablist" aria-label="世界书与导入功能">
        <button type="button" role="tab" aria-selected={activeTab === "import"} onClick={() => setActiveTab("import")}>导入新内容</button>
        <button type="button" role="tab" aria-selected={activeTab === "manage"} onClick={() => setActiveTab("manage")}>世界书管理</button>
      </div>

      {activeTab === "manage" ? <WorldBookManager api={api} /> : <>
        <div className="content-import-source settings-card">
        <fieldset className="content-import-segments">
          <legend>导入内容类型</legend>
          <button type="button" aria-pressed={kind === "world_book"} onClick={() => setKind("world_book")}>世界书</button>
          <button type="button" aria-pressed={kind === "chat_history"} onClick={() => setKind("chat_history")}>聊天记录</button>
        </fieldset>
        <div className="content-import-fields">
          <label><span>输入方式</span><select aria-label="输入方式" value={inputMode} onChange={(event) => setInputMode(event.target.value)}><option value="file">上传文件</option><option value="paste">粘贴文本</option></select></label>
          <label><span>内容格式</span><select aria-label="内容格式" value={format} onChange={(event) => setFormat(event.target.value)}><option value="auto">自动识别</option><option value="sillytavern">SillyTavern</option><option value="generic_json">通用 JSON</option><option value="plain_text">纯文本</option></select></label>
        </div>
        {inputMode === "file" ? (
          <label className="content-import-dropzone"><span>{file ? file.name : "选择 JSON、TXT、CSV、Markdown 等文本文件"}</span><small>最大 10MB，文件只用于本次预览与导入；其他文本后缀也会自动识别。</small><input aria-label="选择导入文件" type="file" accept=".json,.txt,.text,.md,.markdown,.log,.csv,application/json,text/plain,text/markdown,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        ) : (
          <label className="content-import-paste"><span>粘贴原始内容</span><textarea aria-label="粘贴导入内容" value={content} onChange={(event) => setContent(event.target.value)} rows={8} placeholder="内容会按原文发送，不进行关键词过滤。" /></label>
        )}
        <button className="content-import-primary" type="button" disabled={Boolean(busy) || (inputMode === "file" ? !file : !content)} onClick={() => void handlePreview()}>{busy === "preview" ? "正在读入故事…" : "生成导入预览"}</button>
        </div>

      {error && <div className="content-import-error" role="alert">{error}</div>}
      {result && <div className="content-import-success" role="status"><strong>导入完成</strong><span>{countText(result)}</span></div>}

      {preview && (
        <section className="content-import-preview" aria-label="导入候选预览">
          <div className="content-import-receipt"><strong>预览回执</strong><span>{countText(preview.counts)}</span>{preview.digest && <p>{preview.digest}</p>}{preview.warnings.length > 0 && <ul aria-label="导入警告">{preview.warnings.map((warning, index) => <li key={`${String(warning)}-${index}`}>{String(warning?.message || warning)}</li>)}</ul>}</div>
          <div className="content-import-bulk" aria-label="批量决策"><button type="button" onClick={() => decideAll("accepted")}>全选接受</button><button type="button" onClick={() => decideAll("rejected")}>全选拒绝</button></div>
          {preview.candidates.length === 0 ? <div className="content-import-empty">没有生成可导入的候选项，请尝试其他格式。</div> : groupedCandidates.map(({ type, items }) => items.length > 0 && (
            <section className="content-import-group" key={type} aria-labelledby={`import-group-${type}`}>
              <h4 id={`import-group-${type}`}>{TYPE_META[type].label}<span>{items.length}</span></h4>
              <div className="content-import-grid">{items.map((item) => (
                <article className={`content-import-candidate is-${item.decision}`} key={item.clientKey}>
                  <div className="content-import-candidate-meta"><span>{item.source}</span><em>{TYPE_META[item.type].label}</em></div>
                  <label><span>标题</span><input aria-label={`${item.title}的标题`} value={item.title} onChange={(event) => updateCandidate(item.clientKey, { title: event.target.value })} /></label>
                  <label><span>内容</span><textarea aria-label={`${item.title}的内容`} value={item.content} onChange={(event) => updateCandidate(item.clientKey, { content: event.target.value })} rows={5} /></label>
                   <label><span>写入位置</span><select aria-label={`${item.title}的写入位置`} value={item.target} onChange={(event) => updateCandidate(item.clientKey, { target: event.target.value })}>{TYPE_META[item.type].targets.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                   {item.type === "world_book" && <div className="content-import-world-book-fields">
                     <label><span>关键词</span><input aria-label={`${item.title}的关键词`} value={item.keywords.join(", ")} onChange={(event) => updateCandidate(item.clientKey, { keywords: event.target.value.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean) })} /></label>
                     <label><span>优先级</span><input aria-label={`${item.title}的优先级`} type="number" min="-100000" max="100000" value={item.priority} onChange={(event) => updateCandidate(item.clientKey, { priority: event.target.value })} /></label>
                     <label><span>排序值</span><input aria-label={`${item.title}的排序值`} type="number" value={item.sort_order} onChange={(event) => updateCandidate(item.clientKey, { sort_order: event.target.value })} /></label>
                     <label><span>匹配方式</span><select aria-label={`${item.title}的匹配方式`} value={item.match_mode} onChange={(event) => updateCandidate(item.clientKey, { match_mode: event.target.value })}><option value="any">命中任一关键词</option><option value="all">命中全部关键词</option></select></label>
                     <label><span>上下文位置</span><select aria-label={`${item.title}的上下文位置`} value={item.position} onChange={(event) => updateCandidate(item.clientKey, { position: event.target.value })}><option value="dynamic_context">动态本轮背景</option><option value="before_memory">稳定记忆之前</option></select></label>
                     <div className="world-book-switches"><label><input type="checkbox" checked={item.enabled} onChange={(event) => updateCandidate(item.clientKey, { enabled: event.target.checked })} /><span>启用</span></label><label><input type="checkbox" checked={item.constant} onChange={(event) => updateCandidate(item.clientKey, { constant: event.target.checked })} /><span>常驻</span></label><label><input type="checkbox" checked={item.case_sensitive} onChange={(event) => updateCandidate(item.clientKey, { case_sensitive: event.target.checked })} /><span>区分大小写</span></label></div>
                   </div>}
                  <div className="content-import-decision" role="group" aria-label={`${item.title}的导入决策`}><button type="button" aria-pressed={item.decision === "accepted"} onClick={() => updateCandidate(item.clientKey, { decision: "accepted" })}>接受</button><button type="button" aria-pressed={item.decision === "rejected"} onClick={() => updateCandidate(item.clientKey, { decision: "rejected" })}>拒绝</button></div>
                </article>
              ))}</div>
            </section>
          ))}
          {preview.candidates.length > 0 && <div className="content-import-commit-summary" role="status"><div><strong>提交前确认</strong><span>接受 {summary.accepted} 项 · 拒绝 {summary.rejected} 项 · 未决定 {summary.pending} 项</span></div><button className="content-import-primary" type="button" disabled={Boolean(busy) || summary.pending > 0} onClick={() => void handleCommit()}>{busy === "commit" ? "正在写入…" : summary.pending > 0 ? "请先逐项决定" : "确认并提交"}</button></div>}
        </section>
      )}

      <section className="content-import-recent" aria-labelledby="recent-import-title">
        <div><span className="eyebrow">导入手记</span><h4 id="recent-import-title">最近导入记录</h4></div>
        {recentImports.length === 0 ? <p className="content-import-empty">还没有导入记录。</p> : <ul>{recentImports.map((item, index) => <li key={item.id || index}><strong>{item.title || item.filename || item.source_name || "未命名导入"}</strong><span>{item.status || item.kind || item.source_type || "已记录"}</span><time dateTime={item.created_at || item.createdAt}>{item.created_at || item.createdAt ? new Date(item.created_at || item.createdAt).toLocaleString("zh-CN") : ""}</time></li>)}</ul>}
      </section>
      </>}
    </section>
  );
}
