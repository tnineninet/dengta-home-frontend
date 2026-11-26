import { useMemo, useState } from "react";
import {
  Archive,
  Check,
  Copy,
  Database,
  Download,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  applyLocalMemoryCuration,
  curateLocalMemories,
  distillLocalPersona,
  exportPersonaFreedom,
  triggerFileDownload,
} from "./content-import-api.js";

const EXPORT_FORMAT_CARDS = [
  { id: "agents_md", label: "AGENTS.md / SOUL", ext: ".md", hint: "Antigravity / OpenClaw / Claude Code / Codex 开放协议", Icon: FileText },
  { id: "dengta_bundle", label: "DengTa 无损迁移包", ext: ".dengta.json", hint: "含人设、整理后记忆与世界书，可一键导回任意 DengTa", Icon: Layers },
  { id: "sillytavern_v2_json", label: "SillyTavern V2/V3 角色卡", ext: ".json", hint: "标准 chara_card_v2，自动内嵌全部世界书", Icon: FileJson },
  { id: "sillytavern_png", label: "SillyTavern PNG 角色卡", ext: ".png", hint: "真实写入 chara & ccv3 元数据块，拖入即用", Icon: ImageIcon },
  { id: "astrbot_json", label: "AstrBot / QQ 机器人", ext: ".json", hint: "兼容 dengta.astrbot-persona，附带蒸馏记忆", Icon: FileCode2 },
  { id: "mcp_memory_jsonl", label: "MCP 知识图谱记忆库", ext: ".jsonl", hint: "entity + relation 标准行，直接导入外部 MCP 记忆库", Icon: Database },
  { id: "yaml", label: "结构化 YAML 档案", ext: ".yaml", hint: "人设、记忆、世界书清晰分节，可读可编辑", Icon: FileCode2 },
  { id: "toml", label: "结构化 TOML 档案", ext: ".toml", hint: "轻量标准配置格式，脚本与框架零门槛解析", Icon: FileCode2 },
  { id: "csv", label: "记忆与世界书表格", ext: ".csv", hint: "带 UTF-8 BOM，Excel / WPS 直接打开零乱码", Icon: FileSpreadsheet },
  { id: "portable_zip", label: "全格式自由迁徙全家桶", ext: ".zip", hint: "一次性打包 AGENTS.md、角色卡 JSON/PNG、MCP JSONL、CSV 等全部文件", Icon: Archive },
];

