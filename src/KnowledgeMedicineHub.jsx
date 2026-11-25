import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BookOpen, Brain, Car, CheckCircle2, Copy, Database,
  Flame, Info, LayoutGrid, List, MessageCircle, Pill, Plus, Search,
  ShieldAlert, ShoppingBag, Sparkles, Wine, Baby, X
} from "lucide-react";
import { createHybridSemanticIndex } from "./semantic-search.js";
import {
  BUILTIN_KNOWLEDGE_ARTICLES,
  checkLocalMedicationInteractions,
  COMMON_MEDICATIONS,
  MEDICAL_DISCLAIMER,
  MEDICATION_CATEGORIES,
  searchLocalMedications,
} from "./medications-data.js";
import { listWorldBookEntries } from "./world-book-api.js";
import { BudgetMeterBar, HorizontalBarChart, ScoreTripletBars } from "./DataVizPrimitives.jsx";
import { SmartHoverCard } from "./SmartTooltip.jsx";
import { copyDiagnosticText, recordBreadcrumb } from "./client-diagnostics.js";
import "./knowledge-hub.css";

const WorldBookManager = lazy(() => import("./WorldBookManager.jsx"));

const SAMPLE_KB_QUERIES = [
  "头疼发烧38.5能喝感冒灵再吃泰诺林吗",
  "胃痛反酸想点清淡养胃的外卖",
  "外卖预算超标或者卡住怎么排查",
  "如何通过 Trace ID 和故障指纹精准修 Bug",
  "花粉过敏开车吃什么药不犯困",
];

const SAMPLE_SYMPTOMS = ["发烧", "痛经", "拉肚子", "胃酸烧心", "感冒鼻塞", "花粉过敏", "口腔溃疡", "擦伤消毒"];

const SEVERITY_META = {
  X: { label: "X 级 · 严禁联用", tone: "is-x" },
  D: { label: "D 级 · 避免/间隔", tone: "is-d" },
  C: { label: "C 级 · 需注意", tone: "is-c" },
  A: { label: "A 级 · 未见高危冲突", tone: "is-a" },
};

function RiskBadge({ kind, value }) {
  const map = {
    alcohol: {
      forbidden: { text: "禁酒", tone: "is-danger", Icon: Wine },
      caution: { text: "慎酒", tone: "is-warn", Icon: Wine },
      safe: { text: "酒精无强禁忌", tone: "is-ok", Icon: Wine },
    },
    driving: {
      avoid: { text: "禁驾车/致嗜睡", tone: "is-danger", Icon: Car },
      caution: { text: "驾车慎用", tone: "is-warn", Icon: Car },
      safe: { text: "一般不嗜睡", tone: "is-ok", Icon: Car },
    },
    pregnancy: {
      forbidden: { text: "孕期禁忌", tone: "is-danger", Icon: Baby },
      caution: { text: "孕期慎用", tone: "is-warn", Icon: Baby },
      consult: { text: "孕期遵医嘱", tone: "is-muted", Icon: Baby },
    },
  };
  const info = map[kind]?.[value];
  if (!info) return null;
  const Icon = info.Icon;
  return (
    <span className={`kh-risk-badge ${info.tone}`}>
      <Icon size={11} aria-hidden="true" />
      {info.text}
    </span>
  );
}

function DrugHoverContent({ drug }) {
  return (
    <div className="kh-hover-drug">
      <div className="kh-hover-drug-head">
        <strong>{drug.genericName}</strong>
        <span className="kh-otc-pill">{drug.otcClass}</span>
      </div>
      <p className="kh-hover-aliases">常见名称：{drug.aliases.join(" / ")} · 成分：{drug.activeIngredients.join(" + ")}</p>
      <dl className="kh-hover-dl">
        <div><dt>用法用量</dt><dd>{drug.dosage}</dd></div>
        <div><dt>安全上限</dt><dd>{drug.maxDaily}</dd></div>
        <div><dt>起效时长</dt><dd>{drug.onset}</dd></div>
        <div><dt>核心禁忌</dt><dd>{drug.contraindications.join("；")}</dd></div>
      </dl>
      <div className="kh-hover-redflag">
        <AlertTriangle size={13} aria-hidden="true" />
        <span>{drug.redFlags}</span>
      </div>
    </div>
  );
}

