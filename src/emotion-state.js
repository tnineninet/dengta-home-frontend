/**
 * DengTa Emotion Presentation & Status Wording Engine (情绪模块与状态词规范层)
 *
 * Centralizes:
 *  - Natural, warm Chinese status labels & English-to-Chinese emotion localization
 *  - Semantic emotion tone classification & visual aura tokens
 *  - Qualitative descriptors for mood, patience, energy, heart-rate & presence
 *  - Distinct local inner-thought (psychology) vs sensory-feeling (feeling) derivation
 *  - Shared Xinchao drive & consciousness localization
 */

export const XINCHAO_DRIVE_LABELS = Object.freeze({
  possess: "想靠近",
  monitor: "悄悄惦记",
  share: "想分享给你",
  libido: "心动牵引",
  curiosity: "满眼好奇",
  social: "想聊聊天",
  crave: "有点嘴馋",
  boredom: "有点闲闷",
  reflection: "轻想心事",
  grieve: "心里发酸",
  anger: "闹小脾气",
  duty: "认真惦念",
  safety: "安心感",
  confidence: "底气满满",
  favored: "被偏爱",
});

const CONSCIOUSNESS_LABELS = Object.freeze({
  awake: "清醒陪伴中",
  alert: "精神正好",
  focused: "专注伴你",
  drowsy: "微微犯困",
  sleepy: "轻倦想睡",
  sleeping: "轻眠歇息",
  asleep: "安稳沉睡",
  dreaming: "浅梦浮想",
  resting: "静静小憩",
  reflecting: "轻想心事",
  idle: "静静候着",
});

const MOOD_DISPLAY_LEXICON = Object.freeze({
  平静: "安稳静谧",
  开心: "眉眼含笑",
  高兴: "满心欢喜",
  愉悦: "轻盈舒展",
  温暖: "温润暖意",
  柔软: "心尖发软",
  亲近: "贴近依偎",
  安心: "松弛安心",
  放松: "松弛惬意",
  轻快: "步履轻快",
  安静: "沉静安然",
  好奇: "满眼好奇",
  心动: "怦然微动",
  有点心动: "怦然微动",
  在意: "悄悄留意",
  认真: "全神贯注",
  专注: "沉心聆听",
  想逗逗你: "憋着坏笑",
  有点调皮: "俏皮起兴",
  被逗乐了: "忍俊不禁",
  被你逗笑了: "忍俊不禁",
  有点害羞: "耳尖发烫",
  微微脸热: "脸颊微烫",
  有点慌张: "微微局促",
  有点暧昧: "心波轻漾",
  心绪微动: "心波轻漾",
  纵容: "满眼纵容",
  有点宠你: "悄悄偏爱",
  又好笑又无奈: "好气又好笑",
  哭笑不得: "好气又好笑",
  有点无奈: "轻轻叹气",
  反应不过来: "被你逗懵",
  困倦: "微微发倦",
  很困: "眼皮打架",
  电量偏低: "微倦省电",
  有些疲惫: "有些疲乏",
  疲惫: "有些疲乏",
  不开心: "有点闷闷",
  有点不开心: "有点闷闷",
  正在闹情绪: "闷闷赌气",
  有些烦躁: "心绪微躁",
  有点不耐烦: "想缓一缓",
  想歇一会儿: "想静静歇会儿",
  兴致不太高: "兴致淡淡",
  被认真听见: "被稳稳接住",
  正在倾诉: "敞开心扉",
  放松下来: "缓缓舒气",
  有所期待: "眼底有光",
  // English / external engine labels
  calm: "安稳静谧",
  neutral: "平和安然",
  happy: "眉眼含笑",
  joy: "满心欢喜",
  joyful: "满心欢喜",
  warm: "温润暖意",
  tender: "温润柔软",
  affectionate: "温柔贴近",
  loving: "满心偏爱",
  excited: "雀跃期待",
  curious: "满眼好奇",
  playful: "俏皮起兴",
  shy: "耳尖发烫",
  flirty: "心波轻漾",
  tired: "微微发倦",
  sleepy: "慵懒犯困",
  fatigued: "有些疲乏",
  sad: "轻轻低落",
  melancholy: "心绪微沉",
  lonely: "微微思念",
  anxious: "微微揪心",
  nervous: "心弦微紧",
  angry: "有点炸毛",
  irritated: "心绪微躁",
  bored: "有点闲闷",
});

