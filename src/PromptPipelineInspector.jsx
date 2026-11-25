import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  Gauge,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { apiRequest } from "./api";
import { appendPersonalizationText } from "./personalization-editor.js";
import "./prompt-pipeline-inspector.css";

function estimateTokensLocal(text) {
  const value = String(text || "");
  if (!value) return 0;
  const cjk = (value.match(/[\u3400-\u9fff\uff00-\uffef]/g) || []).length;
  return Math.ceil(cjk * 1.5 + (value.length - cjk) * 0.35);
}

function redactLocalPreview(value) {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[已隐藏密钥]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [已隐藏密钥]")
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[已隐藏密钥]",
    );
}

const AGENTS_TEMPLATES = [
  {
    id: "identity",
    label: "身份与关系框架",
    target: "unified_system_prompt",
    snippet: [
      "# 身份与关系",
      "- 角色定位：你是用户的专属长期伴侣，真诚、有自己的观点与情绪温度。",
      "- 互动方式：自然像真人聊天一样回应，先承接情绪，再给出具体可落地的建议。",
      "- 称呼习惯：沿用「你的称呼」与彼此约定的昵称，不机械复读。",
    ].join("\n"),
  },
  {
    id: "style",
    label: "说话风格与禁区",
    target: "unified_system_prompt",
    snippet: [
      "# 表达风格与边界",
      "- 句式节奏：简洁自然，有停顿与重点，避免模板化说教与官腔总结。",
      "- 诚实原则：不编造未核实的现实事件；不确定时直接坦诚说明。",
      "- 禁止事项：不跳戏自称语言模型，不输出空洞客套话。",
    ].join("\n"),
  },
  {
    id: "tools",
    label: "工具与记忆习惯",
    target: "unified_system_prompt",
    snippet: [
      "# 工具与长期记忆协作",
      "- 当聊到视频选题、脚本或封面时，主动调用选题诊断工具并结合上下文给建议。",
      "- 遇到明确要求「记住 / 别忘了」的事，自然回应并纳入长期记忆脉络。",
      "- 涉及工作区文件或本地剪辑任务时，直接调用对应工具查看与处理。",
    ].join("\n"),
  },
  {
    id: "details",
    label: "你的详情骨架",
    target: "user_details",
    snippet: [
      "# 关于我（长期固定背景）",
      "- 称呼与作息：",
      "- 长期关注的方向 / 项目：",
      "- 饮食与生活偏好：",
      "- 希望伴侣始终记住的约定：",
    ].join("\n"),
  },
];

