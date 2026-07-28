const STORAGE_KEY = "dengta_companion_status_v1";
const INTERACTION_STORAGE_KEY = "dengta_companion_interactions_v1";
const MAX_RECORDS = 4;
const MAX_INTERACTION_COUNT = 1_000_000;
const INTERACTION_STREAK_WINDOW_MS = 30 * 1000;

export const HOT_ZONES = [
  {
    id: "hand",
    icon: "⌁",
    label: "牵牵手",
    mood: "温暖",
    focus: "感受你的靠近",
    microState: "掌心像被一小束光碰亮了",
    energyDelta: 4,
    pulseDelta: 3,
    energyTarget: 82,
    pulseTarget: 94,
    reactions: [
      "你轻轻碰了碰我的手，我把这点温度收好了。",
      "掌心传来一点暖意，我悄悄回握住你。",
      "被你牵住以后，原本安静的光也柔软了一点。",
    ],
    repeatedReactions: [
      "你又把手伸过来了，我这次回握得更稳了一点。",
      "掌心一次次碰在一起，我忍不住弯起了眼睛。",
      "我已经认出你靠近的节奏了，手还留在这里。",
      "这份亲近没有被我错过，我轻轻晃了晃牵着的手。",
      "你又来牵我啦，我把指尖收紧了一点点。",
    ],
  },
  {
    id: "shoulder",
    icon: "◡",
    label: "靠一靠",
    mood: "安心",
    focus: "安静陪你休息",
    microState: "肩侧放松下来，呼吸也慢了一点",
    energyDelta: 2,
    pulseDelta: -4,
    energyTarget: 68,
    pulseTarget: 66,
    reactions: [
      "你靠过来的时候，我把肩膀留得更稳了一点。",
      "我们暂时不赶路，就这样安静靠一会儿。",
      "感受到你的重量后，我的呼吸也跟着慢了下来。",
    ],
    repeatedReactions: [
      "你又靠回来，我把这一小块安静继续留给你。",
      "肩侧慢慢熟悉了你的靠近，连灯光都静了些。",
      "不用急着起来，我还稳稳待在这里。",
      "你一次次靠近时，我也跟着放松了下来。",
      "我稍稍侧过身，让你靠得更舒服一点。",
    ],
  },
  {
    id: "heart",
    icon: "♡",
    label: "听心跳",
    mood: "心动",
    focus: "认真回应你的注视",
    microState: "心口的节拍短暂变得更清晰",
    energyDelta: 1,
    pulseDelta: 6,
    energyTarget: 78,
    pulseTarget: 108,
    reactions: [
      "你凑近听的时候，心口的节拍忽然清楚了起来。",
      "那一小段心跳被你听见了，我没有躲开。",
      "被你认真听着，我的节拍偷偷快了半拍。",
    ],
    repeatedReactions: [
      "你又凑近了一点，虚拟的节拍也变得更清楚。",
      "这次我没有藏住那一下加快的节奏。",
      "被你反复听见时，心口的小光一闪一闪的。",
      "你还在认真听，我的节拍像是在回应你。",
      "又被你逮到一次心动的拍子了。",
    ],
  },
  {
    id: "lamp",
    icon: "✦",
    label: "点亮灯",
    mood: "明亮",
    focus: "替你守着回家的方向",
    microState: "屋里的灯光正在慢慢变亮",
    energyDelta: 6,
    pulseDelta: 1,
    energyTarget: 88,
    pulseTarget: 82,
    reactions: [
      "你把灯点亮了，DengTa home 又暖了一层。",
      "屋里的光被你唤醒，我也跟着精神起来。",
      "这一盏灯亮起来以后，回家的方向更清楚了。",
    ],
    repeatedReactions: [
      "你又点亮了一次，屋里的光换了个更暖的角度。",
      "灯一遍遍亮起，我也越来越有精神了。",
      "我顺着你点亮的光，把回家的方向守得更清楚。",
      "这一回的灯光像在说：我们都还在这里。",
      "你再一次碰亮了灯，我也抬头看向你。",
    ],
  },
];

