import { apiRequest } from "./api.js";

function cleanText(value, maxLen = 200) {
  return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
    .slice(0, maxLen)
    .join("");
}

function isLoopbackHost() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

function detectPlatform(text) {
  const raw = String(text || "");
  const hasDouyin = /抖音|douyin|短视频|竖屏|9:16/i.test(raw);
  const hasBili = /b站|哔哩哔哩|bilibili|up主|弹幕|横屏|16:9/i.test(raw);
  const hasXhs = /小红书|xhs|图文笔记/i.test(raw);
  if (hasDouyin && !hasBili && !hasXhs) return "douyin";
  if (hasBili && !hasDouyin && !hasXhs) return "bilibili";
  if (hasXhs && !hasDouyin && !hasBili) return "xiaohongshu";
  return "both";
}

function detectMode(text) {
  const raw = String(text || "");
  if (/\/dbs-title|标题|封面|开头|前3秒|前三秒|钩子|hook/i.test(raw)) return "title_cover_intro";
  if (/\/dbs-script|口播|逐字稿|脚本|节奏|流失|去ai味|ai味/i.test(raw)) return "script_flow";
  if (/\/dbs-benchmark|对标|爆款拆解|同行|竞品/i.test(raw)) return "benchmark";
  if (/\/dbs-content-value|值不值得拍|选题评估|打分|受众/i.test(raw)) return "topic_value";
  return "full";
}

