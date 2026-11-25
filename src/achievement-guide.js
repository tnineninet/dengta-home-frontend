export const GUIDE_STEPS = [
  { id: "hello", title: "先聊一句", action: "去聊天", text: "在底部输入框写一句你想说的话，再点发送。等伴侣回复，就完成了一次对话。不知道说什么，可以先试试“你好，今天想和你认识一下”。" },
  { id: "connect", title: "需要时再接入", action: "去模型接入", text: "如果已经能聊天，这步可以跳过。如果提示还没有可用接口，打开「设置 → 模型与服务 → 模型接入」，粘贴服务商给的 Base URL 和 API Key。页面会自动读取模型目录并帮你启用；密钥是访问凭证，不要发进聊天。" },
  { id: "explore", title: "挑一个喜欢的玩法", action: "去挑一个开场", text: "回到聊天，点输入框旁的“更多输入功能”，展开“一起玩”。挑个故事或小任务，改成自己的说法，放进输入框后再发送。选卡片不会自动发消息。" },
  { id: "keepsake", title: "留一份小纪念", action: "收下入门纪念", text: "完成第一次对话后，可以收下入门纪念。其他步骤按自己的需要体验就好；跳过不影响聊天，也不会失去已有成就。" },
];

export function guideStorageKey(account, companion) {
  return account && companion ? `dengta_guide_v2:${JSON.stringify([account, companion])}` : null;
}

export function readGuidePreferences(key) {
  try {
    const raw = key ? JSON.parse(globalThis.localStorage?.getItem(key) || "{}") : {};
    return {
      collapsed: raw.collapsed !== false,
      step: GUIDE_STEPS.some(item => item.id === raw.step) ? raw.step : "hello",
      visited: Array.isArray(raw.visited) ? raw.visited.filter(id => GUIDE_STEPS.some(item => item.id === id)) : [],
    };
  } catch { return { collapsed: true, step: "hello", visited: [] }; }
}

export function saveGuidePreferences(key, value) {
  try { if (key) globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can keep progress in memory. */ }
}

export const ACHIEVEMENT_ACTIONS = {
  first_chat: { label: "去聊一句", view: "chat" },
  onboarding_1: { label: "看看入门路线", view: "guide" },
  chat_10: { label: "继续聊几句", view: "chat" },
  chat_50: { label: "去聊日常", view: "chat" },
  chat_100: { label: "续写百轮对话", view: "chat" },
  streak_3: { label: "今天打个招呼", view: "chat" },
  streak_7: { label: "续写七日陪伴", view: "chat" },
  early_bird: { label: "清晨来道早安", view: "chat" },
  night_owl: { label: "深夜聊聊心事", view: "chat" },
  moment_1: { label: "去写动态", view: "moments" },
  moment_5: { label: "记一条新动态", view: "moments" },
  music_1: { label: "去保存音乐分析", view: "music" },
  music_10: { label: "去听歌收藏", view: "music" },
  watch_1: { label: "去一起看", view: "together" },
  art_1: { label: "去涂鸦画室", view: "art" },
  takeout_1: { label: "去挑顿外卖", view: "takeout" },
  date_1: { label: "去记纪念日", view: "discover" },
  shot_1: { label: "去拍一张日常", view: "moments" },
  compat_1: { label: "去测默契度", view: "duel" },
  diy_1: { label: "写下专属目标", view: "custom-form" },
  explorer_1: { label: "去逛逛玩法", view: "discover" },
  explorer_10: { label: "继续探索灯塔", view: "discover" },
};

export function freshAchievements(previous, items) {
  if (!previous) return [];
  const known = new Set(previous);
  return items.filter(item => item.unlocked && !known.has(item.code || item.id));
}