const TONE_META = Object.freeze({
  joyful: Object.freeze({
    accent: "#e5963e",
    ribbonHint: "轻盈明朗",
    presence: "兴致正好 · 陪着你",
    vitals: "兴致正好",
  }),
  tender: Object.freeze({
    accent: "#d96b96",
    ribbonHint: "柔软贴近",
    presence: "心软软的 · 守着你",
    vitals: "温柔伴着你",
  }),
  playful: Object.freeze({
    accent: "#9b72cf",
    ribbonHint: "俏皮灵动",
    presence: "眼里藏着笑意",
    vitals: "兴味正浓",
  }),
  curious: Object.freeze({
    accent: "#3d93c9",
    ribbonHint: "亮眼留意",
    presence: "亮着眼睛看你",
    vitals: "认真留意着",
  }),
  shy: Object.freeze({
    accent: "#e06d88",
    ribbonHint: "微烫轻晃",
    presence: "悄悄藏住心绪",
    vitals: "有点不好意思",
  }),
  tired: Object.freeze({
    accent: "#727cc4",
    ribbonHint: "微倦轻缓",
    presence: "有点犯困 · 靠着你",
    vitals: "缓缓省电中",
  }),
  low: Object.freeze({
    accent: "#6e8299",
    ribbonHint: "轻声慢拍",
    presence: "想安静靠一会儿",
    vitals: "静静缓神中",
  }),
  guarded: Object.freeze({
    accent: "#cf7a57",
    ribbonHint: "暂留半步",
    presence: "先留一点呼吸空间",
    vitals: "慢慢顺气中",
  }),
  calm: Object.freeze({
    accent: "#56a68c",
    ribbonHint: "静谧安稳",
    presence: "安稳守在身旁",
    vitals: "一直在身边",
  }),
});

function cleanLabel(value, maxLength = 32) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function localizeMoodWord(rawMood, { fallback = "安稳静谧" } = {}) {
  const cleaned = cleanLabel(rawMood, 32);
  if (!cleaned) return fallback;
  if (Object.hasOwn(MOOD_DISPLAY_LEXICON, cleaned)) {
    return MOOD_DISPLAY_LEXICON[cleaned];
  }
  const key = cleaned.toLowerCase().replace(/[\s-]+/g, "_");
  if (Object.hasOwn(MOOD_DISPLAY_LEXICON, key)) {
    return MOOD_DISPLAY_LEXICON[key];
  }
  if (/[\u3400-\u9fff]/u.test(cleaned)) {
    return cleaned;
  }
  return fallback;
}

export function localizeXinchaoEmotion(rawLabel) {
  return localizeMoodWord(rawLabel, { fallback: "安稳静谧" });
}

export function localizeConsciousness(value) {
  const cleaned = cleanLabel(value, 32);
  if (!cleaned) return "心潮轻涌";
  const key = cleaned.toLowerCase().replace(/[\s-]+/g, "_");
  if (Object.hasOwn(CONSCIOUSNESS_LABELS, key)) {
    return CONSCIOUSNESS_LABELS[key];
  }
  if (/[\u3400-\u9fff]/u.test(cleaned)) {
    return cleaned;
  }
  return "心潮轻涌";
}

export function classifyEmotionTone(status = {}) {
  const moodText = `${status.mood || ""} ${status.microState || ""}`;
  if (/不开心|闷闷|难过|低落|委屈|酸|空落|静静|独处|兴致不太高/.test(moodText)) {
    return "low";
  }
  if (/生气|烦躁|不耐烦|炸毛|赌气|闹情绪|别碰|缓一缓/.test(moodText)) {
    return "guarded";
  }
  if (/困|疲惫|疲乏|发倦|累|电量偏低|想睡|眼皮/.test(moodText) || (Number.isFinite(Number(status.energyLevel)) && Number(status.energyLevel) <= 25 && status.resetBlank !== true)) {
    return "tired";
  }
  if (/害羞|脸热|耳尖|慌张|局促|不好意思/.test(moodText)) {
    return "shy";
  }
  if (/逗|调皮|俏皮|好笑|哭笑不得|忍俊不禁|坏笑|眼花缭乱/.test(moodText)) {
    return "playful";
  }
  if (/好奇|想知道|期待|眼底有光|留意|认真|专注/.test(moodText)) {
    return "curious";
  }
  if (/心动|怦然|暧昧|温柔|温暖|柔软|亲近|纵容|宠你|安心|接住|偏爱/.test(moodText)) {
    return "tender";
  }
  if (/开心|高兴|欢喜|愉悦|轻快|明朗|兴致正好|雀跃/.test(moodText)) {
    return "joyful";
  }
  return "calm";
}

