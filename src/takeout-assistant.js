const ACTIONS = new Set(["search", "menu", "order"]);
const safeText = (value, limit = 1000) => Array.from(String(value ?? "").trim()).slice(0, limit).join("");

export const TAKEOUT_STEPS = [
  { id: "search", label: "搜店" },
  { id: "menu", label: "看菜单" },
  { id: "order", label: "选餐核对" },
  { id: "payment", label: "你来付款" }
];

export const TAKEOUT_PLATFORMS_META = [
  {
    id: "eleme",
    label: "饿了么",
    badge: "默认",
    homeUrl: "https://h5.ele.me/msite/",
    cartUrl: "https://h5.ele.me/msite/cart",
    searchUrl: (q) => `https://h5.ele.me/msite/search/?keyword=${encodeURIComponent(q || "")}`,
  },
  {
    id: "meituan",
    label: "美团外卖",
    badge: "热门",
    homeUrl: "https://i.meituan.com/",
    cartUrl: "https://i.meituan.com/",
    searchUrl: (q) => `https://i.meituan.com/s/-${encodeURIComponent(q || "")}`,
  },
  {
    id: "jd",
    label: "京东到家",
    badge: "超市/药急送",
    homeUrl: "https://daojia.jd.com/",
    cartUrl: "https://daojia.jd.com/",
    searchUrl: (q) => `https://daojia.jd.com/html/index.html#searchResult/key:${encodeURIComponent(q || "")}`,
  },
];

export const TAKEOUT_BUDGET_PRESETS = [20, 35, 50, 80];

export const TAKEOUT_DIET_TAGS = [
  "不要香菜",
  "免辣/微辣",
  "少油少盐",
  "少冰/去冰",
  "不要葱蒜",
  "多加汤",
  "优先配送快",
  "需要1份餐具",
];

export const TAKEOUT_PRESET_IDEAS = [
  { id: "warm", text: "热乎的一人食", query: "想吃一份热乎的一人食", budget: "35", tag: "暖胃" },
  { id: "light", text: "清淡养胃", query: "想吃清淡的饭菜，粥或蒸菜都可以", budget: "35", tag: "温和" },
  { id: "drink", text: "喝点好喝的", query: "帮我挑一杯好喝的奶茶或咖啡", budget: "22", tag: "饮品" },
  { id: "fit", text: "轻食减脂", query: "想吃低卡轻食沙拉或鸡胸肉套餐", budget: "42", tag: "轻食" },
  { id: "night", text: "夜宵解馋", query: "想吃点夜宵烧烤或麻辣烫", budget: "45", tag: "夜宵" },
  { id: "care", text: "感冒应急/热饮", query: "有点感冒不舒服，想点暖胃热粥或药店电解质水", budget: "45", tag: "关怀" },
];

export function buildTakeoutPlatformUrl(platformId = "eleme", mode = "cart", query = "") {
  const found = TAKEOUT_PLATFORMS_META.find((item) => item.id === platformId) || TAKEOUT_PLATFORMS_META[0];
  if (mode === "search" && String(query || "").trim()) return found.searchUrl(String(query).trim());
  if (mode === "home") return found.homeUrl;
  return found.cartUrl;
}

export function toggleTakeoutDietTag(currentNote = "", tag = "") {
  const cleanTag = safeText(tag, 40);
  if (!cleanTag) return safeText(currentNote, 300);
  const parts = String(currentNote || "")
    .split(/[，,；;、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const index = parts.indexOf(cleanTag);
  if (index >= 0) parts.splice(index, 1);
  else parts.push(cleanTag);
  return safeText(parts.join("，"), 300);
}

export function buildTakeoutRequest({ query = "", budget = "", people = 1, note = "", platform = "" } = {}) {
  const requirement = safeText(query, 800);
  if (!requirement) return { ok: false, message: "先告诉我今天想吃什么，也可以选择一个灵感。" };
  const amount = budget === "" ? null : Number(budget);
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || amount > 100000)) {
    return { ok: false, message: "请填写大于 0 的总预算，或者留空让我先比较。" };
  }
  const portions = Math.min(20, Math.max(1, Math.round(Number(people) || 1)));
  const preference = safeText(note, 300);
  const platformEntry = TAKEOUT_PLATFORMS_META.find((item) => item.id === platform);
  return {
    ok: true,
    text: [
      `帮我挑选并准备外卖：${requirement}。${portions} 人用餐。`,
      amount === null ? "请先比较实际价格。" : `含配送及包装的总预算不超过 ${amount} 元。`,
      platformEntry ? `优先平台：${platformEntry.label}。` : "",
      preference ? `我的要求：${preference}。` : "",
      "先搜索真实店铺，再读取选中店铺的真实菜单，按我的要求选择合适的准确商品并加购。核对数量、规格、配送费和实际总额，停在付款前等我核对并付款。遇到登录、验证码、规格或金额无法确认时交给我处理，不重复加购。"
    ].filter(Boolean).join(""),
    query: requirement, budget: amount, people: portions, note: preference,
    ...(platformEntry ? { platform: platformEntry.id } : {}),
  };
}

