import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  FileSearch,
  GitCompareArrows,
  Layers,
  MessageCircle,
  Pill,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  ARCHITECTURE_STRATEGY,
  MEDICAL_AI_DISCLAIMER,
  MEDICAL_RAG_BENCHMARK,
  OPHTHALMIC_DRUG_CATEGORIES,
  OPHTHALMIC_DRUGS,
  OPHTHALMIC_KB_CATEGORIES,
  OPHTHALMIC_KNOWLEDGE_ENTRIES,
  OPHTHALMIC_PERIOP_PROTOCOLS,
  SAMPLE_CLINICAL_REPORTS,
  SAMPLE_CROSS_DEVICE_PRESETS,
  SAMPLE_LONGITUDINAL_VISITS,
  TEMPLATE_LABELS,
  ZSH_COHORT_BENCHMARK,
  analyzeLongitudinalVisits,
  buildGroundedMedicalPrompt,
  checkOphthalmicDrugSafety,
  formatClinicalSummaryMarkdown,
  parseOphthalmicReportText,
  runCrossDeviceValidation,
  searchMedicalRag,
  validateOphthalmicRecord,
} from "./medical-ai-data.js";
import { HorizontalBarChart, MiniSparkline, ScoreTripletBars } from "./DataVizPrimitives.jsx";
import { SmartHoverCard } from "./SmartTooltip.jsx";
import { copyDiagnosticText, recordBreadcrumb } from "./client-diagnostics.js";
import "./medical-ai-studio.css";

const VISITS_STORAGE_KEY = "dengta.medical.visits.v1";

function cloneCrossPreset(key) {
  const src = SAMPLE_CROSS_DEVICE_PRESETS[key] || SAMPLE_CROSS_DEVICE_PRESETS.conflict;
  return src.map((item) => ({ ...item, fields: { ...item.fields } }));
}

function readLocalVisits() {
  try {
    const raw = globalThis.localStorage?.getItem?.(VISITS_STORAGE_KEY);
    if (!raw) return SAMPLE_LONGITUDINAL_VISITS.map((v) => ({ ...v }));
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length
      ? parsed
      : SAMPLE_LONGITUDINAL_VISITS.map((v) => ({ ...v }));
  } catch {
    return SAMPLE_LONGITUDINAL_VISITS.map((v) => ({ ...v }));
  }
}

function writeLocalVisits(visits) {
  try {
    globalThis.localStorage?.setItem?.(VISITS_STORAGE_KEY, JSON.stringify(visits.slice(0, 40)));
  } catch {
    // Ignore private-mode storage denial.
  }
}