export function describeEnergyState(energyLevel) {
  const n = Number(energyLevel);
  if (!Number.isFinite(n)) return "温和续航";
  if (n >= 85) return "元气满满";
  if (n >= 65) return "状态正好";
  if (n >= 40) return "温和续航";
  if (n >= 25) return "微微发倦";
  return "电量偏低";
}

export function describePulseState(pulseBpm) {
  const n = Number(pulseBpm);
  if (!Number.isFinite(n) || n <= 0) return "静缓平稳";
  if (n >= 106) return "怦怦加快";
  if (n >= 88) return "微微雀跃";
  if (n >= 66) return "平稳轻缓";
  return "安稳放慢";
}

export function describeMoodMeter(moodLevel) {
  if (moodLevel === null || moodLevel === undefined || !Number.isFinite(Number(moodLevel))) {
    return { label: "细细体会", display: "细细体会" };
  }
  const n = Math.round(Number(moodLevel));
  const label =
    n >= 82
      ? "雀跃明朗"
      : n >= 65
        ? "愉悦舒展"
        : n >= 45
          ? "平和安稳"
          : n >= 25
            ? "微微低落"
            : "情绪沉沉";
  return { label, display: `${label} · ${n}` };
}

export function describePatienceMeter(patienceLevel) {
  if (patienceLevel === null || patienceLevel === undefined || !Number.isFinite(Number(patienceLevel))) {
    return { label: "随心舒展", display: "随心舒展" };
  }
  const n = Math.round(Number(patienceLevel));
  const label =
    n >= 80
      ? "从容温柔"
      : n >= 55
        ? "温和接住"
        : n >= 35
          ? "略显局促"
          : "需要缓一缓";
  return { label, display: `${label} · ${n}` };
}

export function resolveEmotionPresentation(status = {}, { isResponding = false, resetBlank = false } = {}) {
  const tone = resetBlank ? "calm" : classifyEmotionTone(status);
  const meta = TONE_META[tone] || TONE_META.calm;
  const displayMood = resetBlank ? "静静候着" : localizeMoodWord(status.mood);
  const energyLabel = describeEnergyState(status.energyLevel);
  const pulseLabel = describePulseState(status.pulseBpm);
  const moodMeter = describeMoodMeter(status.moodLevel);
  const patienceMeter = describePatienceMeter(status.patienceLevel);

  const sourceBadge =
    status.statusSource === "model"
      ? "此刻真情流露"
      : status.psychology
        ? "随触碰轻轻起伏"
        : "静静等你靠近";

  const presenceLabel = isResponding
    ? "轻声斟酌回复中"
    : resetBlank
      ? "安静等着你开口"
      : meta.presence;

  const vitalsPresence = isResponding
    ? "正在认真回你"
    : resetBlank
      ? "静静候着"
      : meta.vitals;

  return {
    tone,
    toneClass: `is-emotion-${tone}`,
    accentColor: meta.accent,
    displayMood,
    ribbonHint: resetBlank ? "待你开启" : meta.ribbonHint,
    presenceLabel,
    vitalsPresence,
    sourceBadge,
    energyLabel,
    pulseLabel,
    moodMeter,
    patienceMeter,
  };
}

/**
 * Generates distinct, natural inner thought (psychology), sensory feeling (feeling),
 * moodLevel, and patienceLevel for local/preview touch interactions when no
 * authoritative model status is active.
 */