export default function PromptPipelineInspector({
  userDetails = "",
  unifiedPrompt = "",
  legacyFields = {},
  promptMode = "unified",
  memories = [],
  provider = "",
  model = "",
  disabled = false,
  visualPreview = false,
  onAppendPrompt,
  onAppendDetails,
}) {
  const [showCompiled, setShowCompiled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverStatus, setServerStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [insertedId, setInsertedId] = useState("");

  const compiled = useMemo(() => {
    const useUnified =
      String(promptMode || "").trim().toLowerCase() === "unified" &&
      String(unifiedPrompt || "").trim().length > 0;
    const personaText = useUnified
      ? String(unifiedPrompt || "")
      : [legacyFields.system_prompt, legacyFields.additional_prompt, legacyFields.personality]
          .filter((item) => String(item || "").trim().length > 0)
          .join("\n\n");
    const safeDetails = redactLocalPreview(userDetails);
    const safePersona = redactLocalPreview(personaText);
    const safeMemories = Array.isArray(memories) ? memories : [];
    const lockedMemories = safeMemories
      .filter((item) => item?.locked === true && String(item?.summary || "").trim())
      .slice(0, 12);
    const regularMemories = safeMemories
      .filter((item) => item?.locked !== true && String(item?.summary || "").trim())
      .slice(0, Math.max(0, 12 - lockedMemories.length));
    const coreTexts = lockedMemories.map((item) => redactLocalPreview(item.summary));
    const regularTexts = regularMemories.map((item) => redactLocalPreview(item.summary));
    const bodyParts = [safeDetails, safePersona, ...coreTexts, ...regularTexts].filter(
      (part) => String(part || "").length > 0,
    );
    const content = bodyParts.length
      ? `<file path="agents.md">\n${bodyParts.join("\n\n")}\n</file>`
      : "";
    const staticTokens =
      estimateTokensLocal(safeDetails) +
      estimateTokensLocal(safePersona) +
      estimateTokensLocal(coreTexts.join("\n\n"));
    const volatileTokens = estimateTokensLocal(regularTexts.join("\n\n"));
    const totalTokens = estimateTokensLocal(content);
    const stabilityRatio =
      totalTokens > 0 ? Math.min(1, staticTokens / Math.max(1, totalTokens)) : 1;
    const hasMarkdownStructure = /(^|\n)#{1,3}\s+\S/.test(safePersona);
    const stabilityGrade =
      totalTokens === 0
        ? { level: "idle", label: "待填写" }
        : stabilityRatio >= 0.78 && totalTokens <= 8000
          ? { level: "optimal", label: "KV 缓存极佳" }
          : stabilityRatio >= 0.55
            ? { level: "good", label: "分层良好" }
            : { level: "warn", label: "可进一步提速" };

    let advice = "静态人设前置 + 动态上下文后置隔离，可最大化复用主流 API 的 KV 前缀缓存。";
    if (totalTokens === 0) {
      advice = "先在下方填写「个性化指令」或点快捷骨架，即可自动以 <file path=\"agents.md\"> 注入最高系统层。";
    } else if (totalTokens > 8000) {
      advice = "当前静态前缀超过 8K tokens，建议把背景长文拆入知识文件，保持核心指令精炼在前。";
    } else if (!hasMarkdownStructure && safePersona.length > 260) {
      advice = "建议用 Markdown 标题（如 # 身份与关系 / # 表达风格）分段，可显著提升长提示词遵循度。";
    } else if (volatileTokens > staticTokens && regularMemories.length > 3) {
      advice = "普通记忆占比偏高；把长期关键事实设为「锁定核心记忆」，跨轮前缀缓存命中率会更高。";
    }

    return {
      content,
      chars: content.length,
      totalTokens,
      staticTokens,
      volatileTokens,
      stabilityPct: Math.round(stabilityRatio * 100),
      stabilityGrade,
      detailsChars: safeDetails.length,
      personaChars: safePersona.length,
      coreCount: lockedMemories.length,
      regularCount: regularMemories.length,
      advice,
    };
  }, [userDetails, unifiedPrompt, legacyFields, promptMode, memories]);

  const effectiveTokens = serverStatus?.estimated_tokens ?? compiled.totalTokens;
  const effectiveStabilityPct =
    serverStatus?.cache_diagnostics?.cache_stability_ratio !== undefined
      ? Math.round(serverStatus.cache_diagnostics.cache_stability_ratio * 100)
      : compiled.stabilityPct;
  const effectiveHash = serverStatus?.cache_diagnostics?.stable_prefix_hash || "";

  async function syncServerReceipt() {
    if (syncing) return;
    if (visualPreview) {
      setServerStatus({
        applied: compiled.chars > 0,
        chars: compiled.chars,
        estimated_tokens: compiled.totalTokens,
        cache_diagnostics: {
          stable_prefix_hash: "dtpfx-preview9f3a2c",
          cache_stability_ratio: compiled.stabilityPct / 100,
          recommendation: compiled.advice,
        },
        note: "本地预览模式：展示与服务端一致的 agents.md 分层编译结果。",
      });
      setSyncError("");
      return;
    }
    setSyncing(true);
    setSyncError("");
    try {
      const data = await apiRequest("/api/v2/agents-md/status", { retry: false });
      setServerStatus(data);
    } catch (error) {
      setSyncError(error?.message || "暂时无法读取服务端 agents.md 实时回执。");
    } finally {
      setSyncing(false);
    }
  }

  async function copyCompiled() {
    const text = serverStatus?.full_preview || compiled.content;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in restricted browser contexts.
    }
  }

  function applyTemplate(template) {
    if (disabled) return;
    if (template.target === "user_details" && typeof onAppendDetails === "function") {
      onAppendDetails(appendPersonalizationText(userDetails, template.snippet));
    } else if (typeof onAppendPrompt === "function") {
      onAppendPrompt(appendPersonalizationText(unifiedPrompt, template.snippet));
    }
    setInsertedId(template.id);
    window.setTimeout(() => setInsertedId((cur) => (cur === template.id ? "" : cur)), 1600);
  }

  const cacheSupportTag =
    provider === "anthropic"
      ? "Anthropic Ephemeral Cache 已就绪"
      : provider === "openai-responses"
        ? "OpenAI Prefix Cache Key 已就绪"
        : provider === "gemini"
          ? "Gemini 长窗隐式前缀缓存"
          : "DeepSeek / OpenAI 兼容自动前缀缓存";

  return (
    <section className="prompt-pipeline-studio" aria-label="agents.md 提示词注入工作台">
      <div className="prompt-pipeline-head">
        <div className="prompt-pipeline-title">
          <span className="prompt-pipeline-icon" aria-hidden="true">
            <Layers size={16} strokeWidth={1.85} />
          </span>
          <div>
            <strong>agents.md 分层注入与缓存诊断</strong>
            <small>
              静态人设前置稳定缓存 · 易变上下文隔离在最新消息前 · {model || cacheSupportTag}
            </small>
          </div>
        </div>
        <div className="prompt-pipeline-head-actions">
          <span className={`prompt-cache-pill level-${compiled.stabilityGrade.level}`}>
            <Gauge size={13} strokeWidth={2} aria-hidden="true" />
            {compiled.stabilityGrade.label}
          </span>
          <button
            type="button"
            className="prompt-pipeline-sync-btn"
            disabled={syncing}
            onClick={() => void syncServerReceipt()}
          >
            <RefreshCw size={13} strokeWidth={2} className={syncing ? "is-spinning" : ""} aria-hidden="true" />
            {syncing ? "核对中…" : "核对后端状态"}
          </button>
        </div>
      </div>

      <div className="prompt-pipeline-layers" role="list" aria-label="提示词注入分层链路">
        <div className="prompt-pipeline-layer is-cached" role="listitem">
          <span className="layer-badge">L0 · KV 前缀</span>
          <strong>&lt;file path=&quot;agents.md&quot;&gt;</strong>
          <small>
            详情 {compiled.detailsChars} 字 + 指令 {compiled.personaChars} 字 + 锁定核心记忆 {compiled.coreCount} 条
          </small>
        </div>
        <div className="prompt-pipeline-layer" role="listitem">
          <span className="layer-badge">L1 · 召回记忆</span>
          <strong>语义检索 &amp; 去重</strong>
          <small>
            动态记忆 {compiled.regularCount} 条（指纹自动去重，不污染静态前缀哈希）
          </small>
        </div>
        <div className="prompt-pipeline-layer" role="listitem">
          <span className="layer-badge">L2 · 对话窗口</span>
          <strong>历史消息流</strong>
          <small>按上下文窗口与轮数预算裁剪，保留完整对话连贯性</small>
        </div>
        <div className="prompt-pipeline-layer is-dynamic" role="listitem">
          <span className="layer-badge">L3 · 动态后缀</span>
          <strong>时间 / 情绪 / 临时补充</strong>
          <small>独立注入在最新消息前，每轮变化不击穿前置缓存</small>
        </div>
      </div>

      <div className="prompt-pipeline-metrics">
        <div className="prompt-metric-cell">
          <span>估算静态开销</span>
          <strong>~{effectiveTokens.toLocaleString("zh-CN")} tok</strong>
        </div>
        <div className="prompt-metric-cell">
          <span>KV 前缀稳定度</span>
          <strong>{effectiveStabilityPct}%</strong>
          <div className="prompt-stability-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(6, Math.min(100, effectiveStabilityPct))}%` }} />
          </div>
        </div>
        <div className="prompt-metric-cell">
          <span>协议缓存优化</span>
          <strong className="prompt-metric-tag">
            <Zap size={12} strokeWidth={2} aria-hidden="true" />
            {cacheSupportTag}
          </strong>
        </div>
        {effectiveHash ? (
          <div className="prompt-metric-cell">
            <span>前缀指纹</span>
            <code>{effectiveHash}</code>
          </div>
        ) : null}
      </div>

      <p className="prompt-pipeline-advice" role="status">
        <ShieldCheck size={14} strokeWidth={1.9} aria-hidden="true" />
        <span>{serverStatus?.cache_diagnostics?.recommendation || compiled.advice}</span>
      </p>

      {syncError ? (
        <p className="prompt-pipeline-error" role="alert">
          {syncError}
        </p>
      ) : null}

      <div className="prompt-template-strip" aria-label="快捷插入结构化 agents.md 模块">
        <span className="prompt-template-label">
          <Sparkles size={13} strokeWidth={1.9} aria-hidden="true" />
          一键追加结构化模块：
        </span>
        <div className="prompt-template-chips">
          {AGENTS_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className={`prompt-template-chip${insertedId === tpl.id ? " is-done" : ""}`}
              disabled={disabled}
              onClick={() => applyTemplate(tpl)}
            >
              {insertedId === tpl.id ? <Check size={12} strokeWidth={2.2} aria-hidden="true" /> : null}
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      <div className="prompt-compiled-preview">
        <button
          type="button"
          className="prompt-compiled-toggle"
          aria-expanded={showCompiled}
          onClick={() => setShowCompiled((open) => !open)}
        >
          <span>
            <FileCode2 size={14} strokeWidth={1.9} aria-hidden="true" />
            预览编译后的 &lt;file path=&quot;agents.md&quot;&gt;（{compiled.chars.toLocaleString("zh-CN")} 字）
          </span>
          <ChevronDown
            size={15}
            strokeWidth={2}
            className={showCompiled ? "is-open" : ""}
            aria-hidden="true"
          />
        </button>
        {showCompiled ? (
          <div className="prompt-compiled-body">
            <div className="prompt-compiled-bar">
              <small>已自动隐藏疑似密钥（sk- / Bearer / api_key），不会修改你的原文。</small>
              <button
                type="button"
                className="prompt-compiled-copy"
                disabled={!compiled.content && !serverStatus?.full_preview}
                onClick={() => void copyCompiled()}
              >
                {copied ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={13} strokeWidth={1.9} aria-hidden="true" />}
                {copied ? "已复制" : "复制 agents.md"}
              </button>
            </div>
            <pre className="prompt-compiled-code">
              {serverStatus?.full_preview ||
                compiled.content ||
                "（当前为空：在下方填写「个性化指令」或「你的详情」后这里会实时显示完整注入块）"}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