export function extractCreatorTopic(message = "") {
  const raw = cleanText(message, 200);
  if (!raw) return "";
  const quoted = raw.match(/[「《“"]([^」》”"]{2,60})[」》”"]/);
  if (quoted && quoted[1]) return cleanText(quoted[1], 100);
  const topic = raw
    .replace(/^\/dbs(?:-[a-z-]+)?\s*/i, "")
    .replace(/[，,。；;]\s*(?:帮我|顺便|麻烦|能不能|可以|给几个|给我|看看|分析|评估|出个|写个|起个|讲讲|聊聊).*$/g, "")
    .replace(/^(?:请问|帮我|我想|想|打算|准备|想让你|能不能|可以|咱们来|一起)+\s*/g, "")
    .replace(/^(?:拍|做|录|剪|写|策划|聊)(?:一?期|一?个|个|条|篇)?(?:关于|有关)?\s*/g, "")
    .replace(/^(?:关于|有关)\s*/g, "")
    .replace(/(?:的)?(?:B站|哔哩哔哩|bilibili|抖音|小红书|视频号)?(?:短视频|中视频|视频|选题|脚本|口播稿|内容)?$/i, "")
    .replace(/(?:分析一下|帮我分析|给点建议|出个方案|做个选题|写个脚本|起个标题|怎么样|可行吗|好拍吗|能火吗)[？?！!。.]*$/g, "")
    .trim();
  return cleanText(topic.length >= 2 ? topic : raw, 100);
}

export function detectCreatorTopicIntent(message = "") {
  const text = cleanText(message, 400);
  if (!text) {
    return { matched: false, confidence: 0, mode: "full", platform: "both", topic: "", explicitCommand: false };
  }
  if (/\/dbs(?:-[a-z-]+)?\b|\bdbskill\b/i.test(text)) {
    return {
      matched: true,
      confidence: 0.99,
      mode: detectMode(text),
      platform: detectPlatform(text),
      topic: extractCreatorTopic(text),
      explicitCommand: true,
    };
  }
  if (/^(?:放一首|播放|来一首|听歌|点外卖|帮我点)/.test(text) && !/视频|选题|脚本|封面|标题/.test(text)) {
    return { matched: false, confidence: 0, mode: "full", platform: "both", topic: "", explicitCommand: false };
  }

  const strongCreatorTerms =
    /(选题|拍视频|做视频|剪视频|短视频|中视频|视频脚本|口播稿|逐字稿|分镜|黄金(?:前)?[3三5五]秒|封面文案|爆款标题|爆款拆解|起号|自媒体|视频灵感|拍什么|怎么拍|做一期|录一期|UP主|博主运营)/i;
  const creationVerb =
    /(分析|策划|构思|评估|拆解|优化|打磨|写|起|做|拍|剪|聊|想想|给点|建议|方向|灵感|诊断|看看|能不能火|值不值得)/i;
  const platformTerm = /(抖音|b站|哔哩哔哩|bilibili|小红书|视频号)/i;
  const packagingTerm = /(标题|封面|开头|钩子|脚本|文案|完播率|播放量|流量|对标)/i;

  let score = 0;
  if (strongCreatorTerms.test(text)) score += 0.72;
  if (platformTerm.test(text) && (creationVerb.test(text) || packagingTerm.test(text))) score += 0.55;
  if (packagingTerm.test(text) && creationVerb.test(text) && /视频|内容|选题|账号|博主|作品|一期/.test(text)) score += 0.45;
  if (/想法|创意|灵感/.test(text) && /视频|拍|做一期|内容|选题/.test(text)) score += 0.35;

  const matched = score >= 0.65;
  return {
    matched,
    confidence: Math.min(0.98, Number(score.toFixed(2))),
    mode: detectMode(text),
    platform: detectPlatform(text),
    topic: matched ? extractCreatorTopic(text) : "",
    explicitCommand: false,
  };
}

export function buildLocalDbskillCard({ topic = "", message = "", platform = "both", mode = "full", draftScript = "" } = {}) {
  const cleanTopic = cleanText(topic || extractCreatorTopic(message), 120) || "短视频选题策划";
  const shortTopic = Array.from(cleanTopic).slice(0, 22).join("");
  const resolvedPlatform = ["douyin", "bilibili", "xiaohongshu", "both"].includes(platform) ? platform : "both";
  const tension = /\d+|对比|实测|避坑|从0到1|真相|为什么|翻车/.test(cleanTopic) ? 86 : 74;
  const audience = /普通人|新手|小白|UP主|博主|程序员|打工人|入门/.test(cleanTopic) ? 84 : 72;
  const platformFit = 82;
  const differentiation = /总而言之|底层逻辑|赋能|大家好/.test(draftScript) ? 62 : 80;
  const overall = Math.round(tension * 0.3 + audience * 0.25 + platformFit * 0.25 + differentiation * 0.2);
  const grade = overall >= 86 ? "S" : overall >= 76 ? "A" : overall >= 66 ? "B" : "C";

  return {
    id: `dbs_local_${Date.now().toString(36)}`,
    plugin_id: "dbskill-topic-studio",
    plugin_name: "dbskill 选题与视频诊断插件",
    topic: cleanTopic,
    platform: resolvedPlatform,
    mode,
    overall_score: overall,
    grade,
    dimensions: { tension, audience, platformFit, differentiation },
    audience_persona: "对「真实前后对比 + 可立刻复用的实操方法」最敏感的短视频/中视频观众",
    diagnostics: [
      "前 3 秒建议直接展示最终成品或最反常识的对比结论，去掉「大家好」寒暄开场。",
      "去 AI 味建议：多用第一人称亲测口吻（如「我试完最踩坑的是…」），避免总结体。",
    ],
    packaging: {
      douyin: {
        platformLabel: "抖音 · 9:16 强钩子",
        titles: [
          `别再踩坑了！关于「${shortTopic}」，90%的人第一步就做错了`,
          `30秒看懂「${shortTopic}」：我实测后发现最反常识的细节`,
          `普通人做「${shortTopic}」怎么立刻出效果？记住这3步`,
        ],
        coverText: `${shortTopic.slice(0, 10)}｜别再盲目试`,
        openingHook: `先别划走！如果你最近也在琢磨「${shortTopic}」，前3秒先看这个对比结果。`,
      },
      bilibili: {
        platformLabel: "B站 · 16:9 深度干货",
        titles: [
          `【保姆级拆解】从0到1跑通「${shortTopic}」：实测避坑与完整思路`,
          `为什么别人做「${shortTopic}」能出圈？拆解核心方法论`,
          `我把「${shortTopic}」完整实操了一遍，这份工作流直接送你`,
        ],
        coverText: `从0到1｜${shortTopic.slice(0, 12)}实测`,
        openingHook: `这期不讲虚的，直接带你拆开看「${shortTopic}」背后真正起作用的三个关键步骤。`,
      },
      xiaohongshu: {
        platformLabel: "小红书 · 轻痛点清单",
        titles: [
          `救命！早知道「${shortTopic}」这么简单，少走一半弯路✨`,
          `新手必藏｜「${shortTopic}」3步上手模板，看完直接能用`,
          `实测一周「${shortTopic}」，说3句大实话（附避坑清单）`,
        ],
        coverText: `${shortTopic.slice(0, 10)} 3步抄作业`,
        openingHook: `整理了这份超好懂的「${shortTopic}」实操卡片，建议先收藏再照着第一步试一遍～`,
      },
    },
    script_flow: {
      beats: [
        { range: "00:00 - 00:04", stage: "黄金钩子 (Hook)", goal: "抛反差结果", line: `关于「${shortTopic}」，先看一个我实测出来的反差结论。` },
        { range: "00:04 - 00:15", stage: "痛点共鸣", goal: "点破误区", line: "很多人一开始就堆复杂流程，前5秒观众根本看不出亮点。" },
        { range: "00:15 - 00:36", stage: "三步实操", goal: "可复用方法", line: "拆成三步：定痛点、给前后对比画面、口播换成大白话。" },
        { range: "00:36 - 00:45", stage: "互动收口", goal: "评论区钩子", line: "你卡在哪一步？打在评论区，下期直接挑高赞实操给你看。" },
      ],
      dropOffRisks: ["第 3–5 秒必须出现具体结果或强疑问，避免礼貌寒暄导致观众划走。"],
    },
    benchmarks: [],
    benchmark_source: "local",
    compliance: {
      passed: true,
      risks: [],
      reminder: "若使用 AI 配音/画面合成，请保留「AI辅助创作」合规标识。",
    },
    created_at: new Date().toISOString(),
  };
}

export async function requestDbskillAnalysis({
  topic = "",
  message = "",
  platform = "both",
  mode = "full",
  draftScript = "",
  visualPreview = false,
} = {}) {
  const payload = { topic, message, platform, mode, draftScript, includeLiveBenchmark: true };
  try {
    if (visualPreview) {
      if (isLoopbackHost()) {
        const res = await fetch("/api/v2/creator-bridge/dbskill/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.card) return { source: "local_gateway", card: data.card, analysis: data.analysis };
        }
      }
      return { source: "local_fallback", card: buildLocalDbskillCard(payload) };
    }
    const data = await apiRequest("/api/v2/creator-bridge/dbskill/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (data?.card) return { source: "backend", card: data.card, analysis: data.analysis };
  } catch {
    // Graceful local fallback so chat and studio always stay responsive
  }
  return { source: "local_fallback", card: buildLocalDbskillCard(payload) };
}

export function buildCompanionDbskillReply(card, aiName = "小灯") {
  if (!card) return "我帮你整理好了这份选题思路，一起看看吧！";
  const prefKey = card.platform === "bilibili" ? "bilibili" : card.platform === "xiaohongshu" ? "xiaohongshu" : "douyin";
  const pkg = card.packaging?.[prefKey] || card.packaging?.douyin;
  const topTitle = pkg?.titles?.[0] || card.topic;
  const topTip = card.diagnostics?.[0] || "前 3 秒先亮对比结果，完播率会稳很多。";
  const benchNote =
    Array.isArray(card.benchmarks) && card.benchmarks.length > 0
      ? `我还顺手从 B 站拉了 ${card.benchmarks.length} 条真实对标作品放在卡片里给你参考。`
      : "";
  return `一听你想聊「${card.topic}」，我立刻帮你主动调用了内置的 **dbskill 选题诊断插件**！\n\n综合评下来是 **${card.overall_score} 分（${card.grade} 级）**——这个方向很值得拍。我最推荐先拿这版切入：「${topTitle}」，关键优化点是：${topTip}${benchNote}\n\n完整的抖音/B站/小红书三端标题、黄金前3秒开头和4段口播节奏都收在下面卡片里了；想直接出样片的话，点卡片里的「一键送入 AI 视频工坊」就能马上合成 MP4～（${aiName}）`;
}

export function formatDbskillMarkdown(card) {
  if (!card) return "";
  const lines = [
    `# dbskill 选题诊断报告：${card.topic}`,
    `- 综合评分：**${card.overall_score} 分（${card.grade} 级）**`,
    `- 受众画像：${card.audience_persona || ""}`,
    "",
    "## 诊断与去 AI 味建议",
    ...(card.diagnostics || []).map((d) => `- ${d}`),
    "",
    "## 跨平台标题、封面与黄金开头",
  ];
  for (const key of ["douyin", "bilibili", "xiaohongshu"]) {
    const pkg = card.packaging?.[key];
    if (!pkg) continue;
    lines.push(`### ${pkg.platformLabel}`);
    lines.push(`- 封面大字：${pkg.coverText}`);
    lines.push(`- 黄金开头：${pkg.openingHook}`);
    for (const t of pkg.titles || []) lines.push(`- 备选标题：${t}`);
  }
  if (card.script_flow?.beats?.length) {
    lines.push("", "## 口播四段节奏 (dbs-script-flow)");
    for (const b of card.script_flow.beats) {
      lines.push(`- [${b.range}] **${b.stage}**（${b.goal}）：${b.line}`);
    }
  }
  return lines.join("\n");
}