export default function KnowledgeMedicineHub({
  scope = "",
  aiName = "小灯",
  initialTab = "knowledge",
  onSendToChat,
  onOrderTakeout,
}) {
  const [tab, setTab] = useState(initialTab);
  const [kbQuery, setKbQuery] = useState("");
  const [kbMode, setKbMode] = useState("hybrid");
  const [includeMedsInKb, setIncludeMedsInKb] = useState(true);
  const [showWorldBookEditor, setShowWorldBookEditor] = useState(false);
  const [worldBookEntries, setWorldBookEntries] = useState([]);
  const [worldBookState, setWorldBookState] = useState("idle");
  const [tokenBudget, setTokenBudget] = useState(2000);

  const [medQuery, setMedQuery] = useState("");
  const [medCategory, setMedCategory] = useState("");
  const [medView, setMedView] = useState("table");
  const [selectedDrugIds, setSelectedDrugIds] = useState([]);
  const [factors, setFactors] = useState({ alcohol: false, driving: false, pregnancy: false });
  const [copyHint, setCopyHint] = useState("");

  useEffect(() => {
    let active = true;
    async function loadWorldBook() {
      setWorldBookState("loading");
      try {
        const res = await listWorldBookEntries({ enabled: true, limit: 100, offset: 0 });
        if (!active) return;
        const rows = Array.isArray(res?.entries) ? res.entries : [];
        setWorldBookEntries(rows);
        setWorldBookState("ready");
      } catch {
        if (active) setWorldBookState("offline");
      }
    }
    void loadWorldBook();
    const onUpdated = () => { void loadWorldBook(); };
    window.addEventListener("dengta:world-book-updated", onUpdated);
    return () => {
      active = false;
      window.removeEventListener("dengta:world-book-updated", onUpdated);
    };
  }, [scope]);

  const kbDocuments = useMemo(() => {
    const docs = [...BUILTIN_KNOWLEDGE_ARTICLES];
    for (const entry of worldBookEntries) {
      docs.push({
        id: `wb:${entry.id}`,
        title: entry.title || "未命名世界书条目",
        category: entry.constant ? "常驻世界书" : "伴侣世界书",
        source: "world_book",
        tags: Array.isArray(entry.keywords) ? entry.keywords : [],
        content: String(entry.content || ""),
      });
    }
    if (includeMedsInKb) {
      for (const drug of COMMON_MEDICATIONS) {
        docs.push({
          id: `med:${drug.id}`,
          title: `${drug.genericName}（${drug.otcClass}）`,
          category: `常备药·${drug.category}`,
          source: "medication",
          tags: [...drug.aliases, ...drug.symptoms, ...drug.activeIngredients],
          content: `${drug.summary} 用法：${drug.dosage}。禁忌：${drug.contraindications.join("；")}。`,
        });
      }
    }
    return docs;
  }, [includeMedsInKb, worldBookEntries]);

  const kbIndex = useMemo(() => createHybridSemanticIndex(kbDocuments), [kbDocuments]);

  const kbSearchOut = useMemo(
    () => kbIndex.search(kbQuery, { limit: 15, mode: kbMode }),
    [kbIndex, kbMode, kbQuery],
  );

  const medSearchOut = useMemo(
    () => searchLocalMedications({ query: medQuery, category: medCategory, mode: "hybrid" }),
    [medCategory, medQuery],
  );

  const interactionReport = useMemo(
    () => checkLocalMedicationInteractions(selectedDrugIds, factors),
    [factors, selectedDrugIds],
  );

  const categoryDistribution = useMemo(() => {
    const counts = new Map();
    for (const doc of kbDocuments) counts.set(doc.category, (counts.get(doc.category) || 0) + 1);
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [kbDocuments]);

  const medCategoryDistribution = useMemo(() => {
    const counts = new Map();
    for (const drug of COMMON_MEDICATIONS) counts.set(drug.category, (counts.get(drug.category) || 0) + 1);
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, []);

  const totalHitTokens = useMemo(
    () => kbSearchOut.results.slice(0, 6).reduce((sum, item) => sum + (item.estimatedTokens || 0), 0),
    [kbSearchOut.results],
  );

  function toggleDrugSelection(drugId) {
    setSelectedDrugIds((prev) => (prev.includes(drugId) ? prev.filter((id) => id !== drugId) : [...prev, drugId].slice(-6)));
    recordBreadcrumb(scope, { kind: "medication", target: `select:${drugId}`, detail: "更新联合用药检测篮" });
  }

  function askAiAboutDrug(drug) {
    const prompt = `我想了解「${drug.genericName}」（常见名：${drug.aliases.join("/")}，成分：${drug.activeIngredients.join("+")}）的日常注意事项。说明书参考用法：${drug.dosage}；主要禁忌：${drug.contraindications.join("；")}。请用温和清晰的方式帮我总结服药提醒，并提醒我哪些情况应该及时就医。`;
    onSendToChat?.(prompt);
  }

  function orderMedicineCare(drug) {
    const query = `需要应急购买 ${drug.aliases[0] || drug.genericName}（或药店同类常备护理与电解质水）`;
    onOrderTakeout?.(query);
  }

  async function copyDrugMemo(drug) {
    const text = `【${drug.genericName}（${drug.otcClass}）】\n成分：${drug.activeIngredients.join(" + ")}\n适应症：${drug.indications.join("；")}\n用法：${drug.dosage}\n上限：${drug.maxDaily}\n禁忌：${drug.contraindications.join("；")}\n红旗提示：${drug.redFlags}\n（注：仅供参考，不替代专业医师诊断）`;
    const ok = await copyDiagnosticText(text);
    setCopyHint(ok ? `已复制「${drug.genericName}」用药速查卡` : "复制失败");
    window.setTimeout(() => setCopyHint(""), 2400);
  }

  return (
    <section className="kh-page" aria-label="语义知识库与常见药品查询中心">
      <header className="kh-hero">
        <div>
          <span className="kh-eyebrow">MiniSearch BM25 · 中文同义语义 · RRF 融合 · OTC 安全护栏</span>
          <h2><Brain size={22} aria-hidden="true" />语义知识库与常备药箱</h2>
          <p>
            一体化本地+云端混合语义检索引擎，支持伴侣世界书召回调试、常见非处方药（OTC）症状反查、悬停药理卡片与 A/B/C/D/X 五级联合用药冲突预警。
          </p>
        </div>
        <div className="kh-tabs" role="tablist" aria-label="知识与药箱功能切换">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "knowledge"}
            className={tab === "knowledge" ? "is-active" : ""}
            data-dt-tip="混合 BM25 + 语义余弦 + RRF 检索世界书与生活知识库"
            onClick={() => setTab("knowledge")}
          >
            <BookOpen size={15} aria-hidden="true" />
            语义知识库
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "medications"}
            className={tab === "medications" ? "is-active" : ""}
            data-dt-tip="查询 28 种家庭常备 OTC 药品、悬停看禁忌并检测联合用药冲突"
            onClick={() => setTab("medications")}
          >
            <Pill size={15} aria-hidden="true" />
            常见药品查询表
            {selectedDrugIds.length > 0 ? <em className="kh-tab-count">{selectedDrugIds.length}</em> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "analytics"}
            className={tab === "analytics" ? "is-active" : ""}
            data-dt-tip="查看知识覆盖分布、Token 预算与检索模式实时可视化对比"
            onClick={() => setTab("analytics")}
          >
            <Database size={15} aria-hidden="true" />
            数据可视化看板
          </button>
        </div>
      </header>

      {copyHint && <div className="kh-toast" role="status">{copyHint}</div>}

      {tab === "knowledge" && (
        <div className="kh-panel">
          <div className="kh-search-card">
            <div className="kh-search-bar">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={kbQuery}
                onChange={(event) => setKbQuery(event.target.value)}
                placeholder="输入任意自然语言测试混合语义召回（如：胃不舒服想吃清淡外卖 / 502报错怎么查）…"
                aria-label="语义知识库搜索"
              />
              {kbQuery ? (
                <button type="button" className="kh-clear-btn" aria-label="清空知识库搜索" onClick={() => setKbQuery("")}>
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="kh-sample-chips" aria-label="快速语义调试示例">
              {SAMPLE_KB_QUERIES.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  data-dt-tip="点击一键运行该语义召回测试用例"
                  onClick={() => setKbQuery(sample)}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  {sample}
                </button>
              ))}
            </div>

            <div className="kh-controls-row">
              <div className="kh-segmented" role="group" aria-label="检索融合算法模式">
                {[
                  { id: "hybrid", label: "混合 RRF 融合" },
                  { id: "bm25", label: "纯 BM25" },
                  { id: "semantic", label: "语义向量余弦" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={kbMode === opt.id ? "is-active" : ""}
                    data-dt-tip={`切换检索算法对比：${opt.label}`}
                    onClick={() => setKbMode(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <label className="kh-toggle-check">
                <input
                  type="checkbox"
                  checked={includeMedsInKb}
                  onChange={(event) => setIncludeMedsInKb(event.target.checked)}
                />
                <span>联合检索常备药知识</span>
              </label>

              <button
                type="button"
                className="kh-secondary-btn"
                data-dt-tip="展开或收起伴侣世界书条目编辑器（增删改排优先级）"
                onClick={() => setShowWorldBookEditor((current) => !current)}
              >
                <BookOpen size={14} aria-hidden="true" />
                {showWorldBookEditor ? "收起世界书管理" : `管理世界书 (${worldBookEntries.length})`}
              </button>
            </div>

            <div className="kh-telemetry-strip">
              <span>已索引 <strong>{kbSearchOut.totalIndexed}</strong> 条（世界书 {worldBookEntries.length} · {worldBookState === "ready" ? "已同步云端" : "离线内置模式"}）</span>
              <span>本次命中 <strong>{kbSearchOut.results.length}</strong> 条</span>
              <span>耗时 <strong>{kbSearchOut.latencyMs} ms</strong></span>
              {kbSearchOut.expandedConcepts.length > 0 && (
                <span className="kh-concepts">
                  语义概念扩展：{kbSearchOut.expandedConcepts.map((c) => <em key={c}>{c}</em>)}
                </span>
              )}
            </div>

            <BudgetMeterBar
              label="Top-6 召回片段上下文 Token 预算模拟"
              used={totalHitTokens}
              total={tokenBudget}
              unit=" tok"
            />
          </div>

          {showWorldBookEditor && (
            <div className="kh-wb-drawer">
              <Suspense fallback={<p className="kh-loading">正在载入世界书管理器…</p>}>
                <WorldBookManager />
              </Suspense>
            </div>
          )}

          <div className="kh-hit-grid">
            {kbSearchOut.results.map((hit, idx) => (
              <article className="kh-hit-card" key={hit.doc.id}>
                <div className="kh-hit-head">
                  <span className="kh-rank-badge">#{idx + 1}</span>
                  <div>
                    <h3>{hit.doc.title}</h3>
                    <div className="kh-hit-meta">
                      <span className={`kh-source-tag is-${hit.doc.source}`}>{hit.doc.category}</span>
                      <span>≈ {hit.estimatedTokens} tok</span>
                    </div>
                  </div>
                </div>

                {kbQuery.trim() ? (
                  <ScoreTripletBars
                    bm25={hit.bm25Score}
                    semantic={hit.semanticScore}
                    rrf={hit.rrfScore}
                  />
                ) : null}

                <p className="kh-hit-snippet">{hit.snippet}</p>

                {(hit.matchedTerms.length > 0 || hit.expandedConcepts.length > 0) && (
                  <div className="kh-hit-tags">
                    {hit.expandedConcepts.map((c) => <span key={`c-${c}`} className="is-concept">语义:{c}</span>)}
                    {hit.matchedTerms.map((t) => <span key={`t-${t}`}>{t}</span>)}
                  </div>
                )}

                <div className="kh-hit-actions">
                  {typeof onSendToChat === "function" && (
                    <button
                      type="button"
                      data-dt-tip="把这条召回的知识卡片发到聊天输入框与伴侣讨论"
                      onClick={() => onSendToChat(`参考知识「${hit.doc.title}」：${hit.snippet}`)}
                    >
                      <MessageCircle size={13} aria-hidden="true" />发给 {aiName}
                    </button>
                  )}
                  <button
                    type="button"
                    data-dt-tip="复制知识摘要到剪贴板"
                    onClick={async () => {
                      await copyDiagnosticText(`【${hit.doc.title}】\n${hit.doc.content}`);
                      setCopyHint(`已复制「${hit.doc.title}」`);
                      window.setTimeout(() => setCopyHint(""), 2000);
                    }}
                  >
                    <Copy size={13} aria-hidden="true" />复制摘要
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "medications" && (
        <div className="kh-panel">
          <div className="kh-disclaimer" role="note">
            <ShieldAlert size={18} aria-hidden="true" />
            <div>
              <strong>医疗安全免责声明（科普参考，不替代医师诊断）</strong>
              <p>{MEDICAL_DISCLAIMER}</p>
            </div>
          </div>

          {/* Pinned Interactive Drug-Drug / Alcohol / Driving / Pregnancy Interaction Checker */}
          <section className={`kh-checker-card ${SEVERITY_META[interactionReport.highestSeverity].tone}`} aria-label="联合用药安全冲突检测">
            <div className="kh-checker-head">
              <div>
                <strong><Flame size={15} aria-hidden="true" />联合用药与酒精/驾驶安全检测（A/B/C/D/X 五级预警）</strong>
                <small>在下方药品表中点击「+ 加入检测」选择 1–6 种常备药，即时排查成分重复（如对乙酰氨基酚叠加）与高危冲突。</small>
              </div>
              <span className={`kh-severity-pill ${SEVERITY_META[interactionReport.highestSeverity].tone}`}>
                {SEVERITY_META[interactionReport.highestSeverity].label}
              </span>
            </div>

            <div className="kh-factor-row" role="group" aria-label="生活情境安全开关">
              <label className={factors.alcohol ? "is-on" : ""}>
                <input type="checkbox" checked={factors.alcohol} onChange={(e) => setFactors((f) => ({ ...f, alcohol: e.target.checked }))} />
                <Wine size={13} aria-hidden="true" />近期饮酒 / 含酒精饮品
              </label>
              <label className={factors.driving ? "is-on" : ""}>
                <input type="checkbox" checked={factors.driving} onChange={(e) => setFactors((f) => ({ ...f, driving: e.target.checked }))} />
                <Car size={13} aria-hidden="true" />需要驾车 / 高空作业
              </label>
              <label className={factors.pregnancy ? "is-on" : ""}>
                <input type="checkbox" checked={factors.pregnancy} onChange={(e) => setFactors((f) => ({ ...f, pregnancy: e.target.checked }))} />
                <Baby size={13} aria-hidden="true" />孕期 / 哺乳期
              </label>
              {selectedDrugIds.length > 0 && (
                <button type="button" className="kh-clear-basket" onClick={() => setSelectedDrugIds([])}>
                  清空已选 ({selectedDrugIds.length})
                </button>
              )}
            </div>

            {interactionReport.selectedDrugs.length > 0 && (
              <div className="kh-selected-pills">
                {interactionReport.selectedDrugs.map((drug) => (
                  <button
                    key={drug.id}
                    type="button"
                    data-dt-tip="点击从冲突检测篮移除"
                    onClick={() => toggleDrugSelection(drug.id)}
                  >
                    {drug.genericName} <X size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}

            {interactionReport.alerts.length > 0 ? (
              <ul className="kh-alert-list">
                {interactionReport.alerts.map((alert) => (
                  <li key={alert.id} className={`is-${alert.severity.toLowerCase()}`}>
                    <div className="kh-alert-title">
                      <em>{alert.severity} 级</em>
                      <strong>{alert.title}</strong>
                    </div>
                    <p>{alert.detail}</p>
                    <small>安全建议：{alert.advice}</small>
                  </li>
                ))}
              </ul>
            ) : selectedDrugIds.length > 0 ? (
              <p className="kh-checker-ok">
                <CheckCircle2 size={15} aria-hidden="true" />
                当前已选 {selectedDrugIds.length} 种药品在内置规则中未检出高危成分叠加或情境冲突；仍请核对纸质说明书及遵医嘱。
              </p>
            ) : null}
          </section>

          <div className="kh-search-card">
            <div className="kh-search-bar">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={medQuery}
                onChange={(event) => setMedQuery(event.target.value)}
                placeholder="按症状、通用名、商品名或成分语义检索（如：拉肚子、痛经、999、布洛芬、对乙酰氨基酚）…"
                aria-label="常见药品语义搜索"
              />
              {medQuery ? (
                <button type="button" className="kh-clear-btn" aria-label="清空药品搜索" onClick={() => setMedQuery("")}>
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="kh-sample-chips" aria-label="常见症状快查">
              {SAMPLE_SYMPTOMS.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  data-dt-tip={`按症状「${sym}」语义反查常见常备药`}
                  onClick={() => setMedQuery(sym)}
                >
                  {sym}
                </button>
              ))}
            </div>

            <div className="kh-controls-row">
              <div className="kh-category-pills" role="group" aria-label="药品分类筛选">
                <button type="button" className={medCategory === "" ? "is-active" : ""} onClick={() => setMedCategory("")}>
                  全部分类 ({COMMON_MEDICATIONS.length})
                </button>
                {MEDICATION_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={medCategory === cat ? "is-active" : ""}
                    onClick={() => setMedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="kh-segmented" role="group" aria-label="视图切换">
                <button
                  type="button"
                  className={medView === "table" ? "is-active" : ""}
                  data-dt-tip="高信息密度表格视图（悬停药名弹出完整药理卡片）"
                  onClick={() => setMedView("table")}
                >
                  <List size={14} aria-hidden="true" />表格
                </button>
                <button
                  type="button"
                  className={medView === "cards" ? "is-active" : ""}
                  data-dt-tip="卡片视图（适合手机端快速浏览）"
                  onClick={() => setMedView("cards")}
                >
                  <LayoutGrid size={14} aria-hidden="true" />卡片
                </button>
              </div>
            </div>

            <div className="kh-telemetry-strip">
              <span>匹配药品 <strong>{medSearchOut.medications.length}</strong> 种</span>
              <span>检索耗时 <strong>{medSearchOut.latencyMs} ms</strong></span>
              <span>提示：鼠标悬停任意药名或「药理详情」即刻弹出完整悬浮说明书卡片</span>
            </div>
          </div>

          {medView === "table" ? (
            <div className="kh-table-wrap">
              <table className="kh-drug-table" aria-label="常见药品查询表">
                <thead>
                  <tr>
                    <th>药品通用名 / 别名（悬停看详情）</th>
                    <th>分类 / 管理</th>
                    <th>核心成分</th>
                    <th>常见适应症与参考用法</th>
                    <th>安全风险标</th>
                    <th>操作联动</th>
                  </tr>
                </thead>
                <tbody>
                  {medSearchOut.medications.map((drug) => {
                    const selected = selectedDrugIds.includes(drug.id);
                    return (
                      <tr key={drug.id} className={selected ? "is-selected" : ""}>
                        <td>
                          <SmartHoverCard
                            placement="right"
                            trigger={
                              <div className="kh-drug-name-trigger" tabIndex={0}>
                                <strong>{drug.genericName}</strong>
                                <small>{drug.aliases.join(" / ")}</small>
                                <span className="kh-hover-cue"><Info size={12} aria-hidden="true" />悬停看药理</span>
                              </div>
                            }
                            content={<DrugHoverContent drug={drug} />}
                          />
                        </td>
                        <td>
                          <span className="kh-cat-badge">{drug.category}</span>
                          <span className={`kh-otc-pill${drug.otcClass.startsWith("Rx") ? " is-rx" : ""}`}>{drug.otcClass}</span>
                        </td>
                        <td>
                          <div className="kh-ing-list">
                            {drug.activeIngredients.map((ing) => <code key={ing}>{ing}</code>)}
                          </div>
                        </td>
                        <td>
                          <p className="kh-cell-summary">{drug.indications[0]}</p>
                          <small className="kh-cell-dosage">{drug.dosage}</small>
                        </td>
                        <td>
                          <div className="kh-risk-stack">
                            <RiskBadge kind="alcohol" value={drug.riskFlags.alcohol} />
                            <RiskBadge kind="driving" value={drug.riskFlags.driving} />
                            <RiskBadge kind="pregnancy" value={drug.riskFlags.pregnancy} />
                          </div>
                        </td>
                        <td>
                          <div className="kh-row-actions">
                            <button
                              type="button"
                              className={selected ? "is-active" : ""}
                              data-dt-tip="加入顶部 A/B/C/D/X 联合用药冲突检测篮"
                              onClick={() => toggleDrugSelection(drug.id)}
                            >
                              <Plus size={12} aria-hidden="true" />{selected ? "已入检测" : "冲突检测"}
                            </button>
                            {typeof onSendToChat === "function" && (
                              <button
                                type="button"
                                data-dt-tip={`把 ${drug.genericName} 发给 ${aiName} 咨询日常护理提醒`}
                                onClick={() => askAiAboutDrug(drug)}
                              >
                                <MessageCircle size={12} aria-hidden="true" />问伴侣
                              </button>
                            )}
                            {typeof onOrderTakeout === "function" && (
                              <button
                                type="button"
                                data-dt-tip="一键转到外卖助手发起急送买药或护理物资需求"
                                onClick={() => orderMedicineCare(drug)}
                              >
                                <ShoppingBag size={12} aria-hidden="true" />去买药
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="kh-drug-cards">
              {medSearchOut.medications.map((drug) => {
                const selected = selectedDrugIds.includes(drug.id);
                return (
                  <article className={`kh-drug-card${selected ? " is-selected" : ""}`} key={drug.id}>
                    <div className="kh-drug-card-head">
                      <div>
                        <h3>{drug.genericName}</h3>
                        <small>{drug.aliases.join(" / ")} · {drug.category}</small>
                      </div>
                      <span className={`kh-otc-pill${drug.otcClass.startsWith("Rx") ? " is-rx" : ""}`}>{drug.otcClass}</span>
                    </div>
                    <p className="kh-hit-snippet">{drug.summary}</p>
                    <div className="kh-ing-list">
                      {drug.activeIngredients.map((ing) => <code key={ing}>{ing}</code>)}
                    </div>
                    <div className="kh-risk-stack is-inline">
                      <RiskBadge kind="alcohol" value={drug.riskFlags.alcohol} />
                      <RiskBadge kind="driving" value={drug.riskFlags.driving} />
                      <RiskBadge kind="pregnancy" value={drug.riskFlags.pregnancy} />
                    </div>
                    <p className="kh-cell-dosage"><strong>参考用法：</strong>{drug.dosage}</p>
                    <div className="kh-hit-actions">
                      <button type="button" className={selected ? "is-active" : ""} onClick={() => toggleDrugSelection(drug.id)}>
                        <Plus size={12} aria-hidden="true" />{selected ? "已入检测" : "冲突检测"}
                      </button>
                      <button type="button" onClick={() => void copyDrugMemo(drug)}>
                        <Copy size={12} aria-hidden="true" />复制卡片
                      </button>
                      {typeof onSendToChat === "function" && (
                        <button type="button" onClick={() => askAiAboutDrug(drug)}>
                          <MessageCircle size={12} aria-hidden="true" />问伴侣
                        </button>
                      )}
                      {typeof onOrderTakeout === "function" && (
                        <button type="button" onClick={() => orderMedicineCare(drug)}>
                          <ShoppingBag size={12} aria-hidden="true" />买药外卖
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "analytics" && (
        <div className="kh-analytics-grid">
          <div className="kh-search-card">
            <h3>语义知识库分类分布（共 {kbDocuments.length} 条）</h3>
            <HorizontalBarChart items={categoryDistribution} unit=" 条" accent="info" maxBars={8} />
          </div>
          <div className="kh-search-card">
            <h3>常见 OTC 药品科室覆盖（共 {COMMON_MEDICATIONS.length} 种）</h3>
            <HorizontalBarChart items={medCategoryDistribution} unit=" 种" accent="success" maxBars={8} />
          </div>
          <div className="kh-search-card kh-span-2">
            <h3>上下文 Token 预算滑块模拟</h3>
            <label className="kh-budget-slider">
              <span>模拟单轮知识注入上限：<strong>{tokenBudget} tokens</strong></span>
              <input
                type="range"
                min="500"
                max="6000"
                step="250"
                value={tokenBudget}
                onChange={(e) => setTokenBudget(Number(e.target.value))}
              />
            </label>
            <BudgetMeterBar
              label="当前语义召回 Top-6 Token 占用"
              used={totalHitTokens}
              total={tokenBudget}
              unit=" tok"
            />
          </div>
        </div>
      )}
    </section>
  );
}