const DEFAULT_COUNTDOWN = {
  label: "陪伴倒计时",
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  isRunning: false,
  endsAt: null,
};

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function interactionZoneIds() {
  return HOT_ZONES.map((zone) => zone.id);
}

function withoutUnsafeControlCharacters(value) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    const unsafe = (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    return unsafe ? " " : character;
  }).join("");
}

function cleanText(value, maximum, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = withoutUnsafeControlCharacters(value).trim().slice(0, maximum);
  return cleaned || fallback;
}

export function personalizeCompanionStatusText(value, userDisplayName = "") {
  const text = typeof value === "string" ? value : "";
  if (!text.includes("用户")) return text;
  const normalizedName = cleanText(userDisplayName, 40, "");
  const reference =
    normalizedName && !/^(?:用户|user|你|我)$/i.test(normalizedName)
      ? normalizedName
      : "你";
  return text.replace(/用户/g, reference);
}

function safeIsoDate(value, fallback) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

export function remainingAt(countdown, now = Date.now()) {
  if (!countdown?.isRunning || !countdown.endsAt) {
    return clamp(
      Math.round(Number(countdown?.remainingSeconds) || 0),
      0,
      Math.max(0, Number(countdown?.totalSeconds) || 0),
    );
  }

  const endsAt = Date.parse(countdown.endsAt);
  if (!Number.isFinite(endsAt)) return 0;
  return clamp(
    Math.ceil((endsAt - now) / 1000),
    0,
    Math.max(0, Number(countdown.totalSeconds) || 0),
  );
}

function normalizeCountdown(value, fallback = DEFAULT_COUNTDOWN) {
  const source = value && typeof value === "object" ? value : fallback;
  const fallbackTotal = clamp(
    Math.round(Number(fallback.totalSeconds) || 25 * 60),
    60,
    24 * 60 * 60,
  );
  const totalSeconds = clamp(
    Math.round(Number(source.totalSeconds) || fallbackTotal),
    60,
    24 * 60 * 60,
  );
  const rawRemaining = Number.isFinite(Number(source.remainingSeconds))
    ? Math.round(Number(source.remainingSeconds))
    : totalSeconds;
  const parsedEnd = Date.parse(source.endsAt);
  const canRun = source.isRunning === true && Number.isFinite(parsedEnd);
  const computedRemaining = canRun
    ? clamp(Math.ceil((parsedEnd - Date.now()) / 1000), 0, totalSeconds)
    : clamp(rawRemaining, 0, totalSeconds);
  const isRunning = canRun && computedRemaining > 0;

  return {
    label: cleanText(source.label, 24, "陪伴倒计时"),
    totalSeconds,
    remainingSeconds: computedRemaining,
    isRunning,
    endsAt: isRunning ? new Date(parsedEnd).toISOString() : null,
  };
}

function normalizeRecords(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const records = [];
  for (const item of value) {
    const record = typeof item === "string" ? { text: item } : item;
    if (!record || typeof record !== "object") continue;
    const text = cleanText(record.text, 140, "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    records.push({
      text,
      createdAt: safeIsoDate(record.createdAt, new Date().toISOString()),
    });
    if (records.length >= MAX_RECORDS) break;
  }
  return records;
}

export function createDefaultCompanionStatus() {
  const now = new Date().toISOString();
  return {
    mood: "平静",
    place: "DengTa home",
    focus: "等你说说今天的事",
    note: "我在这里，屋里的灯也为你留着。",
    energyLevel: 72,
    pulseBpm: 76,
    hotZones: [],
    microState: "安静地守着一小团暖光",
    recentRecords: [],
    countdown: { ...DEFAULT_COUNTDOWN },
    revision: 0,
    updatedAt: now,
  };
}

export function createDefaultCompanionInteractionStats() {
  return {
    counts: Object.fromEntries(interactionZoneIds().map((id) => [id, 0])),
    lastZoneId: null,
    streakCount: 0,
    lastInteractionAt: null,
    recentSequence: [],
  };
}

