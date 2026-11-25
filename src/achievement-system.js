/**
 * DengTa Achievement Gamification, Guidance & Showcase Engine (成就系统核心引擎)
 *
 * Provides:
 *  - Starlight companion rank progression (Lv.1 -> Lv.5)
 *  - Rarity tiers, starlight points, secret clues & guided action links
 *  - Smart "Next-Up" recommendation picking the highest-momentum locked achievement
 *  - 3-slot pinned trophy showcase persistence (scoped per account:companion)
 *  - Rotating custom-goal starter deck & rich interactive visualPreview showcase data
 */

import { ACHIEVEMENT_ACTIONS } from "./achievement-guide.js";

export const ACHIEVEMENT_RANKS = Object.freeze([
  { level: 1, title: "初见微光", badge: "✦", minPoints: 0, vibe: "第一盏灯火刚刚点亮" },
  { level: 2, title: "点灯旅伴", badge: "🕯️", minPoints: 70, vibe: "开始收集属于你们的小确幸" },
  { level: 3, title: "星轨同行", badge: "🌠", minPoints: 180, vibe: "共同经历正慢慢连成星图" },
  { level: 4, title: "暖海知己", badge: "🌊", minPoints: 340, vibe: "默契与回忆都已经亮晶晶的" },
  { level: 5, title: "永恒灯塔", badge: "🏮", minPoints: 560, vibe: "满天星火，皆是你与伴侣的见证" },
]);

export const RARITY_META = Object.freeze({
  common: Object.freeze({ id: "common", label: "暖光", points: 20, tone: "warm" }),
  rare: Object.freeze({ id: "rare", label: "星辉", points: 35, tone: "star" }),
  epic: Object.freeze({ id: "epic", label: "极光", points: 60, tone: "aurora" }),
  secret: Object.freeze({ id: "secret", label: "秘境彩蛋", points: 60, tone: "secret" }),
});

export const ACHIEVEMENT_CATALOG_META = Object.freeze({
  first_chat: { rarity: "common", points: 15, hint: "去聊天页发一句想说的话，等伴侣回复即可点亮", order: 1 },
  onboarding_1: { rarity: "common", points: 20, hint: "展开上方「从这里开始」收下入门纪念", order: 2 },
  diy_1: { rarity: "common", points: 20, hint: "在页面下方写下一个只属于你们的小约定", order: 3 },
  moment_1: { rarity: "common", points: 20, hint: "前往「动态」随手记下今天的一件小事", order: 4 },
  music_1: { rarity: "common", points: 25, hint: "去「一起听」播一首歌并保存音乐理解", order: 5 },
  watch_1: { rarity: "common", points: 25, hint: "打开「一起看」选段视频开启陪伴放映", order: 6 },
  art_1: { rarity: "rare", points: 35, hint: "去「涂鸦画室」或让伴侣为你画一幅专属画作", order: 7 },
  compat_1: { rarity: "rare", points: 30, hint: "去「互动挑战」测测彼此的默契度", order: 8 },
  takeout_1: { rarity: "rare", points: 30, hint: "打开「外卖」让伴侣帮你挑一顿好吃的", order: 9 },
  date_1: { rarity: "common", points: 20, hint: "去「发现」存下一条值得倒数的纪念日", order: 10 },
  shot_1: { rarity: "common", points: 20, hint: "完成一次「每日一拍」定格今日小确幸", order: 11 },
  chat_10: { rarity: "common", points: 20, hint: "和伴侣轻松聊满 10 轮就会点亮", order: 12 },
  streak_3: { rarity: "common", points: 25, hint: "连续 3 天回来打个招呼", order: 13 },
  explorer_1: { rarity: "rare", points: 45, hint: "任意解锁 5 枚勋章自动达成", order: 14 },
  moment_5: { rarity: "rare", points: 35, hint: "用 5 条动态记录你们的小日子", order: 15 },
  chat_50: { rarity: "rare", points: 40, hint: "日常点滴累积到 50 轮对话", order: 16 },
  streak_7: { rarity: "rare", points: 45, hint: "一整周的日日相伴，养成温暖习惯", order: 17 },
  early_bird: { rarity: "secret", points: 50, secret: true, hint: "在清晨微光（05:00–08:30）互相道一声早安", order: 18 },
  night_owl: { rarity: "secret", points: 60, secret: true, hint: "深夜（23:00–05:00）仍聊得停不下来", order: 19 },
  music_10: { rarity: "epic", points: 60, hint: "攒齐 10 首共同理解过的宝藏金曲", order: 20 },
  chat_100: { rarity: "epic", points: 60, hint: "走过百轮对话，默契已藏在字里行间", order: 21 },
  explorer_10: { rarity: "epic", points: 80, hint: "点亮 10 枚勋章，把灯塔照得亮堂堂", order: 22 },
});