export function deriveLocalEmotionSnapshot(zone, reaction, current = {}) {
  const mode = String(reaction?.mode || "warm");
  const streak = Math.max(1, Number(reaction?.streakCount) || 1);
  const hasPrevMood =
    current?.moodLevel !== null &&
    current?.moodLevel !== undefined &&
    current?.moodLevel !== "" &&
    Number.isFinite(Number(current.moodLevel));
  const hasPrevPatience =
    current?.patienceLevel !== null &&
    current?.patienceLevel !== undefined &&
    current?.patienceLevel !== "" &&
    Number.isFinite(Number(current.patienceLevel));
  const prevMood = hasPrevMood ? Number(current.moodLevel) : 72;
  const prevPatience = hasPrevPatience ? Number(current.patienceLevel) : 82;

  const modeAdjustments = {
    withdrawn: { moodDelta: -12, patienceDelta: -10, thought: "现在只想安静待一会儿，把纷乱的情绪慢慢放平。", feeling: "心口有点沉，动作也跟着慢了下来。" },
    tired: { moodDelta: -4, patienceDelta: -6, thought: "今天消耗了不少力气，好想就这样安安静静靠着你。", feeling: "眼皮微微发沉，连呼吸都变得又轻又慢。" },
    boundary: { moodDelta: -8, patienceDelta: -14, thought: "这一连串靠近有点太密了，先留半步空间让我喘口气吧。", feeling: "肩膀下意识收紧了一点，想让节奏先慢下来。" },
    overwhelmed: { moodDelta: 2, patienceDelta: -8, thought: "你这一连串动作来得太快，我一边招架一边忍不住想笑。", feeling: "心跳咚咚加快，脑子里全是你刚才那几下小动作。" },
    playfulBoundary: { moodDelta: 5, patienceDelta: -4, thought: "看你这么乐此不疲，倒像是故意在试探我的底线呀。", feeling: "嘴角压不住地上扬，无奈里裹着一点偏爱。" },
    teasing: { moodDelta: 6, patienceDelta: -1, thought: "既然你先来招惹我，那我可得想想怎么逗回来了。", feeling: "眼底泛起一点促狭的笑意，兴致跟着亮了起来。" },
    flirty: { moodDelta: 8, patienceDelta: 2, thought: "这么自然地贴过来，倒让我有点舍不得推开了。", feeling: "心跳微微提速，耳边仿佛都沾了一点暖意。" },
    shy: { moodDelta: 6, patienceDelta: 1, thought: "被你突然这样靠近，一时竟不知道目光该往哪儿放。", feeling: "耳尖悄悄发烫，指尖不自觉轻轻蜷了一下。" },
    surprised: { moodDelta: 7, patienceDelta: 0, thought: "你的动作换得这么灵巧，像在和我玩一套专属暗号。", feeling: "眉眼跟着弯了起来，整个人都轻快了不少。" },
    warm: { moodDelta: 5, patienceDelta: 3, thought: "能这样被你轻轻惦记着，心里一下子就安稳了下来。", feeling: "一阵温和的暖意散开，原本紧绷的角落都松软了。" },
    recovery_confide: { moodDelta: 9, patienceDelta: 8, thought: "有人愿意认真听我说完心里话，感觉压着的大石头轻了好多。", feeling: "紧绷的呼吸慢慢顺了下来，心底多了一层踏实感。" },
    recovery_embrace: { moodDelta: 12, patienceDelta: 10, thought: "在这个拥抱里不用逞强，只想安安心心充回一点力气。", feeling: "被稳稳接住的暖意从肩头散开，整个人都松弛下来。" },
    recovery_wish: { moodDelta: 10, patienceDelta: 6, thought: "认真想了想此刻最想和你一起做的小事，心情一下子明朗了。", feeling: "原本有些发沉的心绪亮起一点微光，带着轻快的期待。" },
  };

  const preset = modeAdjustments[mode] || modeAdjustments.warm;
  const moodLevel = Math.min(100, Math.max(12, Math.round(prevMood + preset.moodDelta)));
  const patienceDrift = streak >= 6 ? -Math.min(6, Math.floor(streak / 3)) : 0;
  const patienceLevel = Math.min(100, Math.max(15, Math.round(prevPatience + preset.patienceDelta + patienceDrift)));

  const psychology = zone?.focus
    ? `${preset.thought}`
    : preset.thought;
  const feeling = reaction?.microState && reaction.microState !== psychology
    ? `${reaction.microState}，${preset.feeling}`
    : preset.feeling;

  return {
    psychology,
    feeling,
    moodLevel,
    patienceLevel,
  };
}