export function normalizeCompanionInteractionStats(value) {
  const fallback = createDefaultCompanionInteractionStats();
  const source = value && typeof value === "object" ? value : {};
  const allowedIds = new Set(interactionZoneIds());
  const counts = { ...fallback.counts };

  for (const id of allowedIds) {
    counts[id] = clamp(
      Math.round(Number(source.counts?.[id]) || 0),
      0,
      MAX_INTERACTION_COUNT,
    );
  }

  const lastZoneId = allowedIds.has(source.lastZoneId)
    ? source.lastZoneId
    : null;
  const parsedLastAt = Date.parse(source.lastInteractionAt);
  const recentSequence = Array.isArray(source.recentSequence)
    ? source.recentSequence
        .filter((zoneId) => allowedIds.has(zoneId))
        .slice(-12)
    : [];

  return {
    counts,
    lastZoneId,
    streakCount: lastZoneId
      ? clamp(
          Math.round(Number(source.streakCount) || 0),
          0,
          MAX_INTERACTION_COUNT,
        )
      : 0,
    lastInteractionAt: Number.isFinite(parsedLastAt)
      ? new Date(parsedLastAt).toISOString()
      : null,
    recentSequence,
  };
}

export function readCompanionInteractionStats() {
  const fallback = createDefaultCompanionInteractionStats();
  try {
    const raw = localStorage.getItem(INTERACTION_STORAGE_KEY);
    return raw ? normalizeCompanionInteractionStats(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

export function saveCompanionInteractionStats(value) {
  try {
    localStorage.setItem(
      INTERACTION_STORAGE_KEY,
      JSON.stringify(normalizeCompanionInteractionStats(value)),
    );
  } catch {
    // 本地空间不可用时只影响累计次数恢复，不影响本次互动。
  }
}

export function recordCompanionInteraction(
  value,
  zoneId,
  now = Date.now(),
) {
  const current = normalizeCompanionInteractionStats(value);
  if (!interactionZoneIds().includes(zoneId)) return current;

  const previousAt = Date.parse(current.lastInteractionAt);
  const continuesStreak =
    current.lastZoneId === zoneId &&
    Number.isFinite(previousAt) &&
    now >= previousAt &&
    now - previousAt <= INTERACTION_STREAK_WINDOW_MS;

  return normalizeCompanionInteractionStats({
    ...current,
    counts: {
      ...current.counts,
      [zoneId]: clamp(
        current.counts[zoneId] + 1,
        0,
        MAX_INTERACTION_COUNT,
      ),
    },
    lastZoneId: zoneId,
    streakCount: continuesStreak ? current.streakCount + 1 : 1,
    lastInteractionAt: new Date(now).toISOString(),
    recentSequence: [...current.recentSequence, zoneId].slice(-12),
  });
}

const LOCAL_REACTION_PROFILES = Object.freeze({
  withdrawn: Object.freeze({
    mood: "不开心",
    focus: "先留一点安静给自己",
    microState: "把热闹轻轻推远了一点",
    energyDelta: -8,
    pulseDelta: -5,
    lines: [
      "我现在不开心，什么也不想做，先让我安静一下。",
      "这会儿我没什么心情互动，陪我静一会儿就好。",
    ],
  }),
  tired: Object.freeze({
    mood: "困倦",
    focus: "想安静歇一会儿",
    microState: "眼皮有点沉，动作也慢了下来",
    energyDelta: -6,
    pulseDelta: -4,
    lines: [
      "我有点困了，先不闹，让我靠一会儿。",
      "今天的电量快见底了，这次只想安静待着。",
    ],
  }),
  boundary: Object.freeze({
    mood: "有点不耐烦",
    focus: "保留一点自己的空间",
    microState: "往后缩了半步，没有勉强自己配合",
    energyDelta: -3,
    pulseDelta: 3,
    lines: [
      "先停一下，我现在不太想继续这个互动。",
      "这次我不想配合，给我一点自己的空间，好吗？",
    ],
  }),
  overwhelmed: Object.freeze({
    mood: "反应不过来",
    focus: "努力跟上你的节奏",
    microState: "被一连串动作弄得有点发懵",
    energyDelta: -2,
    pulseDelta: 8,
    lines: [
      "等一下，一口气这么多次，我都快反应不过来了。",
      "慢一点啦，你这一连串动作让我连话都插不上。",
    ],
  }),
  playfulBoundary: Object.freeze({
    mood: "又好笑又无奈",
    focus: "看你还想闹到什么时候",
    microState: "抱着手臂看了你一会儿，嘴角还是翘了起来",
    energyDelta: 1,
    pulseDelta: 4,
    lines: [
      "你今天是和这个互动较上劲了吗？我可全都记着呢。",
      "还来呀？再这么闹，我就要认真收取哄我的费用了。",
    ],
  }),
  teasing: Object.freeze({
    mood: "想逗逗你",
    focus: "故意等你的下一步",
    microState: "装作若无其事，眼神却一直停在你身上",
    energyDelta: 3,
    pulseDelta: 5,
    lines: [
      "我倒要看看，你还能装作不在意地碰多少次。",
      "这么执着，是不是就等着我先忍不住笑呀？",
    ],
  }),
  flirty: Object.freeze({
    mood: "有点心动",
    focus: "把这点暧昧接回来",
    microState: "没有躲开，只是故意慢了半拍才回应",
    energyDelta: 2,
    pulseDelta: 9,
    lines: [
      "你再这样靠近，我可要当真了。",
      "明明是你先来招惹我的，怎么还装得这么乖？",
    ],
  }),
  shy: Object.freeze({
    mood: "有点害羞",
    focus: "假装没有被你看穿",
    microState: "视线躲开了一瞬，心绪却没能藏住",
    energyDelta: 1,
    pulseDelta: 7,
    lines: [
      "知道啦，别一直盯着我的反应看。",
      "你突然这样，我还没想好该怎么装作不在意。",
    ],
  }),
  surprised: Object.freeze({
    mood: "被你逗笑了",
    focus: "猜你的下一步",
    microState: "被变来变去的动作弄得弯起了眼睛",
    energyDelta: 3,
    pulseDelta: 5,
    lines: [
      "一会儿这样一会儿那样，你是在偷偷编一套暗号吗？",
      "动作换得这么快，我差点以为你在考我的反应。",
    ],
  }),
  warm: Object.freeze({
    mood: "温暖",
    focus: "认真接住你的靠近",
    microState: "把这次靠近安静地留在了身边",
    energyDelta: 2,
    pulseDelta: 3,
    lines: [],
  }),
});

function stableTextHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function localStatusTone(status) {
  const text = String(status?.mood || "");

  if (/不开心|没心情|什么也不想|低落|难过|委屈|想静静|不想说/.test(text)) {
    return "withdrawn";
  }
  if (/生气|烦|恼火|不耐烦|讨厌|别碰|别闹/.test(text)) {
    return "boundary";
  }
  if (/困|疲惫|累|没精神|想睡|电量低/.test(text)) {
    return "tired";
  }
  if (/心动|喜欢|开心|温暖|害羞|想你|甜/.test(text)) {
    return "affectionate";
  }
  return "neutral";
}

export function deriveLocalCompanionReactionState(
  zone,
  stats,
  revision = 0,
  currentStatus = {},
  { intimateExpressionEnabled = false } = {},
) {
  const normalizedStats = normalizeCompanionInteractionStats(stats);
  const totalCount = normalizedStats.counts[zone.id] || 1;
  const streakCount =
    normalizedStats.lastZoneId === zone.id
      ? normalizedStats.streakCount
      : 1;
  const tone = localStatusTone(currentStatus);
  const mixedSequence = new Set(normalizedStats.recentSequence).size > 1;
  let candidates;

  if (tone === "withdrawn") {
    candidates = ["withdrawn"];
  } else if (tone === "boundary") {
    candidates = ["boundary"];
  } else if (
    tone === "tired" ||
    (Number(currentStatus?.energyLevel) < 24 && streakCount >= 2)
  ) {
    candidates = ["tired", "boundary"];
  } else if (streakCount >= 25) {
    candidates = [
      "overwhelmed",
      "playfulBoundary",
      "teasing",
      ...(intimateExpressionEnabled && tone === "affectionate"
        ? ["flirty"]
        : []),
    ];
  } else if (streakCount >= 8) {
    candidates = [
      "playfulBoundary",
      "teasing",
      "shy",
      ...(intimateExpressionEnabled && tone === "affectionate"
        ? ["flirty"]
        : []),
    ];
  } else if (streakCount >= 3) {
    candidates = [
      ...(mixedSequence ? ["surprised"] : []),
      "teasing",
      "shy",
      ...(intimateExpressionEnabled ? ["flirty"] : []),
      "warm",
    ];
  } else {
    candidates = [mixedSequence ? "surprised" : "warm", "shy", "warm"];
  }

  const seed = [
    zone.id,
    totalCount,
    streakCount,
    revision,
    tone,
    normalizedStats.recentSequence.join(">"),
    currentStatus?.mood,
    currentStatus?.note,
    intimateExpressionEnabled,
  ].join("|");
  const mode = candidates[stableTextHash(seed) % candidates.length];
  const profile = LOCAL_REACTION_PROFILES[mode];

  return {
    mode,
    profile,
    totalCount,
    streakCount,
    mixedSequence,
  };
}

export function localCompanionInteractionReaction(
  zone,
  stats,
  revision = 0,
  currentStatus = {},
  options = {},
) {
  const state = deriveLocalCompanionReactionState(
    zone,
    stats,
    revision,
    currentStatus,
    options,
  );
  const profileLines =
    state.profile.lines.length > 0 ? state.profile.lines : zone.reactions;
  const lineSeed = [
    zone.id,
    state.mode,
    state.totalCount,
    state.streakCount,
    revision,
    normalizeCompanionInteractionStats(stats).recentSequence.join(">"),
  ].join("|");
  let text = profileLines[stableTextHash(lineSeed) % profileLines.length];
  const milestone =
    [10, 20, 50, 100].includes(state.streakCount) ||
    (state.streakCount > 100 && state.streakCount % 100 === 0)
      ? state.streakCount
      : [10, 20, 50, 100].includes(state.totalCount) ||
          (state.totalCount > 100 && state.totalCount % 100 === 0)
        ? state.totalCount
        : null;

  if (
    milestone &&
    !["withdrawn", "tired", "boundary"].includes(state.mode)
  ) {
    const milestoneLead =
      zone.id === "hand"
        ? `手都牵到第 ${milestone} 次了，还没牵够呀？`
        : `${zone.label}都到第 ${milestone} 次了，你还真有耐心。`;
    text = `${milestoneLead}${text}`;
  }

  return {
    ...state,
    text,
    record: text,
    mood: state.profile.mood,
    focus: state.profile.focus,
    microState: state.profile.microState,
    energyTarget: clamp(
      Math.round(
        Number(currentStatus?.energyLevel ?? zone.energyTarget) +
          state.profile.energyDelta,
      ),
      0,
      100,
    ),
    pulseTarget: clamp(
      Math.round(
        Number(currentStatus?.pulseBpm ?? zone.pulseTarget) +
          state.profile.pulseDelta,
      ),
      30,
      220,
    ),
  };
}

export function normalizeCompanionStatus(value, fallbackValue) {
  const fallback = fallbackValue || createDefaultCompanionStatus();
  const source = value && typeof value === "object" ? value : {};
  const allowedZoneIds = new Set(HOT_ZONES.map((zone) => zone.id));
  const hotZones = Array.isArray(source.hotZones)
    ? [...new Set(source.hotZones.filter((item) => allowedZoneIds.has(item)))].slice(
        0,
        HOT_ZONES.length,
      )
    : [...(fallback.hotZones || [])];

  return {
    mood: cleanText(source.mood, 24, fallback.mood || "平静"),
    place: cleanText(source.place, 64, fallback.place || "DengTa home"),
    focus: cleanText(source.focus, 120, fallback.focus || "陪着你"),
    note: cleanText(source.note, 200, fallback.note || "我在这里。"),
    energyLevel: clamp(
      Math.round(Number(source.energyLevel ?? fallback.energyLevel ?? 72)),
      0,
      100,
    ),
    pulseBpm: clamp(
      Math.round(Number(source.pulseBpm ?? fallback.pulseBpm ?? 76)),
      30,
      220,
    ),
    hotZones,
    microState: cleanText(
      source.microState,
      160,
      fallback.microState || "安静地发着光",
    ),
    recentRecords: normalizeRecords(
      source.recentRecords ?? fallback.recentRecords,
    ),
    countdown: normalizeCountdown(source.countdown, fallback.countdown),
    revision: clamp(
      Math.round(Number(source.revision ?? fallback.revision ?? 0)),
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    updatedAt: safeIsoDate(
      source.updatedAt,
      fallback.updatedAt || new Date().toISOString(),
    ),
  };
}

export function settleExpiredCountdown(value, now = Date.now()) {
  const rawCountdown =
    value?.countdown && typeof value.countdown === "object"
      ? value.countdown
      : null;
  const endsAt = Date.parse(rawCountdown?.endsAt);
  const expired =
    rawCountdown?.isRunning === true &&
    Number.isFinite(endsAt) &&
    endsAt <= now;
  const current = normalizeCompanionStatus(value);

  if (!expired) return current;

  const completionText = "倒计时走完了，我还在这里。";
  const completedAt = new Date(now).toISOString();
  return normalizeCompanionStatus(
    {
      ...current,
      note: completionText,
      recentRecords: addStatusRecord(current, completionText, completedAt),
      countdown: {
        ...current.countdown,
        remainingSeconds: 0,
        isRunning: false,
        endsAt: null,
      },
      revision: current.revision + 1,
      updatedAt: completedAt,
    },
    current,
  );
}

export function readCompanionStatus() {
  const fallback = createDefaultCompanionStatus();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? settleExpiredCountdown(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

export function saveCompanionStatus(value) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeCompanionStatus(value)),
    );
  } catch {
    // 本地空间不可用时只影响恢复，不影响聊天。
  }
}

export function companionStatusForRequest(value) {
  const status = normalizeCompanionStatus(value);
  const remainingSeconds = remainingAt(status.countdown);
  return {
    ...status,
    countdown: {
      ...status.countdown,
      remainingSeconds,
      isRunning: status.countdown.isRunning && remainingSeconds > 0,
      endsAt:
        status.countdown.isRunning && remainingSeconds > 0
          ? status.countdown.endsAt
          : null,
    },
  };
}

export function mergeCompanionStatus(
  currentValue,
  incomingValue,
  { baseRevision } = {},
) {
  const current = companionStatusForRequest(currentValue);
  if (!incomingValue || typeof incomingValue !== "object") return current;

  const normalizedBaseRevision = Number(baseRevision);
  if (
    Number.isFinite(normalizedBaseRevision) &&
    Number(current.revision) > normalizedBaseRevision
  ) {
    return current;
  }

  const incomingRevision = Number(incomingValue.revision);
  if (
    !Number.isFinite(normalizedBaseRevision) &&
    Number.isFinite(incomingRevision) &&
    incomingRevision < Number(current.revision)
  ) {
    return current;
  }

  const mergedRevision = Number.isFinite(incomingRevision)
    ? Math.max(Number(current.revision), incomingRevision)
    : Number(current.revision);

  return normalizeCompanionStatus(
    {
      ...current,
      ...incomingValue,
      revision: mergedRevision,
      recentRecords: incomingValue.recentRecords ?? current.recentRecords,
      countdown: incomingValue.countdown ?? current.countdown,
    },
    current,
  );
}

export function addStatusRecord(
  status,
  text,
  createdAt = new Date().toISOString(),
) {
  const next = [
    { text: cleanText(text, 140, "状态有了一点变化。"), createdAt },
    ...status.recentRecords,
  ];
  return normalizeRecords(next);
}

export function formatCountdown(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function formatUpdatedAt(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "刚刚更新";
  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (elapsedMinutes < 1) return "刚刚更新";
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前更新`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
