"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { isVerifiedTakeoutCheckout } = require("./takeout-receipts");

const TAKEOUT_TOOL = {
    name: "takeout_order",
    description: [
        "帮用户挑选外卖并推进到人工付款前，共三步：",
        "action=search 先按需求搜索真实店铺；requirement 必须是平台搜索关键词，不要把整句口语原样填进去，例如“想吃热乎的一人食”应搜“热汤 馄饨 粥 单人餐”。从回执的 rating（评分）、meta（配送/起送/距离）、用户口味和预算里挑最合适的一家，不猜价格。搜不到就把关键词缩短再搜一次。",
        "action=menu 指定搜索结果里的 shop_name，读取该店真实商品与价格；先看招牌菜、销量与价格是否匹配口味和预算，这家没有合适的菜就换搜索结果里的下一家再看，最多三家。",
        "action=order 指定同一店铺及菜单里的精确 product_name，加购并核对预算、数量和备注；只有一项商品、金额明确且未付款时才算准备好。",
        "搜索成功后不要停在搜索结果：必须立刻从 shops 里选一家继续 action=menu；菜单里有合适商品就立刻 action=order，推进到付款前。只有需要用户登录/核对、没有合适店或菜、或平台要求人工操作时才停。",
        "预算、备注和份数一旦说过就会沿用到后面步骤，不必重复填写；也不要自行放宽。",
        "未知价格、规格或备注需要用户核对，不能假装已经完成；",
        "始终停在人工确认付款前，不提交或支付订单。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            action: { type: "string", enum: ["search", "menu", "order"], description: "按 search→menu→order 顺序执行。" },
            requirement: { type: "string", description: "search 的关键词/口味需求；menu 可填店名；order 可兼容填写菜单中精确商品名。" },
            shop_name: { type: "string", description: "menu/order 必填，必须来自本轮真实搜索结果。" },
            product_name: { type: "string", description: "order 选择的真实菜单商品名；优先于 requirement。" },
            quantity: { type: "number", description: "份数，默认1；不能确认时交用户核对。" },
            budget_max: { type: "number", description: "用户给出的预算上限，单位元；说过一次后会沿用到后续步骤。" },
            note: { type: "string", description: "用户要求的忌口/规格/备注，会跨步骤累计；不能验证时交用户核对。" },
            max_wait_seconds: { type: "number", description: "本步等待手机回执60-240秒，默认120；超时不重新加购。" }
        },
        required: ["action"],
        additionalProperties: false
    }
};

// 每个动作的尝试上限：允许换店、换菜或缩短关键词，但绝不放宽到无限重试。
const ACTION_LIMITS = { search: 2, menu: 3, order: 2 };
// 这些失败意味着"这一步没有改动购物车"，可以换一家店或换一道菜继续。
const RETRYABLE_CODES = new Set([
    "takeout_shop_not_found",
    "takeout_product_not_found",
    "takeout_menu_unavailable",
    "takeout_page_incomplete"
]);

function text(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, maximum).join("");
}

function label(value) { return text(value, 1000).toLocaleLowerCase("en-US"); }
function failure(code, error, details = {}) { return { ok: false, code, error, ...details }; }

function normalizeShops(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.slice(0, 20).flatMap(shop => {
      const name = text(shop?.name || shop?.shop_name, 60);
      if (!name || seen.has(label(name))) return [];
      seen.add(label(name));
      const meta = text(shop?.meta, 240);
      const rating = (meta.match(/(?:^|\|)\s*([0-5](?:\.\d)?)\s*\|\s*分/) || [])[1];
      return [{ name, meta, rating: rating ? Number(rating) : null }];
    });
}

function normalizeProducts(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.slice(0, 40).flatMap(product => {
      const name = text(product?.name, 80);
      if (!name || seen.has(label(name))) return [];
      seen.add(label(name));
      const price = product?.price === null || product?.price === undefined || product?.price === "" ? NaN : Number(product.price);
      return [{ name, price: Number.isFinite(price) && price >= 0 ? price : null, available: product?.available !== false }];
    });
}

