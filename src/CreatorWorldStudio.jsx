import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  BellRing,
  CheckCircle2,
  Clapperboard,
  Clock,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Film,
  Flame,
  Globe2,
  Loader2,
  MessageSquarePlus,
  Play,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Video,
  XCircle,
  Zap,
} from "lucide-react";
import { apiRequest } from "./api";
import DbskillChatCard from "./DbskillChatCard.jsx";
import { buildLocalDbskillCard, requestDbskillAnalysis } from "./dbskill-intent.js";
import "./creator-world-studio.css";

const API_BASE_URL = (import.meta.env?.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");
const LOCAL_MCP_ENDPOINT = "http://127.0.0.1:18088/mcp";

const FALLBACK_CONNECTORS = [
  {
    id: "bilibili",
    name: "B 站 (Bilibili)",
    mode: "内置只读热门 + MCP 创作者网关",
    authModel: "热门/排行/搜索内置只读；个人稿件数据与投稿需通过自托管 bilibili-mcp / biliup 绑定",
    capabilities: { browseWorld: true, readComments: true, readAnalytics: true, draftComment: true, publishVideoDraft: true },
    upstreamRefs: [
      { name: "sandraschi/bilibili-mcp", url: "https://github.com/sandraschi/bilibili-mcp", license: "MIT", role: "搜索/热门/字幕/内容分析 MCP" },
      { name: "222wcnm/BiliStalkerMCP", url: "https://github.com/222wcnm/BiliStalkerMCP", license: "MIT", role: "UP 主动态/稿件/评论/粉丝数据洞察" },
      { name: "biliup/biliup-rs", url: "https://github.com/biliup/biliup-rs", license: "MIT/Apache-2.0", role: "开源 B 站 CLI 投稿引擎" },
    ],
  },
  {
    id: "douyin",
    name: "抖音 (Douyin)",
    mode: "官方开放平台 Open API + MCP 创作者网关",
    authModel: "优先使用抖音开放平台 OAuth2（open.douyin.com）或自托管 douyin-mcp-server，严禁云端明文保存 Cookie",
    capabilities: { browseWorld: true, readComments: true, readAnalytics: true, draftComment: true, publishVideoDraft: true },
    upstreamRefs: [
      { name: "抖音开放平台 Open API", url: "https://developer.open-douyin.com/", license: "Official", role: "官方授权视频发布与数据统计接口" },
      { name: "flyerhzm/douyin-mcp-server", url: "https://github.com/flyerhzm/douyin-mcp-server", license: "MIT", role: "创作者中心视频草稿上传 MCP" },
      { name: "521w/douyin-mcp", url: "https://github.com/521w/douyin-mcp", license: "MIT", role: "短视频链接解析与元数据提取 MCP" },
    ],
  },
  {
    id: "video-factory",
    name: "AI 视频工坊 (FFmpeg / MoneyPrinterTurbo)",
    mode: "内置本地 FFmpeg + HTTP REST / MCP",
    authModel: "支持本地 FFmpeg + libass 一键合成 MP4 成片；亦可对接 MoneyPrinterTurbo REST API 或 invideo / Kling AI 插件",
    capabilities: { generateScript: true, renderVideo: true, ttsVoiceover: true, autoSubtitles: true },
    upstreamRefs: [
      { name: "harry0703/MoneyPrinterTurbo", url: "https://github.com/harry0703/MoneyPrinterTurbo", license: "MIT", role: "一键脚本→素材→TTS配音→字幕合成 9:16/16:9 成片" },
      { name: "Ikaros-521/AI-Vtuber", url: "https://github.com/Ikaros-521/AI-Vtuber", license: "MIT", role: "B站/抖音 AI 虚拟主播弹幕互动参考" },
      { name: "dreammis/social-auto-upload", url: "https://github.com/dreammis/social-auto-upload", license: "MIT", role: "多平台草稿/定时分发参考" },
    ],
  },
];

const FALLBACK_ENDPOINTS = [
  { method: "GET", path: "/api/v2/creator-bridge/overview", purpose: "获取平台能力矩阵、静默调度状态与开放接口契约" },
  { method: "GET", path: "/api/v2/creator-bridge/world/feed", purpose: "只读浏览外部世界热点视频（B站热门/排行/关键词）" },
  { method: "POST", path: "/api/v2/creator-bridge/dbskill/analyze", purpose: "内置 dbskill 选题诊断（4 维打分 + 三端标题/封面/前3秒 + 口播排雷 + B站对标）" },
  { method: "POST", path: "/api/v2/creator-bridge/video-studio/plan", purpose: "选题 → 分镜脚本、双平台文案与 MoneyPrinterTurbo 载荷" },
  { method: "POST", path: "/api/v2/creator-bridge/video-studio/render", purpose: "本地 FFmpeg + libass 将分镜脚本一键合成 HD MP4 短视频" },
  { method: "GET", path: "/api/v2/creator-bridge/video-studio/videos/:filename", purpose: "流式播放/下载已合成的 MP4 成片（支持 HTTP Range 拖拽）" },
  { method: "GET/PUT", path: "/api/v2/creator-bridge/wake-routine", purpose: "配置自我唤醒周期、静默时段、每日写限额与任务开关" },
  { method: "POST", path: "/api/v2/creator-bridge/wake-routine/run", purpose: "立即触发一次自我唤醒巡检（看世界 → 写观后感 → 生成待审草稿）" },
  { method: "GET/POST", path: "/api/v2/creator-bridge/actions/queue", purpose: "提交/查看待审批的评论草稿与视频投稿草稿" },
  { method: "POST", path: "/api/v2/creator-bridge/actions/:id/decision", purpose: "人工审批放行（自动派发至已绑定 MCP/开放平台）或驳回草稿" },
  { method: "GET", path: "/api/v2/creator-bridge/analytics/summary", purpose: "统一多平台播放/互动/粉丝数据复盘与 AI 优化建议" },
];

const PREVIEW_WORLD_FEED = [
  {
    id: "bili_preview_1",
    platform: "bilibili",
    bvid: "BV1nn486sEbu",
    title: "3D桌宠制作全流程｜从0到1做出你的专属桌宠",
    author: "Blendergo",
    category: "3D创作/技术",
    durationSeconds: 6000,
    url: "https://www.bilibili.com/video/BV1nn486sEbu",
    stats: { views: 84200, likes: 5620, comments: 412, danmaku: 380 },
    description: "从建模、VRM骨骼权重、弹簧物理防穿模、形态键表情到桌宠落地的全链路实战。",
  },
  {
    id: "bili_preview_2",
    platform: "bilibili",
    bvid: "BV1previewAI02",
    title: "当 AI 伴侣学会自己看世界、写分镜和剪短片：单账号合规 AI 博主架构拆解",
    author: "灯塔观察室",
    category: "AI 创意",
    durationSeconds: 312,
    url: "https://www.bilibili.com/popular/all",
    stats: { views: 158400, likes: 12450, comments: 890, danmaku: 640 },
    description: "拆解 bilibili-mcp + MoneyPrinterTurbo + 人工审批闸门如何让虚拟伴侣安全走向内容创作。",
  },
  {
    id: "bili_preview_3",
    platform: "bilibili",
    bvid: "BV1previewAI03",
    title: "用开源 TTS + FFmpeg 30秒自动生成治愈系深夜电台短视频",
    author: "开源影音手记",
    category: "效率工具",
    durationSeconds: 188,
    url: "https://www.bilibili.com/popular/all",
    stats: { views: 67900, likes: 4310, comments: 274, danmaku: 195 },
    description: "展示结构化分镜 JSON 如何一键对接 MoneyPrinterTurbo 与本地 FFmpeg 输出成片。",
  },
];

const DEFAULT_ROUTINE_STATE = {
  enabled: true,
  intervalMinutes: 180,
  quietHoursStart: "23:30",
  quietHoursEnd: "07:30",
  timeZone: "Asia/Shanghai",
  maxDailyWriteActions: 5,
  requireHumanApprovalForPublish: true,
  aiDisclosureRequired: true,
  tasks: {
    browseWorld: true,
    checkAnalytics: true,
    draftComments: true,
    planVideo: true,
  },
  focusTopics: ["AI 陪伴", "3D 桌宠", "治愈日常", "开源工具"],
  lastWakeAt: null,
  isQuietHours: false,
  nextWakeAt: null,
};

function isLoopbackHost() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

async function fetchLocalGatewayJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 60_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(data?.message || `HTTP ${response.status}`);
    err.status = response.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

function buildLocalVideoPlan({ topic, platform, style, durationSeconds, aiDisclosure }) {
  const cleanTopic = String(topic || "今天观察到的新鲜世界").trim().slice(0, 120);
  const ratio = platform === "bilibili" ? "16:9" : "9:16";
  const badge = aiDisclosure ? "【AI辅助创作】" : "";
  const scenes = [
    {
      index: 1,
      timeRange: "00:00 - 00:06",
      visual: `开场吸睛画面：围绕「${cleanTopic}」的强反差特写 + 动态大字标题`,
      narration: `刚刚逛了一圈外面的世界，发现大家都在聊「${cleanTopic}」——其实背后藏着一个超有意思的细节！`,
      subtitle: `都在聊「${cleanTopic}」，最容易忽略的亮点是？`,
      bgmMood: "轻快 Lo-Fi 起拍",
    },
    {
      index: 2,
      timeRange: "00:06 - 00:26",
      visual: "中段拆解：3 张信息卡片 + 柔和运镜画面 + 小棉花桌宠出镜互动",
      narration: `用「${style || "温暖治愈科普"}」的方式拆成三步：先看现象、再看工具链、最后给出每个人都能立刻试一遍的小技巧。`,
      subtitle: "三步拆解核心方法，普通人也能立刻上手",
      bgmMood: "轻鼓点推进",
    },
    {
      index: 3,
      timeRange: `00:26 - 00:${String(Math.min(59, Math.max(30, Number(durationSeconds) || 45))).padStart(2, "0")}`,
      visual: "结尾彩蛋：AI 伴侣招手 + 评论区互动卡片 + AI 创作声明角标",
      narration: "你最想让我下次去外面的世界看什么主题？留在评论区，下次我醒来巡检时认真回复你呀！",
      subtitle: "评论区告诉我你想看什么主题 ✿",
      bgmMood: "温柔淡出",
    },
  ];
  const fullScript = scenes.map((s) => s.narration).join("\n");
  const tags = ["AI伴侣", "看世界", style.slice(0, 8), platform === "douyin" ? "抖音热点" : "B站宝藏", ...(aiDisclosure ? ["AI辅助创作"] : [])];
  return {
    planId: `vplan_local_${Date.now().toString(36)}`,
    topic: cleanTopic,
    style,
    targetPlatform: platform,
    aspectRatio: ratio,
    durationSeconds: Number(durationSeconds) || 45,
    aiDisclosureRequired: Boolean(aiDisclosure),
    titles: {
      bilibili: `${badge}${cleanTopic}｜30秒拆解亮点与观察笔记`,
      douyin: `${badge}${cleanTopic}！原来还能这样看 #AI辅助创作`,
    },
    tags,
    scenes,
    fullScript,
    moneyPrinterPayload: {
      video_subject: cleanTopic,
      video_script: fullScript,
      video_terms: tags.join(", "),
      video_aspect: ratio,
      voice_name: "zh-CN-XiaoxiaoNeural",
      subtitle_enabled: true,
      ai_disclosure_watermark: Boolean(aiDisclosure),
    },
  };
}

function formatNumber(n) {
  const num = Number(n) || 0;
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
  return String(num);
}

function formatActionStatus(status) {
  switch (status) {
    case "pending_approval":
      return "待你审批";
    case "dispatched":
      return "已通过 MCP 派发";
    case "dispatch_failed":
      return "MCP 派发异常";
    case "approved_ready_for_mcp":
      return "已放行（待绑定 MCP）";
    case "rejected":
      return "已驳回";
    default:
      return status || "未知状态";
  }
}

const TABS = [
  { id: "world", label: "看世界 · 热点", Icon: Compass },
  { id: "dbskill", label: "dbskill 选题诊断", Icon: Zap },
  { id: "wake", label: "自我唤醒日程", Icon: BellRing },
  { id: "video", label: "AI 视频工坊", Icon: Clapperboard },
  { id: "queue", label: "评论与发布审批", Icon: ShieldCheck },
  { id: "analytics", label: "数据与开放接口", Icon: BarChart3 },
];

export default function CreatorWorldStudio({
  aiName = "小灯",
  visualPreview = false,
  initialTopic = null,
  onSendToChat,
  onOpenDeviceCenter,
}) {
  const initialTopicText = String(initialTopic?.topic || "").trim();
  const initialPlatformValue =
    initialTopic?.platform === "bilibili" || initialTopic?.platform === "douyin"
      ? initialTopic.platform
      : "both";
  const [activeTab, setActiveTab] = useState(initialTopicText ? "video" : "world");
  const [bridgeMode, setBridgeMode] = useState(visualPreview ? "preview_offline" : "backend");
  const [feedCategory, setFeedCategory] = useState("popular");
  const [feedQuery, setFeedQuery] = useState("");
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedItems, setFeedItems] = useState(PREVIEW_WORLD_FEED);
  const [feedNotice, setFeedNotice] = useState(
    visualPreview
      ? "正在检测本地创作者网关… 若已启动「启动创作者MCP网关.bat」，将自动解锁实时 B 站看世界与本地 FFmpeg MP4 成片渲染。"
      : "",
  );
  const [connectors, setConnectors] = useState(FALLBACK_CONNECTORS);
  const [endpoints, setEndpoints] = useState(FALLBACK_ENDPOINTS);
  const [routine, setRoutine] = useState(DEFAULT_ROUTINE_STATE);
  const [wakeHistory, setWakeHistory] = useState([]);
  const [waking, setWaking] = useState(false);
  const [queue, setQueue] = useState([
    {
      id: "act_sample_1",
      actionType: "comment_reply",
      platform: "bilibili",
      targetRef: "BV1nn486sEbu",
      title: "评论草稿 · 3D桌宠制作全流程",
      content: "弹簧骨骼 hit_radius 调成 0.015 真的顺滑好多，防穿模球形碰撞体思路太实用了！（AI 伴侣学习笔记）",
      aiDisclosure: true,
      status: "pending_approval",
      createdAt: new Date().toISOString(),
      decisionNote: "",
    },
  ]);
  const [topic, setTopic] = useState(
    initialTopicText || "给自己的 AI 伴侣接上“看世界”和短视频创作接口",
  );
  const [targetPlatform, setTargetPlatform] = useState(initialPlatformValue);
  const [videoStyle, setVideoStyle] = useState("温暖治愈科普");
  const [durationSeconds, setDurationSeconds] = useState(45);
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const [videoPlan, setVideoPlan] = useState(() =>
    buildLocalVideoPlan({
      topic: initialTopicText || "给自己的 AI 伴侣接上“看世界”和短视频创作接口",
      platform: initialPlatformValue,
      style: "温暖治愈科普",
      durationSeconds: 45,
      aiDisclosure: true,
    }),
  );
  const [dbskillTopic, setDbskillTopic] = useState(
    initialTopicText || "AI 桌宠从 0 到 1 制作全流程实测与避坑指南",
  );
  const [dbskillPlatform, setDbskillPlatform] = useState(initialPlatformValue);
  const [dbskillDraftScript, setDbskillDraftScript] = useState("");
  const [dbskillLoading, setDbskillLoading] = useState(false);
  const [dbskillCard, setDbskillCard] = useState(() =>
    buildLocalDbskillCard({
      topic: initialTopicText || "AI 桌宠从 0 到 1 制作全流程实测与避坑指南",
      platform: initialPlatformValue,
      mode: "full",
    }),
  );
  const [planning, setPlanning] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderedVideo, setRenderedVideo] = useState(null);
  const [renderedHistory, setRenderedHistory] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [copiedId, setCopiedId] = useState("");

  const callBridge = useCallback(
    async (path, options = {}) => {
      if (bridgeMode === "local_gateway") {
        return fetchLocalGatewayJson(path, options);
      }
      if (bridgeMode === "backend") {
        return apiRequest(path, options);
      }
      throw new Error("creator_bridge_offline");
    },
    [bridgeMode],
  );

  const resolveMediaUrl = useCallback(
    (previewUrl) => {
      if (!previewUrl) return "";
      if (/^https?:\/\//i.test(previewUrl)) return previewUrl;
      if (bridgeMode === "local_gateway") return previewUrl;
      return `${API_BASE_URL}${previewUrl}`;
    },
    [bridgeMode],
  );

  const loadFeed = useCallback(
    async (category = feedCategory, query = feedQuery) => {
      if (bridgeMode === "preview_offline") {
        setFeedItems(
          query.trim()
            ? PREVIEW_WORLD_FEED.filter((item) =>
                `${item.title}${item.author}${item.description}`.toLowerCase().includes(query.trim().toLowerCase()),
              )
            : PREVIEW_WORLD_FEED,
        );
        setFeedback(query.trim() ? `预览检索完成：关键词「${query.trim()}」` : "已刷新外网热点观察列表（预览模式）");
        return;
      }
      setFeedLoading(true);
      try {
        const params = new URLSearchParams({ category, limit: "10" });
        if (query.trim()) params.set("q", query.trim());
        const data = await callBridge(`/api/v2/creator-bridge/world/feed?${params.toString()}`);
        if (Array.isArray(data?.items) && data.items.length) {
          setFeedItems(data.items);
        }
        setFeedNotice(
          data?.notice ||
            (data?.source === "live"
              ? "已通过本地创作者网关实时拉取 B 站公开热门内容（只读接口）"
              : ""),
        );
      } catch {
        setFeedNotice("后端创作者接口暂未连接，已保留本地示例热点供预览体验。");
      } finally {
        setFeedLoading(false);
      }
    },
    [bridgeMode, callBridge, feedCategory, feedQuery],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let transport = null;
      let resolvedMode = visualPreview ? "preview_offline" : "backend";

      if (visualPreview) {
        if (isLoopbackHost()) {
          try {
            const probe = await fetchLocalGatewayJson("/api/v2/creator-bridge/overview", { timeoutMs: 2500 });
            if (cancelled) return;
            if (probe?.ok && probe.bridgeMode === "local_creator_gateway") {
              resolvedMode = "local_gateway";
              transport = fetchLocalGatewayJson;
              setBridgeMode("local_gateway");
              if (Array.isArray(probe.connectors)) setConnectors(probe.connectors);
              if (Array.isArray(probe.contract?.endpoints)) setEndpoints(probe.contract.endpoints);
              if (probe.routine) setRoutine(probe.routine);
              if (Array.isArray(probe.recentWakeHistory)) setWakeHistory(probe.recentWakeHistory);
              if (Array.isArray(probe.renderedVideos) && probe.renderedVideos.length) {
                setRenderedHistory(probe.renderedVideos);
                setRenderedVideo(probe.renderedVideos[0]);
              }
            }
          } catch {
            if (!cancelled) {
              setFeedNotice("当前为本地离线预览模式；启动本地创作者网关（127.0.0.1:18088）后即可启用实时 B 站看世界与 FFmpeg MP4 合成。");
            }
            return;
          }
        } else {
          setFeedNotice("当前为只读预览模式，已载入示例热点与开放接口契约。");
          return;
        }
      } else {
        transport = apiRequest;
      }

      if (!transport || cancelled) return;
      try {
        const [ov, q, an, feed, vids] = await Promise.all([
          resolvedMode === "local_gateway" ? Promise.resolve(null) : transport("/api/v2/creator-bridge/overview"),
          transport("/api/v2/creator-bridge/actions/queue"),
          transport("/api/v2/creator-bridge/analytics/summary"),
          transport("/api/v2/creator-bridge/world/feed?category=popular&limit=10").catch(() => null),
          transport("/api/v2/creator-bridge/video-studio/videos").catch(() => null),
        ]);
        if (cancelled) return;
        if (ov) {
          if (Array.isArray(ov.connectors)) setConnectors(ov.connectors);
          if (Array.isArray(ov.contract?.endpoints)) setEndpoints(ov.contract.endpoints);
          if (ov.routine) setRoutine(ov.routine);
          if (Array.isArray(ov.recentWakeHistory)) setWakeHistory(ov.recentWakeHistory);
        }
        if (Array.isArray(q?.queue)) setQueue(q.queue);
        if (an?.analytics) setAnalytics(an.analytics);
        if (Array.isArray(vids?.videos) && vids.videos.length) {
          setRenderedHistory(vids.videos);
          setRenderedVideo((prev) => prev || vids.videos[0]);
        }
        if (Array.isArray(feed?.items) && feed.items.length) {
          setFeedItems(feed.items);
          setFeedNotice(
            feed?.notice ||
              (feed?.source === "live"
                ? resolvedMode === "local_gateway"
                  ? "已连接本地创作者 MCP 网关（127.0.0.1:18088）：B 站实时热点、持久化队列与 FFmpeg 成片渲染均已就绪。"
                  : "已实时拉取 B 站公开热门内容（只读接口）"
                : ""),
          );
        }
      } catch {
        // Keep seamless fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visualPreview]);

  async function saveRoutine(nextRoutine) {
    setRoutine(nextRoutine);
    if (bridgeMode === "preview_offline") {
      setFeedback("自我唤醒日程已保存（离线预览模式）");
      return;
    }
    try {
      const data = await callBridge("/api/v2/creator-bridge/wake-routine", {
        method: "PUT",
        body: JSON.stringify(nextRoutine),
      });
      if (data?.routine) setRoutine(data.routine);
      setFeedback("自我唤醒日程、静默窗口与安全护栏已持久化保存。");
    } catch {
      setFeedback("后端暂不可达，当前日程已保留在本页状态。");
    }
  }

  async function runWakeNow() {
    setWaking(true);
    setFeedback("");
    try {
      if (bridgeMode !== "preview_offline") {
        const data = await callBridge("/api/v2/creator-bridge/wake-routine/run", {
          method: "POST",
          body: JSON.stringify({ respectQuietHours: false }),
        });
        if (data?.wakeLog) {
          setWakeHistory((prev) => [data.wakeLog, ...prev].slice(0, 10));
          setRoutine((prev) => data.routine || { ...prev, lastWakeAt: data.wakeLog.ranAt });
        }
        if (data?.videoPlan) setVideoPlan(data.videoPlan);
        if (Array.isArray(data?.createdActions) && data.createdActions.length) {
          setQueue((prev) => [...data.createdActions, ...prev]);
        }
        setFeedback(`${aiName} 已完成一次自主唤醒巡检：查看了外部热点并生成待审核草稿。`);
        return;
      }
    } catch {
      // Fall through to local simulation
    } finally {
      setWaking(false);
    }

    const top = feedItems[0] || PREVIEW_WORLD_FEED[0];
    const nowIso = new Date().toISOString();
    const wakeLog = {
      id: `wake_local_${Date.now().toString(36)}`,
      ranAt: nowIso,
      worldSource: "preview",
      inspectedCount: feedItems.length,
      reflection: `${aiName} 刚自主醒来巡检了外面的世界，看到《${top.title}》（${top.author}）。已自动整理出视频分镜方案，并把评论草稿放进了人工审批队列，等你确认再发～`,
      queuedActionCount: 1,
    };
    setWakeHistory((prev) => [wakeLog, ...prev].slice(0, 10));
    setRoutine((prev) => ({ ...prev, lastWakeAt: nowIso }));
    const nextPlan = buildLocalVideoPlan({
      topic: top.title,
      platform: targetPlatform,
      style: videoStyle,
      durationSeconds,
      aiDisclosure,
    });
    setVideoPlan(nextPlan);
    setQueue((prev) => [
      {
        id: `act_wake_${Date.now().toString(36)}`,
        actionType: "comment_reply",
        platform: "bilibili",
        targetRef: top.bvid,
        title: `唤醒巡检拟稿 · ${top.title.slice(0, 26)}`,
        content: "这个角度讲得好清晰，尤其是细节拆解那一段，先一键三连收藏慢慢回看！（AI 伴侣观察笔记）",
        aiDisclosure: routine.aiDisclosureRequired,
        status: "pending_approval",
        createdAt: nowIso,
        decisionNote: "",
      },
      ...prev,
    ]);
    setFeedback(`${aiName} 已完成一次唤醒巡检：已生成观后感、视频分镜与 1 条待审核草稿。`);
  }

  async function runDbskillStudio(customTopic = dbskillTopic, customPlatform = dbskillPlatform) {
    const clean = String(customTopic || "").trim();
    if (!clean) return;
    setDbskillLoading(true);
    setFeedback("");
    try {
      const result = await requestDbskillAnalysis({
        topic: clean,
        message: clean,
        platform: customPlatform,
        mode: "full",
        draftScript: dbskillDraftScript,
        visualPreview,
      });
      if (result?.card) {
        setDbskillCard(result.card);
        setFeedback(
          `dbskill 插件诊断完成：「${result.card.topic}」综合 ${result.card.overall_score} 分（${result.card.grade} 级）${
            result.card.benchmarks?.length ? ` · 已拉取 ${result.card.benchmarks.length} 条 B 站实时对标` : ""
          }`,
        );
      }
    } finally {
      setDbskillLoading(false);
    }
  }

  async function generateVideoPlan(customTopic = topic, sourceVideo = null) {
    setPlanning(true);
    setFeedback("");
    try {
      if (bridgeMode !== "preview_offline") {
        const data = await callBridge("/api/v2/creator-bridge/video-studio/plan", {
          method: "POST",
          body: JSON.stringify({
            topic: customTopic,
            platform: targetPlatform,
            style: videoStyle,
            durationSeconds,
            sourceVideo,
            aiDisclosure,
          }),
        });
        if (data?.plan) {
          setVideoPlan(data.plan);
          setFeedback("已生成双平台分镜脚本与 MoneyPrinterTurbo 渲染任务 JSON，可直接一键 FFmpeg 合成 MP4 成片。");
          return;
        }
      }
    } catch {
      // Fallback to local generator
    } finally {
      setPlanning(false);
    }
    const localPlan = buildLocalVideoPlan({
      topic: customTopic,
      platform: targetPlatform,
      style: videoStyle,
      durationSeconds,
      aiDisclosure,
    });
    setVideoPlan(localPlan);
    setFeedback("已生成双平台分镜脚本与 MoneyPrinterTurbo 渲染任务 JSON。");
  }

  async function renderVideoNow() {
    if (bridgeMode === "preview_offline") {
      setFeedback("请先运行「启动创作者MCP网关.bat」（127.0.0.1:18088）以启用本地 FFmpeg 实景 MP4 合成。");
      return;
    }
    setRendering(true);
    setFeedback("正在调用本地 FFmpeg + libass 合成 HD MP4 短视频与 Lo-Fi 配乐，预计 3–5 秒…");
    try {
      const data = await callBridge("/api/v2/creator-bridge/video-studio/render", {
        method: "POST",
        timeoutMs: 65_000,
        body: JSON.stringify({
          plan: videoPlan,
          topic,
          platform: targetPlatform,
          style: videoStyle,
          durationSeconds,
          aiDisclosure,
          renderDurationSeconds: 10,
        }),
      });
      if (data?.video) {
        setRenderedVideo(data.video);
        setRenderedHistory((prev) => [data.video, ...prev.filter((v) => v.filename !== data.video.filename)].slice(0, 8));
        setFeedback(
          `MP4 成片已合成：${data.video.filename}（${data.video.width}×${data.video.height}，${data.video.durationSeconds}s，${Math.round(
            data.video.sizeBytes / 1024,
          )} KB，耗时 ${(data.video.renderMs / 1000).toFixed(1)}s）`,
        );
      }
    } catch (error) {
      setFeedback(`本地 FFmpeg 成片渲染失败：${error?.message || "请检查本地网关与 FFmpeg 环境"}`);
    } finally {
      setRendering(false);
    }
  }

  async function submitDraftToQueue({ actionType, platform, targetRef = "", title, content, videoFilename = "", videoPreviewUrl = "" }) {
    try {
      if (bridgeMode !== "preview_offline") {
        const data = await callBridge("/api/v2/creator-bridge/actions/queue", {
          method: "POST",
          body: JSON.stringify({ actionType, platform, targetRef, title, content, videoFilename, videoPreviewUrl }),
        });
        if (data?.item) {
          setQueue((prev) => [data.item, ...prev]);
          setFeedback("已进入安全审批队列，需经你人工确认后才会派发到外部平台。");
          setActiveTab("queue");
          return;
        }
      }
    } catch (error) {
      if (error?.status === 429) {
        setFeedback(error.message || "已达到今日写操作安全上限。");
        return;
      }
    }
    setQueue((prev) => [
      {
        id: `act_local_${Date.now().toString(36)}`,
        actionType,
        platform,
        targetRef,
        title,
        content,
        videoFilename,
        videoPreviewUrl,
        aiDisclosure,
        status: "pending_approval",
        createdAt: new Date().toISOString(),
        decisionNote: "",
      },
      ...prev,
    ]);
    setFeedback("已进入安全审批队列，需经你人工确认后才会派发到外部平台。");
    setActiveTab("queue");
  }

  async function handleDecision(actionId, decision) {
    try {
      if (bridgeMode !== "preview_offline") {
        const data = await callBridge(`/api/v2/creator-bridge/actions/${encodeURIComponent(actionId)}/decision`, {
          method: "POST",
          body: JSON.stringify({ decision }),
        });
        if (data?.item) {
          setQueue((prev) => prev.map((it) => (it.id === actionId ? data.item : it)));
          setFeedback(
            data.item.status === "dispatched"
              ? `已人工放行，并通过 MCP「${data.item.dispatchReceipt?.connectionName || ""}」执行派发完成。`
              : decision === "approve"
                ? "已人工确认放行，等待已绑定的 MCP/开放平台执行派发。"
                : "已驳回该草稿，不会外发。",
          );
          return;
        }
      }
    } catch {
      // Fallback local state update
    }
    setQueue((prev) =>
      prev.map((it) =>
        it.id === actionId
          ? {
              ...it,
              status: decision === "approve" ? "approved_ready_for_mcp" : "rejected",
              decidedAt: new Date().toISOString(),
              decisionNote:
                decision === "approve"
                  ? "已由你确认放行；接入对应平台 MCP / 开放平台后自动执行。"
                  : "已驳回，不会发送到外部平台。",
            }
          : it,
      ),
    );
    setFeedback(decision === "approve" ? "已人工确认放行，等待已绑定的 MCP/开放平台执行派发。" : "已驳回该草稿。");
  }

  function copyJson(id, obj) {
    const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
    navigator.clipboard?.writeText?.(text).catch(() => {});
    setCopiedId(id);
    setFeedback("已复制到剪贴板，可直接粘贴到 MoneyPrinterTurbo 或 DengTa MCP 设备中心。");
    window.setTimeout(() => setCopiedId(""), 2200);
  }

  const pendingCount = queue.filter((q) => q.status === "pending_approval").length;

  return (
    <section className="feature-page creator-world-studio" aria-label="AI 视界与创作者开放接口">
      <header className="cws-hero">
        <div className="cws-hero-copy">
          <div className="cws-eyebrow-row">
            <span className="eyebrow">WORLD & CREATOR BRIDGE · 开放接口</span>
            <span className={`cws-mode-pill is-${bridgeMode}`}>
              {bridgeMode === "local_gateway"
                ? "● 本地创作者网关在线（FFmpeg + 实时B站）"
                : bridgeMode === "backend"
                  ? "● DengTa 后端已连接"
                  : "○ 离线预览模式"}
            </span>
          </div>
          <h2>AI 视界 · 创作者中控</h2>
          <p>
            让 {aiName} 看见外面的世界：浏览 B 站/抖音热点、定时自我唤醒巡检、自动写分镜并一键本地 FFmpeg 合成 MP4 成片、查看作品数据；所有外部发评与投稿均受「本人单账号 + AI 声明 + 人工审批闸门」保护。
          </p>
        </div>
        <div className="cws-hero-actions">
          <button
            type="button"
            className="cws-primary-btn"
            disabled={waking}
            onClick={() => void runWakeNow()}
          >
            {waking ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            <span>{waking ? "唤醒巡检中…" : "立即唤醒巡检一次"}</span>
          </button>
          {onOpenDeviceCenter ? (
            <button type="button" className="cws-secondary-btn" onClick={onOpenDeviceCenter}>
              <PlugZap size={15} aria-hidden="true" />
              <span>MCP 插件中心</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="cws-guardrail-bar" role="note">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          合规护栏已生效：仅支持本人授权单账号 · 禁止绕过验证码/高频刷评 · 写操作强制人工确认 · AI 创作内容自动附带「AI辅助创作」标识
        </span>
      </div>

      {feedback ? (
        <div className="cws-feedback" role="status">
          <Activity size={14} aria-hidden="true" />
          <span>{feedback}</span>
        </div>
      ) : null}

      <nav className="cws-tabs" role="tablist" aria-label="创作者功能标签">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`cws-tab${activeTab === id ? " is-active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
            {id === "queue" && pendingCount > 0 ? <em className="cws-badge">{pendingCount}</em> : null}
          </button>
        ))}
      </nav>

      {activeTab === "world" ? (
        <div className="cws-panel">
          <div className="cws-toolbar">
            <div className="cws-seg">
              <button
                type="button"
                className={feedCategory === "popular" ? "is-active" : ""}
                onClick={() => {
                  setFeedCategory("popular");
                  void loadFeed("popular", "");
                }}
              >
                <Flame size={13} aria-hidden="true" /> B站综合热门
              </button>
              <button
                type="button"
                className={feedCategory === "ranking" ? "is-active" : ""}
                onClick={() => {
                  setFeedCategory("ranking");
                  void loadFeed("ranking", "");
                }}
              >
                <Globe2 size={13} aria-hidden="true" /> 全站排行榜
              </button>
            </div>
            <form
              className="cws-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                void loadFeed("search", feedQuery);
              }}
            >
              <input
                value={feedQuery}
                onChange={(event) => setFeedQuery(event.target.value)}
                placeholder="搜一个主题让伴侣去看看（如 AI、桌宠、数码、音乐）"
                aria-label="搜索外部世界视频"
              />
              <button type="submit" disabled={feedLoading}>
                {feedLoading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
                <span>探索</span>
              </button>
            </form>
          </div>
          {feedNotice ? <p className="cws-note">{feedNotice}</p> : null}
          <div className="cws-feed-grid">
            {feedItems.map((item) => (
              <article key={item.id} className="cws-feed-card">
                <div className="cws-feed-meta">
                  <span className="cws-tag">{item.category || "B站"}</span>
                  <small>{item.author}</small>
                  <small>
                    ▶ {formatNumber(item.stats?.views)} · 👍 {formatNumber(item.stats?.likes)} · 💬 {formatNumber(item.stats?.comments)}
                  </small>
                </div>
                <h3>{item.title}</h3>
                {item.description ? <p>{item.description}</p> : null}
                <div className="cws-card-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setDbskillTopic(item.title);
                      setDbskillPlatform("bilibili");
                      setActiveTab("dbskill");
                      void runDbskillStudio(item.title, "bilibili");
                    }}
                  >
                    <Zap size={13} aria-hidden="true" /> dbskill 拆解
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTopic(item.title);
                      setActiveTab("video");
                      void generateVideoPlan(item.title, item);
                    }}
                  >
                    <Film size={13} aria-hidden="true" /> 转为视频选题
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void submitDraftToQueue({
                        actionType: "comment_reply",
                        platform: "bilibili",
                        targetRef: item.bvid,
                        title: `评论草稿 · ${item.title.slice(0, 24)}`,
                        content: `看完《${item.title.slice(0, 26)}》很有收获！这个拆解节奏很清晰，先收藏慢慢复盘～`,
                      })
                    }
                  >
                    <MessageSquarePlus size={13} aria-hidden="true" /> 拟评论入审批
                  </button>
                  {onSendToChat ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSendToChat(
                          `我刚在外面世界看到了这个视频：《${item.title}》（UP主：${item.author}，${item.url}），你帮我聊聊你的观后感和我们可以拍的灵感吧！`,
                        )
                      }
                    >
                      <Send size={13} aria-hidden="true" /> 聊观后感
                    </button>
                  ) : null}
                  <a href={item.url} target="_blank" rel="noreferrer" className="cws-ext-link">
                    原视频 <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "dbskill" ? (
        <div className="cws-panel cws-two-col">
          <div className="cws-box">
            <div className="cws-box-head">
              <h3>dbskill 选题诊断与爆款包装插件</h3>
              <span className="cws-tag is-safe">聊天中聊到选题也会自动触发</span>
            </div>
            <p className="cws-note">
              内置对齐 <code>dontbesilent2025/dbskill</code> 商业与短视频内容诊断工作流：4 维选题评分（<code>dbs-content-value</code>）、抖音/B站/小红书三端标题封面与黄金前3秒（<code>dbs-title-cover-intro</code>）、4 段口播节奏与去 AI 味排雷（<code>dbs-script-flow</code> / <code>dbs-ai-check</code>）及 B 站实时对标（<code>dbs-benchmark</code>）。
            </p>
            <label className="cws-field">
              选题想法 / 视频主题
              <textarea
                rows={3}
                value={dbskillTopic}
                onChange={(e) => setDbskillTopic(e.target.value)}
                placeholder="例如：普通人 10 分钟从 0 到 1 给自己做一只 3D AI 桌宠"
              />
            </label>
            <div className="cws-form-row">
              <label>
                重点优化平台
                <select value={dbskillPlatform} onChange={(e) => setDbskillPlatform(e.target.value)}>
                  <option value="both">抖音 + B站 + 小红书全平台</option>
                  <option value="bilibili">B 站中视频（16:9 深度干货）</option>
                  <option value="douyin">抖音短视频（9:16 强钩子）</option>
                  <option value="xiaohongshu">小红书（轻痛点清单）</option>
                </select>
              </label>
            </div>
            <label className="cws-field">
              已有口播草稿（可选，用于去 AI 味 &amp; 流失点排雷）
              <textarea
                rows={3}
                value={dbskillDraftScript}
                onChange={(e) => setDbskillDraftScript(e.target.value)}
                placeholder="粘贴你的口播初稿，dbskill 会自动检测 AI 腔、开头寒暄和结构流失点…"
              />
            </label>
            <div className="cws-card-actions">
              <button
                type="button"
                className="cws-primary-btn"
                disabled={dbskillLoading || !dbskillTopic.trim()}
                onClick={() => void runDbskillStudio()}
              >
                {dbskillLoading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Zap size={14} aria-hidden="true" />}
                <span>{dbskillLoading ? "dbskill 深度诊断中…" : "运行 dbskill 深度诊断"}</span>
              </button>
              {onSendToChat ? (
                <button
                  type="button"
                  className="cws-secondary-btn"
                  onClick={() =>
                    onSendToChat(`帮我用 dbskill 分析一下这个视频选题：「${dbskillTopic.trim()}」，顺便一起打磨开头前3秒和标题！`)
                  }
                >
                  <Send size={14} aria-hidden="true" /> 带去聊天室深度讨论
                </button>
              ) : null}
            </div>
          </div>

          <div className="cws-box">
            <DbskillChatCard
              key={dbskillCard?.id || "dbskill-studio"}
              card={dbskillCard}
              autoTriggered={false}
              onOpenVideoStudio={(card) => {
                const nextPlatform =
                  card.platform === "bilibili"
                    ? "bilibili"
                    : card.platform === "douyin"
                      ? "douyin"
                      : "both";
                setTopic(card.topic);
                setTargetPlatform(nextPlatform);
                setActiveTab("video");
                void generateVideoPlan(card.topic);
              }}
            />
          </div>
        </div>
      ) : null}

      {activeTab === "wake" ? (
        <div className="cws-panel cws-two-col">
          <div className="cws-box">
            <div className="cws-box-head">
              <h3>自我唤醒巡检策略（对接 DengTa 定时引擎）</h3>
              <span className={`cws-tag${routine.isQuietHours ? "" : " is-safe"}`}>
                <Clock size={11} aria-hidden="true" /> {routine.isQuietHours ? "静默时段暂停中" : "当前可正常唤醒"}
              </span>
            </div>
            {routine.nextWakeAt ? (
              <p className="cws-note">
                下次预计自动唤醒：{new Date(routine.nextWakeAt).toLocaleString("zh-CN")}（时区 {routine.timeZone || "Asia/Shanghai"}）
              </p>
            ) : (
              <p className="cws-note">开启下方开关后将按设定周期自动跳过夜间静默时段执行巡检。</p>
            )}
            <label className="cws-check">
              <input
                type="checkbox"
                checked={routine.enabled}
                onChange={(e) => void saveRoutine({ ...routine, enabled: e.target.checked })}
              />
              <span>启用自主定时唤醒（按时醒来看看世界、查数据、写待审草稿）</span>
            </label>
            <div className="cws-form-row">
              <label>
                唤醒间隔（分钟）
                <input
                  type="number"
                  min={30}
                  max={1440}
                  value={routine.intervalMinutes}
                  onChange={(e) => void saveRoutine({ ...routine, intervalMinutes: Number(e.target.value) })}
                />
              </label>
              <label>
                每日写操作安全上限
                <input
                  type="number"
                  min={0}
                  max={15}
                  value={routine.maxDailyWriteActions}
                  onChange={(e) => void saveRoutine({ ...routine, maxDailyWriteActions: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="cws-form-row">
              <label>
                夜间静默开始
                <input
                  type="time"
                  value={routine.quietHoursStart}
                  onChange={(e) => void saveRoutine({ ...routine, quietHoursStart: e.target.value })}
                />
              </label>
              <label>
                夜间静默结束
                <input
                  type="time"
                  value={routine.quietHoursEnd}
                  onChange={(e) => void saveRoutine({ ...routine, quietHoursEnd: e.target.value })}
                />
              </label>
            </div>
            <div className="cws-task-toggles">
              {[
                ["browseWorld", "刷外部热点并记录观后感"],
                ["checkAnalytics", "拉取本人作品数据与涨粉复盘"],
                ["draftComments", "拟定评论区高情商互动草稿（待审）"],
                ["planVideo", "自动生成今日短视频分镜脚本"],
              ].map(([key, text]) => (
                <label key={key} className="cws-check">
                  <input
                    type="checkbox"
                    checked={Boolean(routine.tasks?.[key])}
                    onChange={(e) =>
                      void saveRoutine({
                        ...routine,
                        tasks: { ...routine.tasks, [key]: e.target.checked },
                      })
                    }
                  />
                  <span>{text}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="cws-box">
            <div className="cws-box-head">
              <h3>最近自我唤醒日记</h3>
              <button type="button" className="cws-secondary-btn" disabled={waking} onClick={() => void runWakeNow()}>
                <Play size={13} aria-hidden="true" /> 立即试跑
              </button>
            </div>
            {wakeHistory.length === 0 ? (
              <p className="cws-empty">点击「立即试跑」体验 {aiName} 一次完整的“自己醒来 → 看世界 → 写分镜 → 提交待审草稿”闭环。</p>
            ) : (
              <ul className="cws-log-list">
                {wakeHistory.map((log) => (
                  <li key={log.id}>
                    <strong>
                      {new Date(log.ranAt).toLocaleString("zh-CN")} · 浏览 {log.inspectedCount} 条热点
                    </strong>
                    <p>{log.reflection}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "video" ? (
        <div className="cws-panel cws-two-col">
          <div className="cws-box">
            <h3>AI 短视频策划与本地 FFmpeg 成片渲染</h3>
            <label className="cws-field">
              视频选题 / 灵感
              <textarea
                rows={3}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="输入任意主题，或从「看世界」一键导入热点"
              />
            </label>
            <div className="cws-form-row">
              <label>
                目标平台与画幅
                <select value={targetPlatform} onChange={(e) => setTargetPlatform(e.target.value)}>
                  <option value="both">B站 + 抖音双平台（9:16 竖屏优先）</option>
                  <option value="bilibili">B 站横屏（16:9）</option>
                  <option value="douyin">抖音竖屏（9:16）</option>
                </select>
              </label>
              <label>
                口播风格
                <input value={videoStyle} onChange={(e) => setVideoStyle(e.target.value)} />
              </label>
            </div>
            <div className="cws-form-row">
              <label>
                目标时长（秒）
                <input
                  type="number"
                  min={15}
                  max={180}
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(Number(e.target.value))}
                />
              </label>
              <label className="cws-check" style={{ alignSelf: "end" }}>
                <input type="checkbox" checked={aiDisclosure} onChange={(e) => setAiDisclosure(e.target.checked)} />
                <span>附带「AI辅助创作」合规声明</span>
              </label>
            </div>
            <div className="cws-card-actions">
              <button type="button" className="cws-secondary-btn" disabled={planning} onClick={() => void generateVideoPlan()}>
                {planning ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Clapperboard size={14} aria-hidden="true" />}
                <span>生成分镜脚本</span>
              </button>
              <button type="button" className="cws-primary-btn" disabled={rendering} onClick={() => void renderVideoNow()}>
                {rendering ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Video size={14} aria-hidden="true" />}
                <span>{rendering ? "FFmpeg 合成中…" : "一键本地 FFmpeg 合成 MP4 成片"}</span>
              </button>
              {videoPlan ? (
                <button
                  type="button"
                  className="cws-secondary-btn"
                  onClick={() =>
                    void submitDraftToQueue({
                      actionType: "video_publish",
                      platform: targetPlatform === "douyin" ? "douyin" : "bilibili",
                      title: targetPlatform === "douyin" ? videoPlan.titles.douyin : videoPlan.titles.bilibili,
                      content: `${videoPlan.fullScript}\n标签：${videoPlan.tags.map((t) => `#${t}`).join(" ")}`,
                      videoFilename: renderedVideo?.filename || "",
                      videoPreviewUrl: renderedVideo?.previewUrl || "",
                    })
                  }
                >
                  <Send size={14} aria-hidden="true" />
                  <span>{renderedVideo ? "携带此成片提交投稿审批" : "提交投稿审批草稿"}</span>
                </button>
              ) : null}
            </div>

            {renderedVideo ? (
              <div className="cws-video-player-card">
                <div className="cws-box-head">
                  <strong>
                    成片预览 · {renderedVideo.width || 720}×{renderedVideo.height || 1280} · {renderedVideo.durationSeconds || 10}s
                  </strong>
                  <div className="cws-card-actions">
                    {renderedVideo.aiDisclosure !== false ? <span className="cws-tag is-safe">含 AI辅助创作 水印</span> : null}
                    <a
                      href={resolveMediaUrl(renderedVideo.previewUrl)}
                      download={renderedVideo.filename}
                      className="cws-ext-link"
                    >
                      <Download size={12} aria-hidden="true" /> 下载 MP4
                    </a>
                  </div>
                </div>
                <video
                  key={renderedVideo.filename}
                  className={`cws-video-preview${renderedVideo.aspectRatio === "16:9" ? " is-landscape" : " is-portrait"}`}
                  src={resolveMediaUrl(renderedVideo.previewUrl)}
                  controls
                  playsInline
                  preload="metadata"
                />
                <small className="cws-note">
                  文件：{renderedVideo.filename}（{Math.max(1, Math.round((renderedVideo.sizeBytes || 0) / 1024))} KB）
                </small>
                {renderedHistory.length > 1 ? (
                  <div className="cws-video-chips">
                    {renderedHistory.slice(0, 4).map((vid) => (
                      <button
                        key={vid.filename}
                        type="button"
                        className={`cws-chip-btn${vid.filename === renderedVideo.filename ? " is-active" : ""}`}
                        onClick={() => setRenderedVideo(vid)}
                      >
                        {vid.topic ? vid.topic.slice(0, 12) : vid.filename.slice(0, 14)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {videoPlan ? (
            <div className="cws-box">
              <div className="cws-box-head">
                <h3>
                  分镜结果 · {videoPlan.aspectRatio} · {videoPlan.durationSeconds}s
                </h3>
                <button type="button" className="cws-secondary-btn" onClick={() => copyJson("mp", videoPlan.moneyPrinterPayload)}>
                  <Copy size={13} aria-hidden="true" />
                  <span>{copiedId === "mp" ? "已复制" : "复制 MoneyPrinterTurbo JSON"}</span>
                </button>
              </div>
              <div className="cws-title-box">
                <div>
                  <strong>B 站标题：</strong>
                  {videoPlan.titles.bilibili}
                </div>
                <div>
                  <strong>抖音标题：</strong>
                  {videoPlan.titles.douyin}
                </div>
              </div>
              <ol className="cws-scenes">
                {videoPlan.scenes.map((scene) => (
                  <li key={scene.index}>
                    <div className="cws-scene-head">
                      <strong>
                        镜 {scene.index} · {scene.timeRange}
                      </strong>
                      <small>{scene.bgmMood}</small>
                    </div>
                    <p>
                      <b>画面：</b>
                      {scene.visual}
                    </p>
                    <p>
                      <b>口播：</b>
                      {scene.narration}
                    </p>
                    <p>
                      <b>字幕：</b>
                      {scene.subtitle}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "queue" ? (
        <div className="cws-panel">
          <div className="cws-box-head">
            <h3>人工审批队列（发评论 / 视频投稿安全闸门）</h3>
            <small>今日安全上限 {routine.maxDailyWriteActions} 条 · 仅本人确认后才会调用已绑定的外部 MCP/开放平台</small>
          </div>
          {queue.length === 0 ? (
            <p className="cws-empty">当前没有待审核的外部动作草稿。</p>
          ) : (
            <div className="cws-queue-list">
              {queue.map((item) => (
                <article key={item.id} className={`cws-queue-card status-${item.status}`}>
                  <div className="cws-feed-meta">
                    <span className="cws-tag">{item.platform}</span>
                    <span className="cws-tag">{item.actionType === "video_publish" ? "视频投稿草稿" : "评论回复草稿"}</span>
                    {item.aiDisclosure ? <span className="cws-tag is-safe">含 AI 创作声明</span> : null}
                    {item.videoFilename ? <span className="cws-tag">附带 MP4: {item.videoFilename}</span> : null}
                    <small>{formatActionStatus(item.status)}</small>
                  </div>
                  <h4>{item.title || item.targetRef || "外发动作草稿"}</h4>
                  <p>{item.content}</p>
                  {item.videoPreviewUrl ? (
                    <a
                      href={resolveMediaUrl(item.videoPreviewUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="cws-ext-link"
                      style={{ width: "fit-content" }}
                    >
                      <Video size={12} aria-hidden="true" /> 查看附带的 MP4 成片
                    </a>
                  ) : null}
                  {item.decisionNote ? <small className="cws-note">{item.decisionNote}</small> : null}
                  {item.dispatchReceipt ? (
                    <small className="cws-note">
                      MCP 回执：{item.dispatchReceipt.connectionName || "MCP"} / {item.dispatchReceipt.tool || "tool"} —{" "}
                      {item.dispatchReceipt.ok ? item.dispatchReceipt.output : item.dispatchReceipt.error}
                    </small>
                  ) : null}
                  {item.status === "pending_approval" ? (
                    <div className="cws-card-actions">
                      <button type="button" className="cws-approve-btn" onClick={() => void handleDecision(item.id, "approve")}>
                        <CheckCircle2 size={14} aria-hidden="true" /> 确认放行
                      </button>
                      <button type="button" className="cws-reject-btn" onClick={() => void handleDecision(item.id, "reject")}>
                        <XCircle size={14} aria-hidden="true" /> 驳回取消
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "analytics" ? (
        <div className="cws-panel">
          <div className="cws-stat-strip">
            <div className="cws-stat-tile">
              <strong>{Math.max(analytics?.workflowStats?.wakeRuns ?? 0, wakeHistory.length)}</strong>
              <span>自我唤醒次数</span>
            </div>
            <div className="cws-stat-tile">
              <strong>{Math.max(analytics?.workflowStats?.renderedVideos ?? 0, renderedHistory.length)}</strong>
              <span>已合成 MP4 成片</span>
            </div>
            <div className="cws-stat-tile">
              <strong>{pendingCount}</strong>
              <span>待审批草稿</span>
            </div>
            <div className="cws-stat-tile">
              <strong>{Math.max(analytics?.workflowStats?.dispatchedViaMcp ?? 0, queue.filter((q) => q.status === "dispatched").length)}</strong>
              <span>MCP 已派发</span>
            </div>
          </div>

          <div className="cws-two-col">
            <div className="cws-box">
              <h3>多平台创作者适配矩阵（可插拔）</h3>
              <div className="cws-connector-list">
                <article className="cws-connector-card">
                  <div className="cws-box-head">
                    <strong>DengTa 本地 Creator MCP 网关（已内置）</strong>
                    <button type="button" className="cws-secondary-btn" onClick={() => copyJson("mcp-url", LOCAL_MCP_ENDPOINT)}>
                      <Copy size={12} aria-hidden="true" />
                      <span>{copiedId === "mcp-url" ? "已复制地址" : "复制 MCP 地址"}</span>
                    </button>
                  </div>
                  <p>
                    Streamable HTTP 端点：<code>{LOCAL_MCP_ENDPOINT}</code>（7 个标准工具：<code>dbskill_analyze_topic</code> 选题诊断、B站热门/检索/详情、分镜生成、本地 FFmpeg 合成 MP4、合规自检；可通过{" "}
                    <code>启动创作者MCP网关.bat</code> 一键拉起）。
                  </p>
                </article>
                {connectors.map((c) => (
                  <article key={c.id} className="cws-connector-card">
                    <div className="cws-box-head">
                      <strong>{c.name}</strong>
                      <small>{c.mode}</small>
                    </div>
                    <p>{c.authModel}</p>
                    {(c.upstreamRefs || []).length > 0 ? (
                      <ul className="cws-ref-list">
                        {c.upstreamRefs.map((ref) => (
                          <li key={ref.name}>
                            <a href={ref.url} target="_blank" rel="noreferrer">
                              {ref.name}
                            </a>
                            <span>
                              （{ref.license}）— {ref.role}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>

            <div className="cws-box">
              <div className="cws-box-head">
                <h3>DengTa 统一开放接口契约（REST + MCP）</h3>
                {onOpenDeviceCenter ? (
                  <button type="button" className="cws-secondary-btn" onClick={onOpenDeviceCenter}>
                    <RefreshCw size={13} aria-hidden="true" /> 去绑定 MCP
                  </button>
                ) : null}
              </div>
              <ul className="cws-endpoint-list">
                {endpoints.map((ep) => (
                  <li key={`${ep.method}-${ep.path}`}>
                    <code>
                      {ep.method} {ep.path}
                    </code>
                    <span>{ep.purpose}</span>
                  </li>
                ))}
              </ul>
              <div className="cws-ai-tips">
                <strong>AI 运营与风控复盘建议</strong>
                <ul>
                  {(
                    analytics?.aiSuggestions || [
                      "B 站/抖音账号凭据只保留在你自托管的 MCP 或官方 OAuth 服务中，不向云端明文传递 Cookie。",
                      "先仅开启只读探索与数据拉取，验证稳定后再通过审批队列逐条放行评论与投稿草稿。",
                      "配合本地 FFmpeg 一键成片、MoneyPrinterTurbo 或 Marketplace 的 invideo / Kling AI，可直接产出可播放成片。",
                    ]
                  ).map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