export function updateTakeoutTask(previous, { scope, type, command, outcome, message } = {}) {
  if (!scope || !command?.id || !ACTIONS.has(command?.command?.action)) return previous;
  const action = command.command.action;
  const current = previous?.scope === scope ? previous : { scope, completed: [], status: "working" };
  if (type === "progress" && current.commandId !== command.id) return previous;
  const now = Date.now();
  const next = {
    ...current,
    scope,
    commandId: command.id,
    action,
    updatedAt: now,
    startedAt: current.startedAt || now,
    requirement: safeText(command.command.requirement),
    shop: safeText(command.command.shop_name, 120) || current.shop || "",
  };
  if (current.pausedByUser) return { ...next, status: "manual_review", executing: false, message: "自动操作已暂停，请在平台页面核对购物车。" };
  if (type === "start") return { ...next, status: "working", executing: true, message: { search: "正在寻找合适的店铺", menu: "正在查看这家店的真实菜单", order: "正在选餐加购，核对实际金额" }[action], code: "" };
  if (type === "progress") return { ...next, message: safeText(message, 200) || current.message };
  if (type !== "done" || !outcome) return previous;
  const synced = outcome.receipt_synced === true;
  const successful = outcome.ok === true && synced;
  const paymentReady = successful && outcome.status === "ready_for_payment" &&
    Number.isFinite(outcome.total) && outcome.total > 0 && outcome.paymentSubmitted === false &&
    (current.budget === null || current.budget === undefined || Number.isFinite(current.budget) && outcome.total <= current.budget) &&
    Array.isArray(outcome.lines) && outcome.lines.length > 0 &&
    outcome.lines.every(line => typeof line.name === "string" && line.name.trim() && Number.isInteger(line.quantity) && line.quantity > 0);
  if (!successful && outcome.retryable === true && synced) {
    return { ...next, executing: false, status: "working",
      message: safeText(outcome.message, 240) || "这家没有合适的，正在换一家继续看。",
      code: /^[a-z][a-z0-9_]{0,79}$/.test(outcome.code || "") ? outcome.code : "",
      candidates: Array.isArray(outcome.candidates) ? outcome.candidates.slice(0, 10) : current.candidates };
  }
  const review = outcome.status === "manual_review" || (action === "order" && !paymentReady && successful) ||
    (!successful && outcome.receipt_synced === false);
  const completed = successful ? [...new Set([...current.completed, action])] : current.completed;
  return { ...next, completed, executing: false,
    status: paymentReady ? "awaiting_payment" : review ? "manual_review" : successful ? "working" : "error",
    message: paymentReady ? "已经准备好，请核对后亲自付款" : successful ?
      { search: "已找到店铺，AI 正在比较", menu: "菜单已读取，AI 正在为你选餐", order: "请在平台页面核对购物车后继续" }[action] :
      safeText(outcome.message, 240) || "操作还没有确认，请先检查平台页面。",
    code: /^[a-z][a-z0-9_]{0,79}$/.test(outcome.code || "") ? outcome.code : "",
    shops: action === "search" && successful && Array.isArray(outcome.shops) ? outcome.shops.slice(0, 20) : current.shops,
    products: action === "menu" && successful && Array.isArray(outcome.products) ? outcome.products.slice(0, 40) : current.products,
    product: action === "order" ? safeText(command.command.requirement, 150) : current.product,
    total: paymentReady ? outcome.total : null,
    lines: paymentReady ? outcome.lines : null
  };
}

export function takeoutTaskLabel(task) {
  if (task?.status === "awaiting_payment") return "等你核对付款";
  if (task?.status === "manual_review") return "需要你接手一下";
  if (task?.status === "error") return "点餐暂时停下了";
  return task?.message || "AI 正在帮你选餐";
}

export function takeoutPaymentReady(task) {
  return Boolean(task?.status === "awaiting_payment" && Number.isFinite(task?.total) && task.total > 0 &&
    Array.isArray(task?.lines) && task.lines.length > 0);
}

export function takeoutStepIndex(task) {
  if (!task) return -1;
  if (task.status === "awaiting_payment" || task.completed?.includes("payment")) return 3;
  return TAKEOUT_STEPS.findIndex(step => step.id === task.action);
}

export function takeoutMenuChoices(task) {
  if (!Array.isArray(task?.products)) return [];
  return task.products
    .filter(product => product && typeof product.name === "string" && product.name.trim())
    .map(product => ({
      name: product.name.trim().slice(0, 80),
      price: Number.isFinite(product.price) && product.price >= 0 ? product.price : null,
      available: product.available !== false
    }))
    .slice(0, 12);
}

export function takeoutShopChoices(task) {
  if (!Array.isArray(task?.shops)) return [];
  return task.shops
    .filter(shop => shop && typeof (shop.name || shop.shop_name) === "string" && (shop.name || shop.shop_name).trim())
    .map(shop => ({
      name: String(shop.name || shop.shop_name).trim().slice(0, 60),
      meta: typeof shop.meta === "string" ? shop.meta.slice(0, 160) : "",
      rating: (() => {
        const match = String(shop.meta || "").match(/(?:^|\|)\s*([0-5](?:\.\d)?)\s*\|\s*分/);
        return match ? Number(match[1]) : null;
      })()
    }))
    .slice(0, 8);
}

