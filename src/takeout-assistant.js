const ACTIONS = new Set(["search", "menu", "order"]);
const safeText = (value, limit = 1000) => Array.from(String(value ?? "").trim()).slice(0, limit).join("");

export const TAKEOUT_STEPS = [
  { id: "search", label: "搜店" },
  { id: "menu", label: "看菜单" },
  { id: "order", label: "选餐核对" },
  { id: "payment", label: "你来付款" }
];

export function buildTakeoutRequest({ query = "", budget = "", people = 1, note = "" } = {}) {
  const requirement = safeText(query, 800);
  if (!requirement) return { ok: false, message: "先告诉我今天想吃什么，也可以选择一个灵感。" };
  const amount = budget === "" ? null : Number(budget);
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || amount > 100000)) {
    return { ok: false, message: "请填写大于 0 的总预算，或者留空让我先比较。" };
  }
  const portions = Math.min(20, Math.max(1, Math.round(Number(people) || 1)));
  const preference = safeText(note, 300);
  return {
    ok: true,
    text: [
      `帮我挑选并准备外卖：${requirement}。${portions} 人用餐。`,
      amount === null ? "请先比较实际价格。" : `含配送及包装的总预算不超过 ${amount} 元。`,
      preference ? `我的要求：${preference}。` : "",
      "先搜索真实店铺，再读取选中店铺的真实菜单，按我的要求选择合适的准确商品并加购。核对数量、规格、配送费和实际总额，停在付款前等我核对并付款。遇到登录、验证码、规格或金额无法确认时交给我处理，不重复加购。"
    ].filter(Boolean).join(""),
    query: requirement, budget: amount, people: portions, note: preference
  };
}

export function updateTakeoutTask(previous, { scope, type, command, outcome, message } = {}) {
  if (!scope || !command?.id || !ACTIONS.has(command?.command?.action)) return previous;
  const action = command.command.action;
  const current = previous?.scope === scope ? previous : { scope, completed: [], status: "working" };
  if (type === "progress" && current.commandId !== command.id) return previous;
  const next = { ...current, scope, commandId: command.id, action,
    requirement: safeText(command.command.requirement), shop: safeText(command.command.shop_name, 120) || current.shop || "" };
  if (current.pausedByUser) return { ...next, status: "manual_review", executing: false, message: "自动操作已暂停，请在平台页面核对购物车。" };
  if (type === "start") return { ...next, status: "working", executing: true, message: { search: "正在寻找合适的店铺", menu: "正在查看这家店的真实菜单", order: "正在选餐加购，核对实际金额" }[action], code: "" };
  if (type === "progress") return { ...next, message: safeText(message, 200) || current.message };
  if (type !== "done" || !outcome) return previous;
  const synced = outcome.receipt_synced === true;
  const successful = outcome.ok === true && synced;
  const paymentReady = successful && outcome.status === "ready_for_payment" &&
    Number.isFinite(outcome.total) && outcome.total > 0 && outcome.paymentSubmitted === false &&
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

export function formatTakeoutPrice(value) {
  return Number.isFinite(value) && value >= 0 ? `¥${value.toFixed(2)}` : "";
}

export function takeoutStopLabel() {
  return "暂停自动操作，我来看看";
}