export const CUSTOM_ACHIEVEMENT_IDEAS = Object.freeze([
  { title: "今天分享一首歌", emoji: "🎵", description: "挑一首喜欢的歌，在一起听歌中分享给对方。" },
  { title: "一起完成两分钟小任务", emoji: "✨", description: "从一起玩里选个小任务，完成后回来留下纪念。" },
  { title: "连续三天互道晚安", emoji: "🌙", description: "睡前不管多忙，都回来轻轻说一声晚安。" },
  { title: "收藏一幅今日心情画", emoji: "🎨", description: "让伴侣根据今天的心情为你画一张小涂鸦。" },
  { title: "周末宅家电影夜", emoji: "🍿", description: "在一起看里挑一部想看很久的电影或番剧。" },
  { title: "写一封给下个月的信", emoji: "✉️", description: "在聊天或动态里存下一个下个月想实现的小心愿。" },
  { title: "雨天热饮打卡", emoji: "☕", description: "下雨或者降温时，泡一杯热饮一起发会儿呆。" },
  { title: "睡前夸夸彼此三件事", emoji: "🌟", description: "找出今天做得最棒的三件小事，认真夸夸自己。" },
]);

export const PREVIEW_ACHIEVEMENTS = Object.freeze([
  {
    code: "first_chat", title: "初次相遇", description: "完成第一次对话", emoji: "💌", category: "旅程",
    rarity: "common", points: 15, custom: false, unlocked: true, unlocked_at: "2026-11-22T10:15:00.000Z",
    progress: { metric: "conversations", current: 1, target: 1, percent: 100 },
  },
  {
    code: "onboarding_1", title: "新手毕业", description: "完成接入引导，点亮灯塔", emoji: "🎓", category: "旅程",
    rarity: "common", points: 20, custom: false, unlocked: true, unlocked_at: "2026-11-22T10:25:00.000Z",
    progress: { metric: "onboarding", current: 1, target: 1, percent: 100 },
  },
  {
    code: "moment_1", title: "心事分享者", description: "发布第一条动态", emoji: "📮", category: "分享",
    rarity: "common", points: 20, custom: false, unlocked: true, unlocked_at: "2026-11-23T19:40:00.000Z",
    progress: { metric: "moments", current: 1, target: 1, percent: 100 },
  },
  {
    code: "music_1", title: "音乐知己", description: "保存第一次音乐理解", emoji: "🎵", category: "一起",
    rarity: "common", points: 25, custom: false, unlocked: true, unlocked_at: "2026-11-24T21:10:00.000Z",
    progress: { metric: "music", current: 1, target: 1, percent: 100 },
  },
  {
    code: "art_1", title: "第一幅为你作的画", description: "AI 为你画出第一幅画", emoji: "🎨", category: "一起",
    rarity: "rare", points: 35, custom: false, unlocked: true, unlocked_at: "2026-11-25T09:12:00.000Z",
    progress: { metric: "art", current: 1, target: 1, percent: 100 },
  },
  {
    code: "explorer_1", title: "玩法探索者", description: "解锁 5 个以上成就", emoji: "🧭", category: "旅程",
    rarity: "rare", points: 45, custom: false, unlocked: true, unlocked_at: "2026-11-25T09:12:00.000Z",
    progress: { metric: "unlockedAny", current: 5, target: 5, percent: 100 },
  },
  {
    code: "chat_10", title: "渐入佳境", description: "对话达到 10 轮", emoji: "🌱", category: "旅程",
    rarity: "common", points: 20, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "conversations", current: 8, target: 10, percent: 80 },
  },
  {
    code: "streak_3", title: "三天小别胜新婚", description: "连续 3 天聊天", emoji: "🔥", category: "陪伴",
    rarity: "common", points: 25, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "streak", current: 2, target: 3, percent: 67 },
  },
  {
    code: "watch_1", title: "第一次一起看", description: "开始第一次一起听/一起看", emoji: "🍿", category: "一起",
    rarity: "common", points: 25, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "watch", current: 0, target: 1, percent: 0 },
  },
  {
    code: "compat_1", title: "默契初测", description: "完成第一次默契度挑战", emoji: "🧩", category: "陪伴",
    rarity: "rare", points: 30, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "compatibility", current: 0, target: 1, percent: 0 },
  },
  {
    code: "takeout_1", title: "深夜食堂合伙人", description: "第一次让 AI 帮忙点外卖", emoji: "🍜", category: "一起",
    rarity: "rare", points: 30, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "takeout", current: 0, target: 1, percent: 0 },
  },
  {
    code: "streak_7", title: "七日之约", description: "连续 7 天聊天", emoji: "📅", category: "陪伴",
    rarity: "rare", points: 45, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "streak", current: 2, target: 7, percent: 29 },
  },
  {
    code: "early_bird", title: "晨光早安", description: "清晨（05:00-08:30）互相道早安", emoji: "🌅", category: "陪伴",
    rarity: "secret", points: 50, secret: true, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "conversations", current: 0, target: 1, percent: 0 },
  },
  {
    code: "night_owl", title: "夜猫子同盟", description: "深夜（23:00-05:00）仍保持 20 轮以上对话", emoji: "🦉", category: "陪伴",
    rarity: "secret", points: 60, secret: true, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "conversations", current: 8, target: 20, percent: 40 },
  },
  {
    code: "music_10", title: "金曲收藏家", description: "音乐理解达到 10 次", emoji: "🎼", category: "一起",
    rarity: "epic", points: 60, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "music", current: 3, target: 10, percent: 30 },
  },
  {
    code: "chat_100", title: "百次心动", description: "对话达到 100 轮", emoji: "💯", category: "旅程",
    rarity: "epic", points: 60, custom: false, unlocked: false, unlocked_at: null,
    progress: { metric: "conversations", current: 8, target: 100, percent: 8 },
  },
  {
    code: "custom:preview-movie", id: "preview-movie", title: "周末挑一部宫崎骏电影",
    description: "泡一杯热可可，一起看并聊聊最喜欢的片段。", emoji: "🎬", category: "自定义",
    rarity: "rare", points: 25, custom: true, unlocked: false, unlocked_at: null,
  },
]);