export function parseShopMetaTags(meta = "") {
  const raw = String(meta || "");
  if (!raw) return [];
  const tags = [];
  const minOrder = raw.match(/起送\s*¥?\s*\d+(?:\.\d+)?/);
  if (minOrder) tags.push(minOrder[0].replace(/\s+/g, ""));
  const delivery = raw.match(/(?:免配送费|配送\s*¥?\s*\d+(?:\.\d+)?)/);
  if (delivery) tags.push(delivery[0].replace(/\s+/g, ""));
  const eta = raw.match(/\d+\s*分钟/);
  if (eta) tags.push(eta[0].replace(/\s+/g, ""));
  const distance = raw.match(/\d+(?:\.\d+)?\s*(?:km|m|公里|米)/i);
  if (distance) tags.push(distance[0].replace(/\s+/g, ""));
  return tags.slice(0, 3);
}

export function takeoutRecoverySuggestion(task) {
  if (!task || !["error", "manual_review"].includes(task.status)) return null;
  const code = String(task.code || "");
  if (code === "takeout_budget_exceeded" || code === "takeout_over_budget") {
    return {
      title: "实际总额略高于预算",
      hint: "建议适当提高 10 元预算覆盖配送/包装费，或选一道更轻量的单人餐。",
      actions: ["raise_budget", "review_cart"],
    };
  }
  if (code === "takeout_shop_not_found" || code === "takeout_product_not_found" || code === "takeout_menu_unavailable") {
    return {
      title: "未搜到精确匹配的店铺或菜品",
      hint: "把需求简化为 2–3 个菜品关键词（如“馄饨 粥”）或切换其他外卖平台通常即可命中。",
      actions: ["simplify_query", "switch_platform"],
    };
  }
  if (code === "takeout_login_expired" || code === "takeout_verification_required" || code.startsWith("browser_")) {
    return {
      title: "平台需要重新登录或人机核验",
      hint: "请展开下方「平台登录与连接」完成一次登录/验证后再继续，历史登录态不会丢失。",
      actions: ["open_login", "review_cart"],
    };
  }
  if (code === "takeout_result_sync_failed" || code === "takeout_previous_attempt_unknown" || code === "takeout_cart_unverified") {
    return {
      title: "请先核对购物车，避免重复加购",
      hint: "页面可能已完成部分加购但回执未同步，建议先切回平台查看购物车或检查外卖诊断日志。",
      actions: ["review_cart", "open_diagnostics"],
    };
  }
  return {
    title: "可快速调整条件或排查日志",
    hint: "可回到平台确认购物车状态，或一键查看外卖错误诊断获取 Trace ID。",
    actions: ["review_cart", "open_diagnostics"],
  };
}

const HISTORY_KEY_PREFIX = "dengta.takeout.history.v1:";
const PLATFORM_KEY_PREFIX = "dengta.takeout.platform.v1:";

export function readTakeoutPlatformPref(scope = "") {
  if (!scope) return "eleme";
  try {
    const val = globalThis.localStorage?.getItem?.(`${PLATFORM_KEY_PREFIX}${scope}`);
    return TAKEOUT_PLATFORMS_META.some((p) => p.id === val) ? val : "eleme";
  } catch {
    return "eleme";
  }
}

export function saveTakeoutPlatformPref(scope = "", platformId = "eleme") {
  if (!scope || !TAKEOUT_PLATFORMS_META.some((p) => p.id === platformId)) return;
  try {
    globalThis.localStorage?.setItem?.(`${PLATFORM_KEY_PREFIX}${scope}`, platformId);
  } catch {
    // Ignore restricted storage.
  }
}

export function readTakeoutHistory(scope = "") {
  if (!scope) return [];
  try {
    const raw = globalThis.localStorage?.getItem?.(`${HISTORY_KEY_PREFIX}${scope}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.query === "string" && item.query.trim()).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

export function recordTakeoutHistory(scope = "", entry = {}) {
  const query = safeText(entry.query, 120);
  if (!scope || !query) return readTakeoutHistory(scope);
  const existing = readTakeoutHistory(scope);
  const next = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      query,
      budget: entry.budget ?? "",
      people: String(entry.people || "1"),
      note: safeText(entry.note, 120),
      platform: entry.platform || "eleme",
      at: Date.now(),
    },
    ...existing.filter((item) => item.query !== query),
  ].slice(0, 6);
  try {
    globalThis.localStorage?.setItem?.(`${HISTORY_KEY_PREFIX}${scope}`, JSON.stringify(next));
  } catch {
    // Ignore restricted storage.
  }
  return next;
}

export function formatTakeoutPrice(value) {
  return Number.isFinite(value) && value >= 0 ? `¥${value.toFixed(2)}` : "";
}

export function takeoutStopLabel() {
  return "暂停自动操作，我来看看";
}