function triggerFileDownload(filename, content, mimeType) {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return false;
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

const SAMPLE_RAG_QUESTIONS = [
  "做完激光眼压20正常吗角膜很薄",
  "晚上开车炫光暗瞳太大用什么眼药水",
  "散瞳前房浅能点美多丽吗",
  "术后防雾状混浊Haze怎么阶梯滴氟米龙",
  "圆锥角膜筛查红线Kmax和最薄点是多少",
  "发烧38.5吃感冒灵还能吃泰诺林吗",
];

function OphthalmicDrugHoverCard({ drug }) {
  return (
    <div style={{ display: "grid", gap: 6, fontSize: 12, lineHeight: 1.55 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong style={{ fontSize: 13.5 }}>{drug.generic_name}</strong>
        <span className="med-cite-badge">{drug.dosage_form}</span>
      </div>
      <div style={{ opacity: 0.78 }}>{drug.brand_examples} · {drug.english_name}</div>
      <div><strong>围术期阶段：</strong>{drug.peri_op_phase}</div>
      <div><strong>典型用法：</strong>{drug.typical_regimen}</div>
      <div><strong>禁忌警示：</strong>{drug.contraindications}</div>
      <div className="med-item-warn"><strong>监测重点：</strong>{drug.key_monitoring}</div>
    </div>
  );
}

export default function MedicalAiStudio({
  aiName = "小灯",
  onSendToChat,
  onOpenHouseholdMeds,
}) {
  const [tab, setTab] = useState("validator");
  const [rawReport, setRawReport] = useState(SAMPLE_CLINICAL_REPORTS[0].text);
  const [templateId, setTemplateId] = useState("zeiss_treatment");
  const [fields, setFields] = useState(() => parseOphthalmicReportText(SAMPLE_CLINICAL_REPORTS[0].text).fields);
  const [consultQuestion, setConsultQuestion] = useState(SAMPLE_CLINICAL_REPORTS[0].question);
  const [copyToast, setCopyToast] = useState("");

  // Tab 2: Hybrid Semantic RAG Studio
  const [ragQuery, setRagQuery] = useState("做完激光眼压20正常吗角膜很薄");
  const [ragMode, setRagMode] = useState("hybrid");
  const [ragDomain, setRagDomain] = useState("all");
  const [kbCategory, setKbCategory] = useState("all");

  // Tab 3: Ophthalmic Formulary + Safety Checker
  const [drugCategory, setDrugCategory] = useState("all");
  const [drugSearch, setDrugSearch] = useState("");
  const [selectedDrugIds, setSelectedDrugIds] = useState(["fluorometholone_01", "timolol"]);
  const [clinicalFlags, setClinicalFlags] = useState({
    asthmaOrBradycardia: false,
    shallowAcd: false,
    viralKeratitis: false,
    steroidResponder: false,
  });

  // Tab Follow-Up: 3-Device Cross-Consistency + Local Longitudinal Visits + Zero-PII Export
  const [crossDevices, setCrossDevices] = useState(() => cloneCrossPreset("conflict"));
  const [visits, setVisits] = useState(() => readLocalVisits());
  const [newVisit, setNewVisit] = useState({
    date: "2026-11-25",
    eye: "OD",
    iop: "16.5",
    al: "25.63",
    se: "-0.75",
    note: "",
  });

  const validation = useMemo(
    () => validateOphthalmicRecord({ template_id: templateId, fields }),
    [templateId, fields],
  );

  const crossDeviceResult = useMemo(
    () => runCrossDeviceValidation(crossDevices),
    [crossDevices],
  );

  const longitudinalResult = useMemo(
    () => analyzeLongitudinalVisits(visits),
    [visits],
  );

  const summaryMarkdown = useMemo(
    () => formatClinicalSummaryMarkdown({
      validationResult: validation,
      crossDeviceResult,
      longitudinalResult,
      consultQuestion,
    }),
    [validation, crossDeviceResult, longitudinalResult, consultQuestion],
  );

  const groundedPromptBundle = useMemo(
    () => buildGroundedMedicalPrompt({
      question: consultQuestion,
      validationResult: validation,
      mode: "hybrid",
      limit: 4,
    }),
    [consultQuestion, validation],
  );

  const ragOut = useMemo(
    () => searchMedicalRag({ query: ragQuery, domain: ragDomain, mode: ragMode, limit: 12 }),
    [ragQuery, ragDomain, ragMode],
  );

  const ragQuestionPrompt = useMemo(
    () => buildGroundedMedicalPrompt({ question: ragQuery, mode: ragMode, limit: 5 }),
    [ragQuery, ragMode],
  );

  const filteredIndicators = useMemo(() => {
    if (kbCategory === "all") return OPHTHALMIC_KNOWLEDGE_ENTRIES;
    return OPHTHALMIC_KNOWLEDGE_ENTRIES.filter((item) => item.category === kbCategory);
  }, [kbCategory]);

  const filteredOphthalmicDrugs = useMemo(() => {
    let list = drugCategory === "all"
      ? OPHTHALMIC_DRUGS
      : OPHTHALMIC_DRUGS.filter((d) => d.category === drugCategory);
    const q = drugSearch.trim().toLowerCase();
    if (q) {
      const hits = searchMedicalRag({ query: q, domain: "ophthalmic_drug", mode: "hybrid", limit: 30 });
      const ids = new Set(hits.results.map((r) => r.id.replace(/^oph_drug_/, "")));
      list = list.filter((d) => ids.has(d.id));
    }
    return list;
  }, [drugCategory, drugSearch]);

  const drugSafety = useMemo(
    () => checkOphthalmicDrugSafety(selectedDrugIds, clinicalFlags),
    [selectedDrugIds, clinicalFlags],
  );

  function loadSample(sample) {
    const parsed = parseOphthalmicReportText(sample.text);
    setRawReport(sample.text);
    setTemplateId(parsed.template_id);
    setFields(parsed.fields);
    setConsultQuestion(sample.question);
    recordBreadcrumb({ kind: "medical", message: `Loaded sample ${sample.id}` });
  }

  function handleParseRawText() {
    const parsed = parseOphthalmicReportText(rawReport);
    setTemplateId(parsed.template_id);
    setFields(parsed.fields);
    recordBreadcrumb({ kind: "medical", message: `Parsed clinical text (${parsed.template_id})` });
  }

  function updateField(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function toggleDrug(id) {
    setSelectedDrugIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function updateCrossDeviceField(deviceId, fieldKey, value) {
    setCrossDevices((current) => current.map((dev) => (
      dev.id === deviceId
        ? { ...dev, fields: { ...dev.fields, [fieldKey]: value } }
        : dev
    )));
  }

  function handleAddVisit(event) {
    event.preventDefault();
    if (!String(newVisit.date || "").trim()) return;
    setVisits((current) => {
      const next = [
        ...current,
        {
          id: `v-${Date.now()}`,
          date: String(newVisit.date).trim(),
          eye: newVisit.eye || "OD",
          iop: String(newVisit.iop || "").trim(),
          al: String(newVisit.al || "").trim(),
          se: String(newVisit.se || "").trim(),
          note: String(newVisit.note || "").trim() || "常规门诊复查",
        },
      ];
      writeLocalVisits(next);
      return next;
    });
    setNewVisit((prev) => ({ ...prev, note: "" }));
    recordBreadcrumb({ kind: "medical", message: "Added local pseudonymized follow-up visit" });
  }

  function handleRemoveVisit(visitId) {
    setVisits((current) => {
      const next = current.filter((v) => v.id !== visitId);
      writeLocalVisits(next);
      return next;
    });
  }

  function handleResetVisits() {
    const seeded = SAMPLE_LONGITUDINAL_VISITS.map((v) => ({ ...v }));
    writeLocalVisits(seeded);
    setVisits(seeded);
  }

  function handleDownloadSummary(format) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      const payload = JSON.stringify({
        exportedAt: new Date().toISOString(),
        privacy: "Zero-PII local export",
        disclaimer: MEDICAL_AI_DISCLAIMER,
        singleReportValidation: validation,
        crossDeviceConsistency: crossDeviceResult,
        longitudinalAnalysis: longitudinalResult,
      }, null, 2);
      const ok = triggerFileDownload(`dengta-medical-summary-${stamp}.json`, payload, "application/json;charset=utf-8");
      setCopyToast(ok ? "已导出脱敏 JSON 临床数据！" : "当前环境不支持文件下载，请使用复制按钮。");
    } else {
      const ok = triggerFileDownload(`dengta-medical-summary-${stamp}.md`, summaryMarkdown, "text/markdown;charset=utf-8");
      setCopyToast(ok ? "已导出脱敏 Markdown 复诊摘要！" : "当前环境不支持文件下载，请使用复制按钮。");
    }
    window.setTimeout(() => setCopyToast(""), 2600);
  }

  async function handleCopyPrompt(text) {
    const ok = await copyDiagnosticText(text);
    setCopyToast(ok ? "已复制 Grounded RAG 医疗上下文！" : "复制失败，请手动选中复制。");
    window.setTimeout(() => setCopyToast(""), 2400);
  }

  function handleSendPrompt(text) {
    recordBreadcrumb({ kind: "medical", message: "Sent Grounded RAG prompt to chat AI" });
    onSendToChat?.(text);
  }

  return (
    <section className="med-studio-page" aria-label="灯塔医疗 AI 专区">
      <header className="med-hero">
        <div>
          <span className="med-eyebrow">
            <Stethoscope size={13} aria-hidden="true" />
            MIGRATED FROM ZSH · HYBRID SEMANTIC RAG + L1 CLINICAL GUARDRAILS
          </span>
          <h2>
            <Eye size={22} aria-hidden="true" />
            灯塔医疗 AI 专区（Medical AI Studio）
          </h2>
          <p>
            完整迁移并融合 <code>E:\zsh</code> 眼科临床知识底座与 DengTa 全科药箱：采用
            <strong>「L1 确定性生物力学与临床规则护栏 + L2 混合语义增强检索 (BM25+余弦+RRF) + L3 Grounded RAG 证据装配」</strong>
            三层架构，让 {aiName} 的每次医疗解读都有据可依、零算术幻觉。
          </p>
        </div>
        <div className="med-hero-meta">
          <span className="med-stat-chip"><BookOpen size={13} aria-hidden="true" />{OPHTHALMIC_KNOWLEDGE_ENTRIES.length} 项临床指标</span>
          <span className="med-stat-chip"><Pill size={13} aria-hidden="true" />{OPHTHALMIC_DRUGS.length} 种眼科药 + 4 套围术期方案</span>
          <span className="med-stat-chip"><BarChart3 size={13} aria-hidden="true" />{ZSH_COHORT_BENCHMARK.cohortKpi.totalRecords} 页脱敏医院队列</span>
          {onOpenHouseholdMeds ? (
            <button
              type="button"
              className="med-btn-secondary"
              data-dt-tip="跳转到家庭常备 28 种 OTC 药品与世界书语义库"
              onClick={onOpenHouseholdMeds}
            >
              <Pill size={13} aria-hidden="true" />
              家庭常备药箱
            </button>
          ) : null}
        </div>
      </header>

      <div className="med-disclaimer" role="note">
        <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{MEDICAL_AI_DISCLAIMER}</span>
      </div>

      <nav className="med-tabs" role="tablist" aria-label="医疗 AI 专区模块">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "validator"}
          className={tab === "validator" ? "is-active" : ""}
          data-dt-tip="粘贴检查单文本或输入指标，运行 L1 生物力学与临床红线校验并一键发起 Grounded RAG 问诊"
          onClick={() => setTab("validator")}
        >
          <ClipboardCheck size={15} aria-hidden="true" />
          临床报告校验 & RAG 问诊
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "followup"}
          className={tab === "followup" ? "is-active" : ""}
          data-dt-tip="三设备跨单据一致性校验（IOLMaster/Pentacam/ZEISS）、本地脱敏随访趋势图与复诊摘要导出"
          onClick={() => setTab("followup")}
        >
          <GitCompareArrows size={15} aria-hidden="true" />
          跨设备校验 & 随访导出
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "rag"}
          className={tab === "rag" ? "is-active" : ""}
          data-dt-tip="混合语义检索全部 80+ 条眼科指标、眼科药典、围术期方案与常备 OTC 药品"
          onClick={() => setTab("rag")}
        >
          <Search size={15} aria-hidden="true" />
          混合语义 RAG 检索引擎
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "formulary"}
          className={tab === "formulary" ? "is-active" : ""}
          data-dt-tip={`查询 ${OPHTHALMIC_DRUGS.length} 种眼科专业用药、${OPHTHALMIC_PERIOP_PROTOCOLS.length} 套围术期阶梯方案及眼科 X 级禁忌核查`}
          onClick={() => setTab("formulary")}
        >
          <Pill size={15} aria-hidden="true" />
          眼科药典与围术期方案
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "cohort"}
          className={tab === "cohort" ? "is-active" : ""}
          data-dt-tip="查看从 zsh 迁移的真实医院脱敏多设备队列统计、消融实验与温度校准数据"
          onClick={() => setTab("cohort")}
        >
          <BarChart3 size={15} aria-hidden="true" />
          脱敏科研队列与消融看板
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "architecture"}
          className={tab === "architecture" ? "is-active" : ""}
          data-dt-tip="查看 AI 产品经理关于 RAG vs 语义增强检索的三层架构选型论证"
          onClick={() => setTab("architecture")}
        >
          <Layers size={15} aria-hidden="true" />
          AI PM 架构选型
        </button>
      </nav>

      {/* ==================== TAB 1: L1 Clinical Validator + L3 Grounded RAG ==================== */}
      {tab === "validator" && (
        <div className="med-panel">
          <div className="med-card">
            <div className="med-card-head">
              <h3><FileSearch size={16} aria-hidden="true" />一键载入脱敏临床案例或粘贴检查报告文本</h3>
              <small>自动清洗 0D→OD、回K→OK 等 OCR 伪影，纯本地脱敏解析</small>
            </div>
            <div className="med-sample-row">
              {SAMPLE_CLINICAL_REPORTS.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  className="med-sample-btn"
                  data-dt-tip="一键载入该脱敏案例并自动触发 L1 临床校验与用药推荐"
                  onClick={() => loadSample(sample)}
                >
                  <span className="med-sample-badge">{sample.badge}</span>
                  <span>{sample.label}</span>
                </button>
              ))}
            </div>
            <div className="med-two-col">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  className="med-textarea"
                  value={rawReport}
                  onChange={(e) => setRawReport(e.target.value)}
                  aria-label="粘贴眼科检查报告或 OCR 文本"
                  placeholder="粘贴 IOLMaster / Pentacam / ZEISS MEL90 或门诊验光单文本…"
                />
                <div className="med-actions-row">
                  <button type="button" className="med-btn-primary" onClick={handleParseRawText}>
                    <Sparkles size={14} aria-hidden="true" />
                    自动抽取结构化指标
                  </button>
                  <select
                    className="med-input"
                    style={{ width: "auto", minWidth: 190 }}
                    aria-label="临床单据模板类型"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                  >
                    {Object.entries(TEMPLATE_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="med-field-grid" aria-label="可微调结构化眼科指标">
                {[
                  ["treatment_type", "术式 (TPRK/FS-LASIK)"],
                  ["cct", "中央角膜厚度 CCT (μm)"],
                  ["thinnest_locat_pachy", "最薄点厚度 (μm)"],
                  ["kmax_front", "最大曲率 Kmax (D)"],
                  ["al", "眼轴长度 AL (mm)"],
                  ["acd", "前房深度 ACD (mm)"],
                  ["sphere", "球镜 Sphere (D)"],
                  ["cylinder", "柱镜 Cylinder (D)"],
                  ["optical_zone", "光学区 OZ (mm)"],
                  ["ablation_depth", "切削深度 (μm)"],
                  ["iop", "眼压 IOP (mmHg)"],
                  ["pupil", "暗瞳直径 (mm)"],
                  ["k1", "平K K1 (D)"],
                  ["k2", "陡K K2 (D)"],
                ].map(([key, label]) => (
                  <div className="med-field-box" key={key}>
                    <label htmlFor={`med-f-${key}`}>{label}</label>
                    <input
                      id={`med-f-${key}`}
                      type="text"
                      value={fields[key] || ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      placeholder="选填"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="med-card">
            <div className="med-card-head">
              <h3><ShieldAlert size={16} aria-hidden="true" />L1 确定性临床语义校验与安全红线结论</h3>
              <span className={`med-status-pill is-${validation.validation_status}`}>
                {validation.validation_status === "REVIEW"
                  ? "REVIEW · 触发高危临床红线"
                  : validation.validation_status === "WARN"
                    ? "WARN · 需关注/复核"
                    : "PASS · 生理与光学自洽"}
              </span>
            </div>

            {Object.keys(validation.derived).length > 0 && (
              <div className="med-derived-grid">
                {Object.entries(validation.derived).map(([k, v]) => (
                  <span className="med-derived-chip" key={k}>
                    {k === "se_calc" ? "等效球镜 SE"
                      : k === "rsb_um" ? "剩余基质床 RSB"
                        : k === "pta_pct" ? "组织改变比 PTA"
                          : k === "munnerlyn_estimated_ablation_um" ? "Munnerlyn 估算切削"
                            : k === "ehlers_corrected_iop" ? "薄角膜 Ehlers 校正眼压"
                              : k}
                    <strong>{v}</strong>
                  </span>
                ))}
              </div>
            )}

            {validation.alerts.length > 0 ? (
              <ul className="med-alert-list" role="alert">
                {validation.alerts.map((alert, index) => (
                  <li key={`${alert.rule}-${index}`} className={`is-${alert.level}`}>
                    <span className="med-alert-tag">{alert.level} · {alert.rule}</span>
                    <span>{alert.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, color: "#15803d", fontSize: 13 }}>
                <CheckCircle2 size={15} aria-hidden="true" />
                所有已填指标均位于生理参考区间且满足光学与生物力学公式约束。
              </p>
            )}

            {validation.recommendations?.reasons?.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>上下文智能关联参考用药与围术期提醒：</strong>
                {validation.recommendations.reasons.map((r, i) => (
                  <div key={i} style={{ fontSize: 12.3, color: "var(--theme-muted)" }}>• {r}</div>
                ))}
                <div className="med-sample-row">
                  {validation.recommendations.drugs.map((drug) => (
                    <SmartHoverCard
                      key={drug.id}
                      placement="top"
                      trigger={
                        <span className="med-stat-chip" style={{ cursor: "help" }}>
                          <Pill size={12} aria-hidden="true" />
                          {drug.generic_name}
                        </span>
                      }
                      content={<OphthalmicDrugHoverCard drug={drug} />}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="med-card">
            <div className="med-card-head">
              <h3><MessageCircle size={16} aria-hidden="true" />L3 Grounded RAG 证据装配 → 直连 {aiName} 深度解读</h3>
              <small>自动附带 L1 精确计算值 + {groundedPromptBundle.rag.results.length} 条权威指南引用 [M1..M{groundedPromptBundle.rag.results.length}]</small>
            </div>
            <input
              type="text"
              className="med-input"
              value={consultQuestion}
              onChange={(e) => setConsultQuestion(e.target.value)}
              aria-label="向医疗 AI 伴侣提问"
              placeholder="输入你想问伴侣的医疗解读问题…"
            />
            <pre className="med-prompt-preview">{groundedPromptBundle.prompt}</pre>
            <div className="med-actions-row">
              {onSendToChat && (
                <button
                  type="button"
                  className="med-btn-primary"
                  data-dt-tip="携带结构化 L1 校验与 [M1..M4] 权威证据一键发给 DengTa 聊天 AI 解读"
                  onClick={() => handleSendPrompt(groundedPromptBundle.prompt)}
                >
                  <MessageCircle size={14} aria-hidden="true" />
                  带着临床证据问 {aiName}
                </button>
              )}
              <button
                type="button"
                className="med-btn-secondary"
                onClick={() => void handleCopyPrompt(groundedPromptBundle.prompt)}
              >
                <Copy size={14} aria-hidden="true" />
                复制 RAG 证据包
              </button>
              {copyToast && <span style={{ fontSize: 12, color: "#0e7490", fontWeight: 600 }}>{copyToast}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB FOLLOW-UP: Cross-Device Consistency + Longitudinal Trends + Export ==================== */}
      {tab === "followup" && (
        <div className="med-panel">
          <div className="med-card">
            <div className="med-card-head">
              <h3><GitCompareArrows size={16} aria-hidden="true" />三源跨设备一致性核验（源自 zsh `run_cross_document_validation`）</h3>
              <span className={`med-status-pill is-${crossDeviceResult.status}`}>
                {crossDeviceResult.status === "REVIEW"
                  ? "REVIEW · 跨机红线冲突"
                  : crossDeviceResult.status === "WARN"
                    ? "WARN · 存在设备偏差"
                    : "PASS · 多机测量一致"}
              </span>
            </div>
            <div className="med-sample-row">
              <button
                type="button"
                className="med-sample-btn"
                data-dt-tip="演示同眼 IOLMaster / Pentacam / ZEISS 角膜厚度极差 > 35μm 与 K1 极差 > 1.5D 冲突"
                onClick={() => setCrossDevices(cloneCrossPreset("conflict"))}
              >
                <span className="med-sample-badge">冲突演示</span>
                <span>载入三机 CCT/K1 冲突案例</span>
              </button>
              <button
                type="button"
                className="med-sample-btn"
                data-dt-tip="演示三台设备在生理误差允许范围内高度一致"
                onClick={() => setCrossDevices(cloneCrossPreset("consistent"))}
              >
                <span>载入三机一致正常样本</span>
              </button>
            </div>

            <div className="med-cross-grid">
              {crossDevices.map((dev) => {
                const cctKey = dev.template_id === "cornea" ? "pachy_apex_pachy" : "cct";
                const k1Key = dev.template_id === "cornea" ? "front_k1" : "k1";
                const acdKey = dev.template_id === "cornea" ? "acd_int" : "acd";
                const iopKey = dev.template_id === "cornea" ? "enter_iop" : "iop";
                return (
                  <article key={dev.id} className="med-item-card">
                    <div className="med-item-title">
                      <h4>{dev.label}</h4>
                      <span className="med-cite-badge">{dev.eye}</span>
                    </div>
                    <div className="med-field-grid">
                      <div className="med-field-box">
                        <label htmlFor={`cd-${dev.id}-cct`}>角膜厚度 (μm)</label>
                        <input
                          id={`cd-${dev.id}-cct`}
                          type="text"
                          value={dev.fields[cctKey] || ""}
                          onChange={(e) => updateCrossDeviceField(dev.id, cctKey, e.target.value)}
                          placeholder="如 520"
                        />
                      </div>
                      <div className="med-field-box">
                        <label htmlFor={`cd-${dev.id}-k1`}>平K K1 (D)</label>
                        <input
                          id={`cd-${dev.id}-k1`}
                          type="text"
                          value={dev.fields[k1Key] || ""}
                          onChange={(e) => updateCrossDeviceField(dev.id, k1Key, e.target.value)}
                          placeholder="如 43.2"
                        />
                      </div>
                      <div className="med-field-box">
                        <label htmlFor={`cd-${dev.id}-acd`}>前房 ACD (mm)</label>
                        <input
                          id={`cd-${dev.id}-acd`}
                          type="text"
                          value={dev.fields[acdKey] || ""}
                          onChange={(e) => updateCrossDeviceField(dev.id, acdKey, e.target.value)}
                          placeholder="选填"
                        />
                      </div>
                      <div className="med-field-box">
                        <label htmlFor={`cd-${dev.id}-iop`}>眼压 IOP (mmHg)</label>
                        <input
                          id={`cd-${dev.id}-iop`}
                          type="text"
                          value={dev.fields[iopKey] || ""}
                          onChange={(e) => updateCrossDeviceField(dev.id, iopKey, e.target.value)}
                          placeholder="选填"
                        />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {crossDeviceResult.metrics.length > 0 && (
              <div className="med-derived-grid">
                {crossDeviceResult.metrics.map((m) => (
                  <span className="med-derived-chip" key={`${m.eye}-${m.key}`}>
                    Δ{m.label} ({m.min}–{m.max}{m.unit})
                    <strong>极差 {m.spread}{m.unit}</strong>
                  </span>
                ))}
              </div>
            )}

            {crossDeviceResult.findings.length > 0 ? (
              <ul className="med-alert-list" role="alert">
                {crossDeviceResult.findings.map((f, idx) => (
                  <li key={`${f.rule}-${idx}`} className={`is-${f.level}`}>
                    <span className="med-alert-tag">{f.level} · {f.rule}</span>
                    <span>{f.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, color: "#15803d", fontSize: 13 }}>
                <CheckCircle2 size={15} aria-hidden="true" />
                三源设备测量值高度一致，未超过跨机极差警戒阈值（CCT ≤ 20μm、K1 ≤ 0.75D、ACD ≤ 0.35mm、IOP ≤ 4mmHg）。
              </p>
            )}
          </div>

          <div className="med-card">
            <div className="med-card-head">
              <h3><TrendingUp size={16} aria-hidden="true" />本地脱敏随访趋势追踪（仅存本机浏览器 · 零 PII）</h3>
              <div className="med-actions-row">
                <span className={`med-status-pill is-${longitudinalResult.status}`}>
                  共 {longitudinalResult.visitCount} 次随访 · {longitudinalResult.status}
                </span>
                <button type="button" className="med-btn-secondary" onClick={handleResetVisits}>
                  <RotateCcw size={13} aria-hidden="true" />
                  恢复脱敏示例
                </button>
              </div>
            </div>

            <div className="med-spark-grid">
              <div className="med-spark-card">
                <div className="med-spark-head">
                  <small>眼压 IOP 趋势 (mmHg)</small>
                  <strong>{longitudinalResult.summary.iopLatest ?? "—"} mmHg</strong>
                </div>
                <MiniSparkline points={longitudinalResult.series.iop} label="眼压随访趋势" width={220} height={48} />
                <small className="med-spark-meta">
                  较基线变化：{longitudinalResult.summary.iopDelta === null ? "—" : `${longitudinalResult.summary.iopDelta >= 0 ? "+" : ""}${longitudinalResult.summary.iopDelta} mmHg`}
                </small>
              </div>
              <div className="med-spark-card">
                <div className="med-spark-head">
                  <small>眼轴 AL 趋势 (mm)</small>
                  <strong>{longitudinalResult.summary.alLatest ?? "—"} mm</strong>
                </div>
                <MiniSparkline points={longitudinalResult.series.al} label="眼轴随访趋势" width={220} height={48} />
                <small className="med-spark-meta">
                  年化增速：{longitudinalResult.summary.alAnnualizedMm === null ? "—" : `${longitudinalResult.summary.alAnnualizedMm >= 0 ? "+" : ""}${longitudinalResult.summary.alAnnualizedMm} mm/年`}
                </small>
              </div>
              <div className="med-spark-card">
                <div className="med-spark-head">
                  <small>等效球镜 SE 趋势 (D)</small>
                  <strong>{longitudinalResult.summary.seLatest ?? "—"} D</strong>
                </div>
                <MiniSparkline
                  points={longitudinalResult.series.se.map((p) => ({ value: Math.abs(p.value) }))}
                  label="等效球镜绝对值变化趋势"
                  width={220}
                  height={48}
                />
                <small className="med-spark-meta">
                  区间漂移：{longitudinalResult.summary.seDelta === null ? "—" : `${longitudinalResult.summary.seDelta >= 0 ? "+" : ""}${longitudinalResult.summary.seDelta} D`}
                </small>
              </div>
            </div>

            {longitudinalResult.alerts.length > 0 && (
              <ul className="med-alert-list" role="alert">
                {longitudinalResult.alerts.map((a, idx) => (
                  <li key={`${a.rule}-${idx}`} className={`is-${a.level}`}>
                    <span className="med-alert-tag">{a.level} · {a.rule}</span>
                    <span>{a.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <form className="med-visit-form" onSubmit={handleAddVisit}>
              <input type="date" className="med-input" aria-label="随访日期" value={newVisit.date} onChange={(e) => setNewVisit((p) => ({ ...p, date: e.target.value }))} />
              <select className="med-input" aria-label="眼别" value={newVisit.eye} onChange={(e) => setNewVisit((p) => ({ ...p, eye: e.target.value }))}>
                <option value="OD">OD (右眼)</option>
                <option value="OS">OS (左眼)</option>
                <option value="OU">OU (双眼)</option>
              </select>
              <input type="text" className="med-input" aria-label="眼压 IOP" placeholder="IOP mmHg" value={newVisit.iop} onChange={(e) => setNewVisit((p) => ({ ...p, iop: e.target.value }))} />
              <input type="text" className="med-input" aria-label="眼轴 AL" placeholder="AL mm" value={newVisit.al} onChange={(e) => setNewVisit((p) => ({ ...p, al: e.target.value }))} />
              <input type="text" className="med-input" aria-label="等效球镜 SE" placeholder="SE D" value={newVisit.se} onChange={(e) => setNewVisit((p) => ({ ...p, se: e.target.value }))} />
              <input type="text" className="med-input" aria-label="脱敏复查备注" placeholder="脱敏备注（不含姓名）" value={newVisit.note} onChange={(e) => setNewVisit((p) => ({ ...p, note: e.target.value }))} />
              <button type="submit" className="med-btn-primary">
                <Plus size={14} aria-hidden="true" />
                记录本次随访
              </button>
            </form>

            <div className="med-table-wrap">
              <table className="med-visit-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>眼别</th>
                    <th>眼压 IOP</th>
                    <th>眼轴 AL</th>
                    <th>等效球镜 SE</th>
                    <th>脱敏备注</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {longitudinalResult.sortedVisits.map((v) => (
                    <tr key={v.id}>
                      <td>{v.date}</td>
                      <td><span className="med-cite-badge">{v.eye}</span></td>
                      <td>{v.iop !== null ? `${v.iop} mmHg` : "—"}</td>
                      <td>{v.al !== null ? `${v.al} mm` : "—"}</td>
                      <td>{v.se !== null ? `${v.se} D` : "—"}</td>
                      <td>{v.note || "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="med-icon-btn"
                          aria-label={`删除 ${v.date} 记录`}
                          onClick={() => handleRemoveVisit(v.id)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="med-card">
            <div className="med-card-head">
              <h3><Download size={16} aria-hidden="true" />Zero-PII 复诊摘要导出（Markdown / JSON / 问 {aiName}）</h3>
              <small>整合单报告校验 + 三设备一致性 + 随访趋势，不含任何个人身份信息</small>
            </div>
            <pre className="med-prompt-preview">{summaryMarkdown}</pre>
            <div className="med-actions-row">
              <button type="button" className="med-btn-primary" onClick={() => void handleCopyPrompt(summaryMarkdown)}>
                <Copy size={14} aria-hidden="true" />
                复制 Markdown 复诊摘要
              </button>
              <button type="button" className="med-btn-secondary" onClick={() => handleDownloadSummary("md")}>
                <Download size={14} aria-hidden="true" />
                下载 .md 复诊单
              </button>
              <button type="button" className="med-btn-secondary" onClick={() => handleDownloadSummary("json")}>
                <Download size={14} aria-hidden="true" />
                下载 .json 结构化数据
              </button>
              {onSendToChat && (
                <button type="button" className="med-btn-secondary" onClick={() => handleSendPrompt(summaryMarkdown)}>
                  <MessageCircle size={14} aria-hidden="true" />
                  带着完整随访摘要问 {aiName}
                </button>
              )}
              {copyToast && <span style={{ fontSize: 12, color: "#0e7490", fontWeight: 600 }}>{copyToast}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 2: Hybrid Semantic RAG Studio ==================== */}
      {tab === "rag" && (
        <div className="med-panel">
          <div className="med-card">
            <div className="med-card-head">
              <h3><Search size={16} aria-hidden="true" />统一医疗混合语义 RAG 检索引擎（共索引 {ragOut.totalIndexed} 条权威知识）</h3>
              <small>耗时 {ragOut.latencyMs} ms · 命中 {ragOut.results.length} 条证据</small>
            </div>
            <input
              type="search"
              className="med-input"
              value={ragQuery}
              onChange={(e) => setRagQuery(e.target.value)}
              aria-label="混合语义医疗检索"
              placeholder="输入口语症状或专业缩写（如：薄角膜眼压20、夜间眩光、散瞳浅前房、RSB红线、防Haze）…"
            />
            <div className="med-sample-row">
              {SAMPLE_RAG_QUESTIONS.map((q) => (
                <button key={q} type="button" className="med-sample-btn" onClick={() => setRagQuery(q)}>
                  <Sparkles size={12} aria-hidden="true" />
                  {q}
                </button>
              ))}
            </div>
            <div className="med-actions-row" style={{ justifyContent: "space-between" }}>
              <div className="med-cat-row" role="group" aria-label="检索算法对比">
                {[
                  ["hybrid", "混合 RRF 融合（推荐）"],
                  ["bm25", "纯 BM25"],
                  ["semantic", "同义词 + 余弦"],
                ].map(([m, label]) => (
                  <button key={m} type="button" className={ragMode === m ? "is-active" : ""} onClick={() => setRagMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="med-cat-row" role="group" aria-label="知识域过滤">
                {[
                  ["all", "全部医疗域"],
                  ["ophthalmic_indicator", `眼科指标 (${OPHTHALMIC_KNOWLEDGE_ENTRIES.length})`],
                  ["ophthalmic_drug", `眼科药典 (${OPHTHALMIC_DRUGS.length})`],
                  ["periop_protocol", `围术期方案 (${OPHTHALMIC_PERIOP_PROTOCOLS.length})`],
                  ["household_otc", `常备OTC (${Math.max(0, ragOut.totalIndexed - OPHTHALMIC_KNOWLEDGE_ENTRIES.length - OPHTHALMIC_DRUGS.length - OPHTHALMIC_PERIOP_PROTOCOLS.length)})`],
                ].map(([d, label]) => (
                  <button key={d} type="button" className={ragDomain === d ? "is-active" : ""} onClick={() => setRagDomain(d)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {ragOut.expandedConcepts?.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--theme-muted)" }}>
                语义概念扩展触发：<strong>{ragOut.expandedConcepts.join(" · ")}</strong>
              </div>
            )}
            <div className="med-actions-row">
              {onSendToChat && ragQuery.trim() && (
                <button
                  type="button"
                  className="med-btn-primary"
                  onClick={() => handleSendPrompt(ragQuestionPrompt.prompt)}
                >
                  <MessageCircle size={14} aria-hidden="true" />
                  将 Top-5 证据注入聊天问 {aiName}
                </button>
              )}
            </div>
          </div>

          <div className="med-grid-cards">
            {ragOut.results.map((hit) => (
              <article key={hit.id} className="med-item-card">
                <div className="med-item-title">
                  <h4>{hit.title}</h4>
                  <span className="med-cite-badge">{hit.citation} · {hit.sourceLabel}</span>
                </div>
                <p className="med-item-body">{hit.snippet}</p>
                <ScoreTripletBars
                  bm25={hit.scores.bm25}
                  semantic={hit.scores.semantic}
                  rrf={hit.scores.rrf}
                />
              </article>
            ))}
          </div>

          <div className="med-card">
            <div className="med-card-head">
              <h3><BookOpen size={16} aria-hidden="true" />眼科临床指标速查字典（源自 zsh `knowledge_base.py`）</h3>
              <div className="med-cat-row">
                {OPHTHALMIC_KB_CATEGORIES.map((c) => (
                  <button key={c.id} type="button" className={kbCategory === c.id ? "is-active" : ""} onClick={() => setKbCategory(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="med-grid-cards">
              {filteredIndicators.map((ind) => (
                <article key={ind.id} className="med-item-card">
                  <div className="med-item-title">
                    <h4>{ind.code} · {ind.name_cn}</h4>
                    <span className="med-cite-badge">{ind.unit}</span>
                  </div>
                  <p className="med-item-body"><strong>正常范围：</strong>{ind.normal_range}</p>
                  <p className="med-item-warn"><strong>警戒红线：</strong>{ind.warning_threshold}</p>
                  <p className="med-item-body">{ind.clinical_meaning}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: Ophthalmic Formulary & Peri-Op Protocols ==================== */}
      {tab === "formulary" && (
        <div className="med-panel">
          <div className="med-card">
            <div className="med-card-head">
              <h3><ShieldAlert size={16} aria-hidden="true" />眼科特殊禁忌与联合滴眼安全校验器（已选 {selectedDrugIds.length} 种）</h3>
              <span className={`med-status-pill is-${drugSafety.highestSeverity === "X" ? "REVIEW" : drugSafety.highestSeverity === "D" || drugSafety.highestSeverity === "C" ? "WARN" : "PASS"}`}>
                最高风险等级：{drugSafety.highestSeverity} 级
              </span>
            </div>
            <div className="med-flag-row">
              {[
                ["asthmaOrBradycardia", "合并哮喘 / 慢阻肺 / 心动过缓"],
                ["shallowAcd", "浅前房 (ACD < 2.5mm) / 窄房角"],
                ["viralKeratitis", "活动性单纯疱疹病毒角膜炎"],
                ["steroidResponder", "既往激素性高眼压敏感史"],
              ].map(([flagKey, label]) => (
                <label key={flagKey} className={clinicalFlags[flagKey] ? "is-on" : ""}>
                  <input
                    type="checkbox"
                    checked={clinicalFlags[flagKey]}
                    onChange={(e) => setClinicalFlags((prev) => ({ ...prev, [flagKey]: e.target.checked }))}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {drugSafety.alerts.length > 0 ? (
              <ul className="med-alert-list">
                {drugSafety.alerts.map((a) => (
                  <li key={a.rule} className={`is-${a.severity}`}>
                    <strong>{a.title}</strong>
                    <div>{a.detail}</div>
                    <small style={{ opacity: 0.8 }}>建议：{a.advice}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: "#15803d" }}>当前勾选组合未触发 X/D 级眼科绝对禁忌。</p>
            )}
          </div>

          <div className="med-card">
            <div className="med-card-head">
              <h3><Activity size={16} aria-hidden="true" />4 套标准屈光围术期与应急用药阶梯（源自 zsh `drug_formulary.py`）</h3>
            </div>
            <div className="med-two-col">
              {OPHTHALMIC_PERIOP_PROTOCOLS.map((proto) => (
                <article key={proto.id} className="med-item-card">
                  <h4>{proto.title}</h4>
                  <p className="med-item-body">{proto.summary}</p>
                  <div className="med-protocol-steps">
                    {proto.stages.map((st, idx) => (
                      <div key={idx} className="med-protocol-step">
                        <strong>{st.stage}</strong>
                        <span>{st.regimen}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="med-card">
            <div className="med-card-head">
              <h3><Pill size={16} aria-hidden="true" />眼科临床药典（{OPHTHALMIC_DRUGS.length} 种 · 鼠标悬停药名查看完整药理卡片）</h3>
              <input
                type="search"
                className="med-input"
                style={{ maxWidth: 320 }}
                value={drugSearch}
                onChange={(e) => setDrugSearch(e.target.value)}
                aria-label="检索眼科临床药典"
                placeholder="搜药名/商品名/作用（如：氟米龙、海露、降眼压）…"
              />
            </div>
            <div className="med-cat-row">
              {OPHTHALMIC_DRUG_CATEGORIES.map((c) => (
                <button key={c.id} type="button" className={drugCategory === c.id ? "is-active" : ""} onClick={() => setDrugCategory(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="med-grid-cards">
              {filteredOphthalmicDrugs.map((drug) => {
                const picked = selectedDrugIds.includes(drug.id);
                return (
                  <article key={drug.id} className={`med-item-card${picked ? " is-selected" : ""}`}>
                    <div className="med-item-title">
                      <SmartHoverCard
                        placement="top"
                        trigger={<h4 style={{ cursor: "help", textDecoration: "underline dotted" }}>{drug.generic_name}</h4>}
                        content={<OphthalmicDrugHoverCard drug={drug} />}
                      />
                      <span className="med-cite-badge">{drug.peri_op_phase}</span>
                    </div>
                    <p className="med-item-body">{drug.brand_examples} · {drug.indications}</p>
                    <p className="med-item-warn"><strong>红线监测：</strong>{drug.key_monitoring}</p>
                    <div className="med-actions-row">
                      <button
                        type="button"
                        className={picked ? "med-btn-primary" : "med-btn-secondary"}
                        onClick={() => toggleDrug(drug.id)}
                      >
                        {picked ? "✓ 已加入禁忌检测" : "+ 加入禁忌检测"}
                      </button>
                      {onSendToChat && (
                        <button
                          type="button"
                          className="med-btn-secondary"
                          onClick={() => handleSendPrompt(`请通俗解释眼科用药「${drug.generic_name}（${drug.brand_examples}）」的正确滴法、疗程与核心禁忌：${drug.typical_regimen}；${drug.contraindications}`)}
                        >
                          问 {aiName}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 4: Anonymized Real Cohort & Ablation Analytics ==================== */}
      {tab === "cohort" && (
        <div className="med-panel">
          <div className="med-kpi-row">
            <div className="med-kpi-box"><small>脱敏临床总页数</small><strong>{ZSH_COHORT_BENCHMARK.cohortKpi.totalRecords} 页</strong></div>
            <div className="med-kpi-box"><small>脱敏队列患者</small><strong>{ZSH_COHORT_BENCHMARK.cohortKpi.uniquePatients} 例</strong></div>
            <div className="med-kpi-box"><small>页均校准置信度</small><strong>{ZSH_COHORT_BENCHMARK.cohortKpi.meanConfidencePct}%</strong></div>
            <div className="med-kpi-box"><small>临床规则通过率</small><strong>{ZSH_COHORT_BENCHMARK.cohortKpi.rulePassRatePct}%</strong></div>
            <div className="med-kpi-box"><small>温度校准最优 T*</small><strong>{ZSH_COHORT_BENCHMARK.calibration.optimalT}</strong></div>
            <div className="med-kpi-box"><small>90% 自动放行错误率</small><strong>{ZSH_COHORT_BENCHMARK.calibration.autoPassCoverage90ErrorPct}%</strong></div>
          </div>

          <div className="med-two-col">
            <div className="med-card">
              <div className="med-card-head">
                <h3>四阶段 OCR + 临床语义消融精确率（%）</h3>
                <small>ECE 降幅 -{ZSH_COHORT_BENCHMARK.calibration.eceReductionPct}%</small>
              </div>
              <HorizontalBarChart
                unit="%"
                maxBars={6}
                items={ZSH_COHORT_BENCHMARK.ablation4Stage.map((s) => ({
                  label: `${s.label} (RSB ${s.rsbCaught})`,
                  value: s.accuracyPct,
                }))}
              />
            </div>

            <div className="med-card">
              <div className="med-card-head">
                <h3>多设备单据分布 & Munnerlyn 实测拟合</h3>
                <small>斜率 {ZSH_COHORT_BENCHMARK.munnerlynFit.slopeUmPerD} μm/D · r = {ZSH_COHORT_BENCHMARK.munnerlynFit.r}</small>
              </div>
              <HorizontalBarChart
                unit=" 页"
                maxBars={6}
                items={ZSH_COHORT_BENCHMARK.templateBreakdown.map((t) => ({
                  label: t.name,
                  value: t.count,
                }))}
              />
            </div>
          </div>

          <div className="med-two-col">
            <div className="med-card">
              <div className="med-card-head">
                <h3>L2 医疗 RAG 消融实测 Recall@1（{MEDICAL_RAG_BENCHMARK.queryCount} 问句 × {MEDICAL_RAG_BENCHMARK.corpusTotal} 语料）</h3>
                <small>混合 RRF MRR@5 = 0.951 · nDCG@5 = 0.879</small>
              </div>
              <HorizontalBarChart
                unit="%"
                maxBars={6}
                items={MEDICAL_RAG_BENCHMARK.ragAblation.map((row) => ({
                  label: `${row.label} (MRR ${row.mrrAt5.toFixed(3)})`,
                  value: row.recallAt1Pct,
                }))}
              />
            </div>

            <div className="med-card">
              <div className="med-card-head">
                <h3>L1 / L3 安全护栏全量回归准确率（%）</h3>
                <small>4 大临床安全套件 · 误报/泄露率 0.0%</small>
              </div>
              <HorizontalBarChart
                unit="%"
                maxBars={6}
                items={MEDICAL_RAG_BENCHMARK.safetySuites.map((s) => ({
                  label: s.label,
                  value: s.exactMatchPct,
                }))}
              />
            </div>
          </div>

          <div className="med-grid-cards">
            {Object.entries(ZSH_COHORT_BENCHMARK.distributions).map(([key, dist]) => (
              <div className="med-card" key={key}>
                <div className="med-card-head">
                  <h3>{dist.label}</h3>
                  <small>n={dist.n} · 均值 {dist.mean} ± {dist.sd}</small>
                </div>
                <HorizontalBarChart
                  unit=" 眼"
                  maxBars={8}
                  items={dist.bins.map((b) => ({
                    label: b.label,
                    value: b.count,
                  }))}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== TAB 5: AI PM Architecture Decision ==================== */}
      {tab === "architecture" && (
        <div className="med-panel">
          <div className="med-card">
            <div className="med-card-head">
              <h3><Layers size={16} aria-hidden="true" />AI 产品经理选型决策：{ARCHITECTURE_STRATEGY.title}</h3>
              <span className="med-cite-badge">生产落地架构</span>
            </div>
            <ul className="med-alert-list">
              {ARCHITECTURE_STRATEGY.rationale.map((reason, idx) => (
                <li key={idx}>
                  <span className="med-alert-tag">决策依据 #{idx + 1}</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
            <div className="med-grid-cards">
              {ARCHITECTURE_STRATEGY.layers.map((layer) => (
                <article key={layer.id} className="med-item-card">
                  <div className="med-item-title">
                    <h4>{layer.name}</h4>
                    <span className="med-cite-badge">{layer.id}</span>
                  </div>
                  <p className="med-item-body">{layer.role}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
