"use strict";

const { createHash } = require("node:crypto");
const { isVerifiedTakeoutCheckout } = require("./takeout-receipts");
const { normalizeTakeoutSearchKeyword } = require("./takeout-query");

// 外卖点餐命令通道：AI 聊天工具写入命令，手机 App 轮询执行并回传结果，
// 工具调用在超时窗口内等待结果，以便 AI 在同一轮对话里给出自然回应。

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function requireScope(scope) {
    if (!scope?.userId || !scope?.companionId) {
        throw requestError(401, "takeout_auth_required", "点餐命令需要登录态。");
    }
}

function idempotentCommandId(scope, key) {
    if (key === undefined || key === null || key === "") return null;
    if (typeof key !== "string" || !/^[\x21-\x7e]{1,200}$/.test(key)) {
        throw requestError(400, "takeout_idempotency_key_invalid", "点餐重试编号格式不正确，请重新发起。");
    }
    const bytes = createHash("sha256").update(JSON.stringify(["takeout-v1", scope.userId, scope.companionId, key])).digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.subarray(0, 16).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeCommand(command) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
        throw requestError(400, "takeout_command_invalid", "点餐指令必须是 JSON 对象。");
    }
    const action = String(command.action || "search").trim().toLowerCase();
    if (!["search", "menu", "order"].includes(action)) {
        throw requestError(400, "takeout_action_invalid", "点餐仅支持搜索、查看菜单或挑选加购，付款请在外卖平台手动确认。");
    }
    const shopName = cleanText(command.shop_name, 120);
    const rawRequirement = cleanText(action === "order" ? command.product_name || command.requirement : command.requirement || (action === "menu" ? shopName : ""), 1000);
    // 平台搜索不认“想吃热乎的一人食”这种口语，先转成可检索的关键词。
    const requirement = action === "search" ? normalizeTakeoutSearchKeyword(rawRequirement) : rawRequirement;
    if (!requirement) {
        throw requestError(400, "takeout_requirement_required", "请说明要买什么（口味/预算/评分等要求）。");
    }
    if (["menu", "order"].includes(action) && !shopName) {
        throw requestError(400, "takeout_shop_required", "请先从真实搜索结果中选择店铺，再挑选商品。");
    }
    const budget = command.budget_max === undefined || command.budget_max === null || command.budget_max === "" ? null : Number(command.budget_max);
    if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 100000)) {
        throw requestError(400, "takeout_budget_invalid", "预算需要填写大于 0 的有效金额。");
    }
    return {
        action,
        requirement,
        shop_name: shopName,
        quantity: Number.isFinite(Number(command.quantity)) ? Math.max(1, Math.min(20, Math.round(Number(command.quantity)))) : 1,
        budget_max: budget,
        note: cleanText(command.note, 500),
        checkout_only: true,
        payment_policy: "user_confirm"
    };
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createTakeoutChannel({ database } = {}) {
    if (!database?.from) {
        throw new TypeError("takeout channel requires a Supabase database client");
    }

    async function readCommand(scope, commandId) {
        requireScope(scope);
        if (!isUuid(commandId)) {
            throw requestError(400, "takeout_command_id_invalid", "点餐命令编号格式不正确。");
        }
        const { data, error } = await database
            .from("takeout_commands")
            .select("*")
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function createCommand(scope, command = {}) {
        requireScope(scope);
        const payload = normalizeCommand(command);
        const commandId = idempotentCommandId(scope, command.idempotency_key);
        const { data, error } = await database
            .from("takeout_commands")
            .insert({
                ...(commandId ? { id: commandId } : {}),
                user_id: scope.userId,
                companion_id: scope.companionId,
                status: "pending",
                command: payload
            })
            .select("id, status, created_at")
            .single();
        if (error) {
            if (error.code !== "23505" || !commandId) throw error;
            // The primary key, rather than an in-process cache, arbitrates retries across instances.
            const existing = await readCommand(scope, commandId);
            if (!existing || JSON.stringify(normalizeCommand(existing.command)) !== JSON.stringify(payload)) {
                throw requestError(409, "takeout_idempotency_conflict", "这条重试编号已用于其他点餐需求，请先核对原任务。");
            }
            return { command_id: existing.id, status: existing.status, created_at: existing.created_at, replayed: true };
        }
        return { command_id: data.id, status: data.status, created_at: data.created_at };
    }

    async function getCommand(scope, commandId) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        return {
            command_id: row.id,
            status: row.status,
            progress: row.progress || "",
            command: row.command || {},
            result: row.result || null,
            created_at: row.created_at,
            updated_at: row.updated_at,
            payment_required: row.status === "done" && isVerifiedTakeoutCheckout(row.result, row.command)
        };
    }

    async function waitForResult(scope, commandId, { timeoutMs = 120000, pollMs = 2000 } = {}) {
        const deadline = Date.now() + Math.min(300000, Math.max(5000, Number(timeoutMs) || 120000));
        let current = null;
        while (Date.now() < deadline) {
            const row = await readCommand(scope, commandId);
            if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
            current = row;
            if (row.status === "done" || row.status === "failed" || row.status === "cancelled") {
                return { command_id: commandId, status: row.status, progress: row.progress || "", result: row.result || null };
            }
            await sleep(Math.min(5000, Math.max(500, Number(pollMs) || 2000)));
        }
        return { command_id: commandId, status: current?.status || "pending", progress: current?.progress || "", result: null, timed_out: true };
    }

    async function pendingCommands(scope) {
        requireScope(scope);
        const { data, error } = await database
            .from("takeout_commands")
            .select("id, command, progress, created_at")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            // 只下发尚未被领取的命令;卡在 executing 的命令不再重复下发,
            // 避免 App 启动即执行导致原生页面反复崩溃。
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(10);
        if (error) throw error;
        return data || [];
    }

    async function ackCommand(scope, commandId) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        if (row.status !== "pending") {
            throw requestError(409, "takeout_command_not_pending", "这条命令已经处理过了。");
        }
        const { data, error } = await database
            .from("takeout_commands")
            .update({
                status: "executing",
                ack_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("status", "pending")
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(409, "takeout_command_not_pending", "这条命令已被领取或取消，请勿重复执行。");
        return { command_id: data.id, status: data.status };
    }

    async function postProgress(scope, commandId, progress) {
        const text = cleanText(progress, 500);
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        const { data, error } = await database
            .from("takeout_commands")
            .update({ progress: text, updated_at: new Date().toISOString() })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("status", "executing")
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(409, "takeout_command_not_executing", "命令已结束，不能更新进度。");
        return { ok: true };
    }

    async function postResult(scope, commandId, result) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        if (!result || typeof result !== "object" || Array.isArray(result)) {
            throw requestError(400, "takeout_result_invalid", "执行结果必须是 JSON 对象。");
        }
        if (row.status === "done") return { command_id: row.id, status: row.status };
        const { data, error } = await database
            .from("takeout_commands")
            .update({
                status: "done",
                result,
                done_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("status", "executing")
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            const current = await readCommand(scope, commandId);
            if (current?.status === "done") return { command_id: current.id, status: current.status };
            throw requestError(409, "takeout_command_not_executing", "命令已取消或结束，结果未覆盖原记录。");
        }
        return { command_id: data.id, status: data.status };
    }

    async function postFailure(scope, commandId, message) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        if (row.status === "failed") return { command_id: row.id, status: row.status };
        const { data, error } = await database
            .from("takeout_commands")
            .update({
                status: "failed",
                result: { error: cleanText(message, 500) || "点餐执行失败。" },
                done_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("status", "executing")
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(409, "takeout_command_already_finished", "命令已结束，失败回执未覆盖执行结果。");
        return { command_id: data.id, status: data.status };
    }

    async function cancelCommand(scope, commandId) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        if (!["pending", "executing"].includes(row.status)) {
            throw requestError(409, "takeout_command_not_pending", "这条命令已经处理过了。");
        }
        const { data, error } = await database
            .from("takeout_commands")
            .update({
                status: "cancelled",
                updated_at: new Date().toISOString()
            })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .in("status", ["pending", "executing"])
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(409, "takeout_command_already_finished", "命令已结束，不能再取消。");
        return { command_id: data.id, status: data.status };
    }

    return {
        ackCommand,
        cancelCommand,
        createCommand,
        getCommand,
        pendingCommands,
        postFailure,
        postProgress,
        postResult,
        readCommand,
        waitForResult
    };
}

module.exports = { createTakeoutChannel };