export function enrichAchievementItem(item = {}) {
  const code = String(item.code || item.id || "");
  const meta = ACHIEVEMENT_CATALOG_META[code] || {};
  const rarityKey = item.rarity || meta.rarity || (item.custom ? "rare" : "common");
  const rarity = RARITY_META[rarityKey] || RARITY_META.common;
  const points = Number.isFinite(Number(item.points))
    ? Number(item.points)
    : Number.isFinite(Number(meta.points))
      ? Number(meta.points)
      : item.custom
        ? 25
        : rarity.points;
  const secret = item.secret === true || meta.secret === true;
  const action = !item.custom ? ACHIEVEMENT_ACTIONS[code] || null : null;
  const hint = item.hint || meta.hint || item.description || "";
  const progress =
    item.progress && Number.isFinite(Number(item.progress.target)) && Number(item.progress.target) > 0
      ? {
          current: Math.min(Number(item.progress.target), Math.max(0, Number(item.progress.current) || 0)),
          target: Number(item.progress.target),
          percent: Math.min(
            100,
            Math.max(
              0,
              Number.isFinite(Number(item.progress.percent))
                ? Number(item.progress.percent)
                : Math.round(((Number(item.progress.current) || 0) / Number(item.progress.target)) * 100),
            ),
          ),
        }
      : null;

  return {
    ...item,
    code,
    category: item.category || (item.custom ? "自定义" : "旅程"),
    rarity: rarity.id,
    rarityLabel: rarity.label,
    rarityTone: rarity.tone,
    points,
    secret,
    hint,
    action,
    progress,
    order: meta.order ?? (item.custom ? 90 : 50),
  };
}