export default function PersonaFreedomStudio({ api }) {
  const [curation, setCuration] = useState(null);
  const [distillMode, setDistillMode] = useState("local_structured");
  const [distillResult, setDistillResult] = useState(null);
  const [editedPersona, setEditedPersona] = useState("");
  const [selectedFormat, setSelectedFormat] = useState("agents_md");
  const [includeMemories, setIncludeMemories] = useState(true);
  const [includeWorldBook, setIncludeWorldBook] = useState(true);
  const [includeUserDetails, setIncludeUserDetails] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [lastExportPreview, setLastExportPreview] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function runCurate() {
    setBusy("curate");
    setError("");
    setNotice("");
    try {
      const data = await curateLocalMemories({}, api);
      const res = data?.result || data;
      setCuration(res);
      setActiveCategory("all");
      setNotice(`本机记忆整理完成：共扫描 ${res.stats.raw_count} 条，去重精选 ${res.stats.curated_count} 条（发现 ${res.stats.duplicate_count} 条重复、过滤 ${res.stats.residue_count} 条拒答残留）。`);
    } catch (err) {
      setError(err?.message || "读取本机记忆失败，请确认登录态正常后重试。");
    } finally {
      setBusy("");
    }
  }

  async function runDedupCleanup() {
    if (!curation?.duplicates?.length) return;
    const dupIds = curation.duplicates.map((d) => d.id).filter(Boolean);
    if (!dupIds.length) return;
    if (!window.confirm(`确定清理这 ${dupIds.length} 条重复记忆？保留其中更完整的版本，不可撤销。`)) return;
    setBusy("cleanup");
    setError("");
    setNotice("");
    try {
      const data = await applyLocalMemoryCuration({ delete_duplicate_ids: dupIds }, api);
      const res = data?.result || data;
      setNotice(`已清理 ${res.deleted_duplicates} 条重复记忆，正在重新统计…`);
      window.dispatchEvent(new CustomEvent("dengta:memories-imported"));
      const refreshed = await curateLocalMemories({}, api);
      setCuration(refreshed?.result || refreshed);
    } catch (err) {
      setError(err?.message || "清理重复记忆失败。");
    } finally {
      setBusy("");
    }
  }

  async function runDistill() {
    setBusy("distill");
    setError("");
    setNotice("");
    try {
      const data = await distillLocalPersona({
        mode: distillMode,
        include_user_details: includeUserDetails,
      }, api);
      const res = data?.result || data;
      setDistillResult(res);
      setEditedPersona(res.distilled_persona || "");
      setNotice(
        res.mode === "ai_deep"
          ? `AI 深度人格蒸馏完成（模型：${res.model}），你可以在下方自由微调后导出到任何平台。`
          : `本地极速零 Token 蒸馏完成（整合 ${res.memory_stats?.curated_count || 0} 条记忆与 ${res.world_book_count || 0} 条世界书），可直接编辑或导出。`,
      );
    } catch (err) {
      setError(err?.message || "人格蒸馏失败；如果尚未配置 API Key，请切换「本地极速零 Token 蒸馏」。");
    } finally {
      setBusy("");
    }
  }

  async function runExport(downloadNow = true) {
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const res = await exportPersonaFreedom({
        format: selectedFormat,
        include_memories: includeMemories,
        include_world_book: includeWorldBook,
        include_user_details: includeUserDetails,
        ...(editedPersona.trim() ? { distilled_persona: editedPersona.trim() } : {}),
      }, api);
      setLastExportPreview({
        filename: res.filename,
        format: res.format,
        size: res.size,
        encoding: res.encoding,
        textPreview: res.encoding === "utf8" ? String(res.content || "").slice(0, 2400) : "",
        fullContent: res.encoding === "utf8" ? res.content : "",
      });
      if (downloadNow) {
        const result = triggerFileDownload({
          filename: res.filename,
          content: res.content,
          mimeType: res.mime_type,
          encoding: res.encoding,
        });
        const kb = Math.max(1, Math.round((res.size || 0) / 1024));
        setNotice(
          result.mode === "native"
            ? `已导出 ${res.filename}（约 ${kb} KB）到 App 文件夹 files/export/。`
            : `已生成并下载 ${res.filename}（约 ${kb} KB），可自由迁移至其他平台或本机备份。`,
        );
      }
    } catch (err) {
      setError(err?.message || "导出失败，请稍后重试。");
    } finally {
      setBusy("");
    }
  }

  async function copyDistilled() {
    const text = lastExportPreview?.fullContent || editedPersona;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("复制失败，请手动选中文本框内容复制。");
    }
  }

  const visibleCurated = useMemo(() => {
    if (!curation?.curated) return [];
    if (activeCategory === "all") return curation.curated;
    return curation.curated.filter((item) => item.category === activeCategory);
  }, [curation, activeCategory]);

  return (
    <section className="freedom-panel" aria-labelledby="persona-freedom-title">
      {/* 1. 本机 DengTa 记忆整理 */}
      <div className="freedom-card settings-card">
        <div className="freedom-card-head">
          <div>
            <span className="eyebrow">DATA FREEDOM · STEP 1</span>
            <h4 id="persona-freedom-title">整理本机 DengTa 记忆</h4>
            <p>自动扫描当前伴侣的长期记忆，完成近重复聚类、拒答残留清洗与 6 大主题归类，让记忆库干净轻盈、随时可带走。</p>
          </div>
          <button type="button" className="content-import-primary" disabled={Boolean(busy)} onClick={() => void runCurate()}>
            <Database size={15} aria-hidden="true" />
            {busy === "curate" ? "正在整理本机记忆…" : "扫描并整理本机记忆"}
          </button>
        </div>

        {curation && (
          <div className="freedom-curation-body">
            <div className="freedom-metrics-row">
              <div className="freedom-metric"><strong>{curation.stats.raw_count}</strong><span>原始记忆</span></div>
              <div className="freedom-metric is-good"><strong>{curation.stats.curated_count}</strong><span>去重精选</span></div>
              <div className="freedom-metric is-warn"><strong>{curation.stats.duplicate_count}</strong><span>可清理重复</span></div>
              <div className="freedom-metric"><strong>{curation.world_book_count}</strong><span>世界书条目</span></div>
            </div>

            <div className="freedom-preset-strip" role="group" aria-label="记忆分类筛选">
              <button type="button" className={`freedom-chip${activeCategory === "all" ? " is-active" : ""}`} onClick={() => setActiveCategory("all")}>
                全部（{curation.curated.length}）
              </button>
              {(curation.groups || []).map((g) => (
                <button key={g.id} type="button" className={`freedom-chip${activeCategory === g.id ? " is-active" : ""}`} onClick={() => setActiveCategory(g.id)}>
                  {g.label}（{g.items.length}）
                </button>
              ))}
            </div>

            {visibleCurated.length > 0 && (
              <ul className="freedom-curated-list">
                {visibleCurated.slice(0, 16).map((item) => (
                  <li key={item.id}>
                    <span className="freedom-tag">{item.category_label}</span>
                    <p>{item.summary}</p>
                  </li>
                ))}
              </ul>
            )}

            {curation.duplicates?.length > 0 && (
              <div className="freedom-dup-banner">
                <span>发现 <strong>{curation.duplicates.length}</strong> 条高度重复的记忆（保留更完整版本，不丢失事实）。</span>
                <button type="button" className="content-import-secondary" disabled={Boolean(busy)} onClick={() => void runDedupCleanup()}>
                  <Trash2 size={14} aria-hidden="true" />
                  {busy === "cleanup" ? "正在清理…" : "一键清理重复记忆"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. 蒸馏本机 DengTa 人格 */}
      <div className="freedom-card settings-card">
        <div className="freedom-card-head">
          <div>
            <span className="eyebrow">PERSONA DISTILL · STEP 2</span>
            <h4>蒸馏本机 DengTa 人格</h4>
            <p>从当前伴侣的人设提示词、真实对话风格指纹（口癖/称呼/句长/表情）、整理后记忆与世界书中，提炼出高保真可迁徙人格。</p>
          </div>
          <span className="freedom-badge"><ShieldCheck size={14} aria-hidden="true" /> 自动脱敏密钥</span>
        </div>

        <div className="freedom-source-switch" role="group" aria-label="人格蒸馏引擎">
          <button type="button" className={distillMode === "local_structured" ? "is-active" : ""} onClick={() => setDistillMode("local_structured")}>
            本地极速零 Token 蒸馏（离线可用）
          </button>
          <button type="button" className={distillMode === "ai_deep" ? "is-active" : ""} onClick={() => setDistillMode("ai_deep")}>
            AI 深度风格蒸馏（调用当前模型）
          </button>
        </div>

        <div className="freedom-actions">
          <button type="button" className="content-import-primary" disabled={Boolean(busy)} onClick={() => void runDistill()}>
            <Sparkles size={15} aria-hidden="true" />
            {busy === "distill" ? "正在蒸馏本机人格…" : "一键蒸馏当前伴侣人格"}
          </button>
          <label className="freedom-checkbox">
            <input type="checkbox" checked={includeUserDetails} onChange={(e) => setIncludeUserDetails(e.target.checked)} />
            <span>附带「你的详情」背景</span>
          </label>
        </div>

        {distillResult?.style_stats && (
          <div className="freedom-voice-strip">
            <span>采样 {distillResult.style_stats.message_count} 条回复 · 均长 {distillResult.style_stats.average_chars_per_message} 字</span>
            {distillResult.style_stats.address_terms?.length > 0 && <span>称呼：{distillResult.style_stats.address_terms.join("、")}</span>}
            {distillResult.style_stats.top_phrases?.length > 0 && <span>高频表达：{distillResult.style_stats.top_phrases.slice(0, 5).join("、")}</span>}
          </div>
        )}

        <label className="freedom-field">
          <span>蒸馏后的人格档案（可直接编辑微调，导出时将以此为准）</span>
          <textarea
            aria-label="蒸馏后的人格档案"
            rows={8}
            value={editedPersona}
            onChange={(e) => setEditedPersona(e.target.value)}
            placeholder="点击上方「一键蒸馏当前伴侣人格」自动生成，也可以留空直接按本机现有人设和记忆打包导出。"
          />
        </label>
      </div>

      {/* 3. 多格式自由导出 */}
      <div className="freedom-card settings-card">
        <div className="freedom-card-head">
          <div>
            <span className="eyebrow">ZERO LOCK-IN · STEP 3</span>
            <h4>选择开放格式自由导出（10 种格式）</h4>
            <p>你的伴侣记忆与灵魂永远属于你——随时带去 Antigravity、SillyTavern、AstrBot、外部 MCP 记忆库或本地归档。</p>
          </div>
        </div>

        <div className="freedom-format-grid" role="radiogroup" aria-label="人格与记忆导出格式">
          {EXPORT_FORMAT_CARDS.map((card) => {
            const active = selectedFormat === card.id;
            const Icon = card.Icon;
            return (
              <button
                key={card.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`freedom-format-card${active ? " is-active" : ""}`}
                onClick={() => setSelectedFormat(card.id)}
              >
                <span className="freedom-format-icon"><Icon size={17} aria-hidden="true" /></span>
                <span className="freedom-format-meta">
                  <strong>{card.label} <code>{card.ext}</code></strong>
                  <small>{card.hint}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="freedom-toggles-row">
          <label className="freedom-checkbox">
            <input type="checkbox" checked={includeMemories} onChange={(e) => setIncludeMemories(e.target.checked)} />
            <span>附带整理后的长期记忆</span>
          </label>
          <label className="freedom-checkbox">
            <input type="checkbox" checked={includeWorldBook} onChange={(e) => setIncludeWorldBook(e.target.checked)} />
            <span>附带世界书条目</span>
          </label>
          <label className="freedom-checkbox">
            <input type="checkbox" checked={includeUserDetails} onChange={(e) => setIncludeUserDetails(e.target.checked)} />
            <span>包含「你的详情」</span>
          </label>
        </div>

        <div className="freedom-actions">
          <button type="button" className="content-import-primary" disabled={Boolean(busy)} onClick={() => void runExport(true)}>
            <Download size={15} aria-hidden="true" />
            {busy === "export" ? "正在打包生成…" : `导出 ${EXPORT_FORMAT_CARDS.find((c) => c.id === selectedFormat)?.ext || ""}`}
          </button>
          {(editedPersona || lastExportPreview?.fullContent) && (
            <button type="button" className="content-import-secondary" onClick={() => void copyDistilled()}>
              {copied ? <><Check size={15} aria-hidden="true" /> 已复制</> : <><Copy size={15} aria-hidden="true" /> 复制文本</>}
            </button>
          )}
        </div>

        {lastExportPreview?.textPreview && (
          <details className="freedom-export-preview">
            <summary>查看已生成内容预览（{lastExportPreview.filename} · 约 {Math.max(1, Math.round(lastExportPreview.size / 1024))} KB）</summary>
            <pre>{lastExportPreview.textPreview}</pre>
          </details>
        )}
      </div>

      {error && <div className="content-import-error" role="alert">{error}</div>}
      {notice && <div className="content-import-success" role="status">{notice}</div>}
    </section>
  );
}
