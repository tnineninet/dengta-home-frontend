import { useState } from "react";
import {
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  Flame,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { formatDbskillMarkdown } from "./dbskill-intent.js";
import "./dbskill-chat-card.css";

const PLATFORM_TABS = [
  { id: "douyin", label: "抖音 9:16" },
  { id: "bilibili", label: "B站 16:9" },
  { id: "xiaohongshu", label: "小红书" },
];

const DIMENSION_LABELS = [
  ["tension", "情绪张力"],
  ["audience", "受众清晰"],
  ["platformFit", "平台契合"],
  ["differentiation", "差异去AI味"],
];

function formatViews(v) {
  const n = Number(v) || 0;
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
}

export default function DbskillChatCard({
  card,
  autoTriggered = true,
  onOpenVideoStudio,
}) {
  const defaultTab =
    card?.platform === "bilibili"
      ? "bilibili"
      : card?.platform === "xiaohongshu"
        ? "xiaohongshu"
        : "douyin";
  const [platformTab, setPlatformTab] = useState(defaultTab);
  const [copied, setCopied] = useState(false);

  if (!card) return null;

  const pkg = card.packaging?.[platformTab] || card.packaging?.douyin;
  const dimensions = card.dimensions || {};

  function handleCopy() {
    const md = formatDbskillMarkdown(card);
    navigator.clipboard?.writeText?.(md).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="dbskill-card" aria-label="dbskill 选题诊断结果">
      <header className="dbskill-card-head">
        <div className="dbskill-head-left">
          <span className="dbskill-plugin-pill">
            <Zap size={12} aria-hidden="true" />
            {autoTriggered ? "dbskill 插件 · 自动触发" : "dbskill 选题诊断"}
          </span>
          <h4>{card.topic}</h4>
        </div>
        <div className={`dbskill-grade-badge grade-${String(card.grade || "A").toLowerCase()}`}>
          <strong>{card.overall_score ?? 80}</strong>
          <small>{card.grade || "A"} 级</small>
        </div>
      </header>

      {card.audience_persona ? (
        <p className="dbskill-persona">
          <b>目标受众：</b>
          {card.audience_persona}
        </p>
      ) : null}

      <div className="dbskill-dims">
        {DIMENSION_LABELS.map(([key, label]) => {
          const val = Math.max(0, Math.min(100, Number(dimensions[key]) || 0));
          return (
            <div key={key} className="dbskill-dim-row">
              <span>{label}</span>
              <div className="dbskill-dim-track" aria-hidden="true">
                <i style={{ width: `${val}%` }} />
              </div>
              <b>{val}</b>
            </div>
          );
        })}
      </div>

      {pkg ? (
        <div className="dbskill-packaging">
          <div className="dbskill-platform-tabs" role="tablist" aria-label="切换平台包装方案">
            {PLATFORM_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={platformTab === tab.id}
                className={platformTab === tab.id ? "is-active" : ""}
                onClick={() => setPlatformTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="dbskill-pkg-body">
            <div className="dbskill-cover-line">
              <span className="dbskill-mini-tag">封面大字</span>
              <strong>{pkg.coverText}</strong>
            </div>
            <div className="dbskill-hook-box">
              <span className="dbskill-mini-tag is-hook">黄金开头 (前3-5秒)</span>
              <p>{pkg.openingHook}</p>
            </div>
            <ul className="dbskill-title-list">
              {(pkg.titles || []).map((t, idx) => (
                <li key={idx}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {Array.isArray(card.diagnostics) && card.diagnostics.length > 0 ? (
        <div className="dbskill-tips">
          <strong>
            <Sparkles size={12} aria-hidden="true" /> dbs-content & 去 AI 味诊断
          </strong>
          <ul>
            {card.diagnostics.map((tip, idx) => (
              <li key={idx}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.script_flow?.beats?.length ? (
        <details className="dbskill-details">
          <summary>展开 4 段口播节奏与滑走排雷（dbs-script-flow）</summary>
          <ol className="dbskill-beats">
            {card.script_flow.beats.map((b, idx) => (
              <li key={idx}>
                <b>
                  {b.range} · {b.stage}
                </b>
                <span>{b.line}</span>
              </li>
            ))}
          </ol>
          {card.script_flow.dropOffRisks?.length ? (
            <div className="dbskill-risks">
              {card.script_flow.dropOffRisks.map((r, i) => (
                <small key={i}>⚠ 流失点：{r}</small>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}

      {Array.isArray(card.benchmarks) && card.benchmarks.length > 0 ? (
        <div className="dbskill-benchmarks">
          <strong>
            <Flame size={12} aria-hidden="true" /> B 站实时对标参考（dbs-benchmark）
          </strong>
          <ul>
            {card.benchmarks.map((b) => (
              <li key={b.bvid || b.title}>
                <a href={b.url} target="_blank" rel="noreferrer">
                  <span>{b.title}</span>
                  <small>
                    {b.author} · ▶ {formatViews(b.views)} <ExternalLink size={10} aria-hidden="true" />
                  </small>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.compliance ? (
        <div className={`dbskill-compliance${card.compliance.passed ? " is-ok" : " is-warn"}`}>
          {card.compliance.passed ? (
            <ShieldCheck size={13} aria-hidden="true" />
          ) : (
            <ShieldAlert size={13} aria-hidden="true" />
          )}
          <span>
            {card.compliance.passed
              ? card.compliance.reminder
              : `${card.compliance.risks.join("；")} ${card.compliance.reminder}`}
          </span>
        </div>
      ) : null}

      <footer className="dbskill-card-actions">
        {onOpenVideoStudio ? (
          <button
            type="button"
            className="dbskill-btn-primary"
            onClick={() => onOpenVideoStudio(card)}
          >
            <Clapperboard size={13} aria-hidden="true" />
            <span>一键送入 AI 视频工坊合成 MP4</span>
          </button>
        ) : null}
        <button type="button" className="dbskill-btn-ghost" onClick={handleCopy}>
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span>{copied ? "已复制 Markdown" : "复制完整策划方案"}</span>
        </button>
      </footer>
    </section>
  );
}