function mergeNote(previous, incoming) {
    const next = Array.from(String(incoming ?? "").replace(/\s+/g, " ").trim());
    if (!next.length) return { note: previous };
    if (next.length > 500) return { error: true };
    if (!previous) return { note: next.join("") };
    if (label(previous) === label(next.join(""))) return { note: previous };
    const merged = Array.from(previous);
    merged.push("；", ...next);
    if (merged.length > 500) return { error: true };
    return { note: merged.join("") };
}

function createTakeoutToolExecutor({ scope, channel, conversationId = "", clientMessageId = "" } = {}) {
    const commands = new Map();
    const attempts = { search: 0, menu: 0, order: 0 };
    const turnKey = createHash("sha256").update(JSON.stringify([conversationId, clientMessageId || randomUUID()])).digest("hex");
    let searchedShops = [];
    const menus = new Map();
    const constraints = { budget: null, note: "", quantity: 1, quantityFixed: false, budgetTightened: false };
    let stoppedCommandId = "";
    let stopped = false;
    let lastFailure = null;

    function resolvedBudget(raw) {
        if (raw === undefined || raw === null || raw === "") return { value: constraints.budget };
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0 || value > 100000) {
            return { error: failure("takeout_budget_invalid", "预算需要填写大于0的有效金额。") };
        }
        if (constraints.budget !== null && value > constraints.budget) {
            return { error: failure("takeout_budget_widened", "这次预算比前面说过的更高，未自动放宽。请按原预算挑选，或由用户重新明确需求。", { budget_max: constraints.budget }) };
        }
        if (constraints.budget !== null && value < constraints.budget) constraints.budgetTightened = true;
        constraints.budget = value;
        return { value };
    }

    function resolvedQuantity(raw) {
        if (raw === undefined || raw === null || raw === "") return constraints.quantity;
        const value = Number(raw);
        if (!Number.isFinite(value)) return constraints.quantity;
        const clamped = Math.max(1, Math.min(20, Math.round(value)));
        if (constraints.quantityFixed && clamped !== constraints.quantity) {
            return { error: failure("takeout_quantity_changed", "份数在本次点餐中已经确定，不能中途改变，以免重复加购。", { quantity: constraints.quantity }) };
        }
        constraints.quantity = clamped;
        constraints.quantityFixed = true;
        return clamped;
    }

    function execute(toolCall) {
        if (!scope?.userId || !scope?.companionId || !channel) {
            return Promise.resolve(failure("takeout_auth_required", "点餐工具需要登录态和手机执行通道，请先登录后再试。"));
        }
        let args;
        try { args = JSON.parse(String(toolCall?.arguments || "")); }
        catch { return Promise.resolve(failure("takeout_arguments_invalid", "点餐参数不是有效的 JSON。")); }
        if (!args || typeof args !== "object" || Array.isArray(args)) {
            return Promise.resolve(failure("takeout_arguments_invalid", "点餐参数格式不正确。"));
        }
        const action = text(args.action || "search", 32).toLowerCase();
        if (!["search", "menu", "order"].includes(action)) {
            return Promise.resolve(failure("takeout_action_invalid", "action 只能是 search、menu 或 order，付款由你在平台页面确认。"));
        }
        const shopName = text(args.shop_name, 120);
        const requirement = text(action === "order" ? args.product_name || args.requirement : args.requirement || (action === "menu" ? shopName : ""), 1000);
        if (!requirement) return Promise.resolve(failure("takeout_requirement_required", "请说明搜索需求或要买的真实商品名。"));
        if (action !== "search" && !shopName) return Promise.resolve(failure("takeout_shop_required", "请先选择真实搜索结果中的店铺。"));

        const requestFingerprint = JSON.stringify({
            action,
            requirement,
            shop_name: shopName,
            quantity: args.quantity === undefined ? null : args.quantity,
            budget_max: args.budget_max === undefined ? null : args.budget_max,
            note: args.note === undefined ? null : args.note
        });
        const prior = [...commands.values()].find(entry => entry.requestFingerprint === requestFingerprint);
        if (prior) return prior.promise;

        const budgetResult = resolvedBudget(args.budget_max);
        if (budgetResult.error) return Promise.resolve(budgetResult.error);
        const noteResult = mergeNote(constraints.note, args.note);
        if (noteResult.error) {
            stopped = true;
            lastFailure = { code: "takeout_note_limit_exceeded" };
            return Promise.resolve(failure("takeout_note_limit_exceeded", "备注累计过长，需要先人工核对，未继续自动加购或提交订单。"));
        }
        const note = noteResult.note;
        constraints.note = note;
        const quantityResult = resolvedQuantity(args.quantity);
        if (quantityResult?.error) return Promise.resolve(quantityResult.error);
        const quantity = typeof quantityResult === "number" ? quantityResult : constraints.quantity;

        const command = {
            action, requirement, shop_name: shopName,
            quantity,
            budget_max: budgetResult.value,
            note,
            // 真实 channel 以 idempotency_key 判重；每次换店/换菜是一次新尝试，attempt 号在下面补上。
            idempotency_key: ""
        };
        const fingerprint = JSON.stringify(command);
        for (const entry of commands.values()) {
            if (entry.fingerprint === fingerprint) return entry.promise;
            if (entry.action === action && entry.succeeded) {
                return Promise.resolve(failure("takeout_action_already_used", "这一步已经成功执行过，未创建第二条命令。请核对原任务后再发起新的需求。", { command_id: entry.commandId }));
            }
        }
        if (stopped) {
            return Promise.resolve(failure("takeout_flow_stopped", "本轮外卖任务已暂停或需要人工核对，未继续自动操作。请核对原窗口后重新明确发起需求。", { ...(stoppedCommandId ? { command_id: stoppedCommandId } : {}) }));
        }
        if (attempts[action] >= ACTION_LIMITS[action]) {
            return Promise.resolve(failure("takeout_attempts_exhausted", "这一步已经尝试过多次，未继续自动操作。请核对页面后由用户决定。", { ...(lastFailure?.code ? { last_code: lastFailure.code } : {}) }));
        }
        if (action !== "search" && !searchedShops.some(shop => label(shop?.name) === label(shopName))) {
            return Promise.resolve(failure("takeout_shop_unverified", "所选店铺不在本轮已完成的真实搜索结果中，请先搜索再选店。", { shops: searchedShops.slice(0, 20) }));
        }
        if (action === "order") {
            const inspected = menus.get(label(shopName)) || [];
            const available = inspected.find(product => label(product?.name) === label(requirement));
            if (!available || available.available === false) {
                return Promise.resolve(failure("takeout_product_unverified", "所选商品不在这家店已读取的可用菜单中，请先读取菜单，不要猜商品名。", { products: inspected.slice(0, 30) }));
            }
            const unitPrice = Number(available.price);
            if (Number.isFinite(unitPrice) && unitPrice > 0 && budgetResult.value !== null && unitPrice * quantity > budgetResult.value) {
                return Promise.resolve(failure("takeout_over_budget", "按已知菜单价格和份数计算已超过预算，未创建购物车命令。请核对预算或份数。", { budget_max: budgetResult.value, estimated_total: unitPrice * quantity }));
            }
        }
        attempts[action] += 1;
        if (args.quantity !== undefined && args.quantity !== null && args.quantity !== "" || action === "order") constraints.quantityFixed = true;
        command.idempotency_key = `chat:${turnKey}:${action}:${attempts[action]}`;
        const promise = run(command, args.max_wait_seconds, fingerprint);
        commands.set(`${action}:${attempts[action]}:${requestFingerprint}`, { action, fingerprint, requestFingerprint, promise, succeeded: false, commandId: "" });
        return promise;
    }

    function markSucceeded(fingerprint, commandId) {
        for (const entry of commands.values()) if (entry.fingerprint === fingerprint) { entry.succeeded = true; entry.commandId = commandId; }
    }

    function retryable(code) { return RETRYABLE_CODES.has(code); }

    async function run(command, wait, fingerprint) {
        let commandId = "";
        try {
            const created = await channel.createCommand(scope, command);
            commandId = created.command_id;
            const outcome = await channel.waitForResult(scope, commandId, { timeoutMs: Math.min(240, Math.max(60, Number(wait) || 120)) * 1000 });
            if (outcome.timed_out) {
                stopped = true;
                stoppedCommandId = commandId;
                lastFailure = { code: "takeout_command_timeout" };
                return { ok: true, action: command.action, command_id: commandId, status: outcome.status || "pending", timed_out: true, progress: outcome.progress || "", message: "手机任务仍在等待或执行，请查看原任务进度，未重新加购，也未确认下单。" };
            }
            if (outcome.status !== "done" || !outcome.result || outcome.result.ok === false) {
                const receiptCode = /^(takeout|browser)_[a-z_]{1,80}$/.test(String(outcome.result?.code)) ? outcome.result.code : "takeout_execution_failed";
                const code = outcome.status === "cancelled" ? "takeout_command_cancelled" : receiptCode;
                lastFailure = { code };
                const canRetry = retryable(code) && attempts[command.action] < ACTION_LIMITS[command.action];
                if (!canRetry) { stopped = true; stoppedCommandId = commandId; }
                const detail = text(outcome.result?.message || outcome.result?.why, 180);
                return failure(code, outcome.status === "cancelled" ? "点餐任务已停止。" : canRetry
                        ? `这一步没有找到目标，可以换一家店铺或换一道菜再试${detail ? `（${detail}）` : ""}。`
                        : detail
                            ? `未完成：${detail} 没有加购、没有提交订单，也没有付款；请核对购物车后再决定。`
                            : "手机未完成这一步，请在外卖窗口查看具体原因并核对购物车；没有加购、提交或付款。",
                    { command_id: commandId, status: outcome.result?.status || outcome.status, order_result: outcome.result || null, retryable: canRetry,
                      candidates: Array.isArray(outcome.result?.candidates) ? outcome.result.candidates.slice(0, 10) : [] });
            }
            const result = outcome.result;
            if (command.action !== "order" && (result.status !== "done" || result.loading === true || !Array.isArray(result[command.action === "search" ? "shops" : "products"]))) {
                lastFailure = { code: "takeout_page_incomplete" };
                const canRetry = attempts[command.action] < ACTION_LIMITS[command.action];
                if (!canRetry) { stopped = true; stoppedCommandId = commandId; }
                return failure("takeout_page_incomplete", canRetry ? "平台页面还没有返回完整列表，可以再试一次这一步；未自动加购。" : "平台页面尚未返回完整的真实列表，请在外卖窗口核对加载、登录或验证状态。", { command_id: commandId, status: result.status || "incomplete", order_result: result, retryable: canRetry });
            }
            if (command.action === "order" && !isVerifiedTakeoutCheckout(result, command, { allowNotes: !constraints.budgetTightened })) {
                stopped = true;
                stoppedCommandId = commandId;
                lastFailure = { code: "takeout_manual_review_required" };
                return failure("takeout_manual_review_required", "购物车、金额或备注尚未全部确认，请手动核对；未自动提交或支付订单。", { command_id: commandId, status: result.status || "manual_review", order_result: result });
            }
            if (command.action === "search") searchedShops = normalizeShops(result.shops);
            if (command.action === "menu") menus.set(label(command.shop_name), normalizeProducts(result.products));
            markSucceeded(fingerprint, commandId);
            lastFailure = null;
            return { ok: true, action: command.action, command_id: commandId, status: "done", attempt: attempts[command.action], remaining_attempts: Math.max(0, ACTION_LIMITS[command.action] - attempts[command.action]),
                ...(command.action === "search" ? { shops: searchedShops, next_action: "menu", suggested_shop: searchedShops[0]?.name || "" } : {}),
                ...(command.action === "menu" ? { products: menus.get(label(command.shop_name)), next_action: "order", suggested_product: (menus.get(label(command.shop_name)) || []).find(item => item.available !== false)?.name || "" } : {}),
                order_result: result, payment_required: command.action === "order", payment_policy: "user_confirm" };
        } catch (error) {
            stopped = true;
            stoppedCommandId = commandId;
            const code = /^takeout_[a-z_]+$/.test(String(error?.code)) ? error.code : "takeout_channel_failed";
            lastFailure = { code };
            return failure(code, "点餐通道未完成本次请求。请查看原任务和购物车后再决定是否重试。", { ...(commandId ? { command_id: commandId } : {}) });
        }
    }

    return execute;
}

module.exports = { TAKEOUT_TOOL, createTakeoutToolExecutor };