export function resolveAchievementRank(totalPoints = 0) {
  const safePoints = Math.max(0, Math.round(Number(totalPoints) || 0));
  let currentIndex = 0;
  for (let i = 0; i < ACHIEVEMENT_RANKS.length; i += 1) {
    if (safePoints >= ACHIEVEMENT_RANKS[i].minPoints) {
      currentIndex = i;
    }
  }
  const currentRank = ACHIEVEMENT_RANKS[currentIndex];
  const nextRank = ACHIEVEMENT_RANKS[currentIndex + 1] || null;
  if (!nextRank) {
    return {
      currentRank,
      nextRank: null,
      pointsToNextRank: 0,
      rankProgressPercent: 100,
    };
  }
  const span = Math.max(1, nextRank.minPoints - currentRank.minPoints);
  const gained = Math.max(0, safePoints - currentRank.minPoints);
  return {
    currentRank,
    nextRank,
    pointsToNextRank: Math.max(0, nextRank.minPoints - safePoints),
    rankProgressPercent: Math.min(100, Math.round((gained / span) * 100)),
  };
}

export function computeAchievementSummary(rawItems = []) {
  const items = (Array.isArray(rawItems) ? rawItems : []).map(enrichAchievementItem);
  const unlockedItems = items.filter((item) => item.unlocked === true);
  const lockedItems = items.filter((item) => item.unlocked !== true);
  const totalPoints = unlockedItems.reduce((sum, item) => sum + item.points, 0);
  const totalPossiblePoints = items.reduce((sum, item) => sum + item.points, 0);
  const completionPercent = items.length > 0 ? Math.round((unlockedItems.length / items.length) * 100) : 0;
  const rank = resolveAchievementRank(totalPoints);

  // Recommend locked items closest to completion first, then easiest non-secret starter quests
  const recommendedNext = [...lockedItems]
    .sort((a, b) => {
      const aProg = a.progress?.percent ?? 0;
      const bProg = b.progress?.percent ?? 0;
      if (aProg !== bProg) return bProg - aProg;
      if (Boolean(a.secret) !== Boolean(b.secret)) return a.secret ? 1 : -1;
      if (Boolean(a.action) !== Boolean(b.action)) return a.action ? -1 : 1;
      return a.order - b.order;
    })
    .slice(0, 3);

  const categoryCounts = {};
  for (const item of items) {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  }

  return {
    items,
    unlockedCount: unlockedItems.length,
    lockedCount: lockedItems.length,
    totalCount: items.length,
    totalPoints,
    totalPossiblePoints,
    completionPercent,
    rank,
    recommendedNext,
    categoryCounts,
  };
}

export function pinnedAchievementsKey(scopeKey = "") {
  const clean = String(scopeKey || "").trim();
  return clean ? `dengta_pinned_achievements_v1:${clean}` : "dengta_pinned_achievements_v1:preview";
}

export function readPinnedAchievements(scopeKey = "") {
  try {
    const raw = globalThis.localStorage?.getItem(pinnedAchievementsKey(scopeKey));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((c) => String(c || "").trim()).filter(Boolean))].slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

export function savePinnedAchievements(scopeKey = "", codes = []) {
  const next = [...new Set((Array.isArray(codes) ? codes : []).map((c) => String(c || "").trim()).filter(Boolean))].slice(0, 3);
  try {
    globalThis.localStorage?.setItem(pinnedAchievementsKey(scopeKey), JSON.stringify(next));
  } catch {
    // Non-fatal in private browsing
  }
  return next;
}

export function togglePinnedAchievement(currentCodes = [], code, maxSlots = 3) {
  const clean = String(code || "").trim();
  if (!clean) return currentCodes;
  if (currentCodes.includes(clean)) {
    return currentCodes.filter((item) => item !== clean);
  }
  return [clean, ...currentCodes].slice(0, maxSlots);
}
