"use strict";

const express = require("express");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { requireRequestScope } = require("./request-scope");

const TOKEN_TABLE = "surprise_map_mcp_tokens";
const LETTER_TABLE = "surprise_map_letters";
const PUBLICATION_TABLE = "surprise_map_publications";
const TOKEN_PREFIX = "dengta_map_";
const PROTOCOL_VERSION = "2025-06-18";

function fault(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function text(value, maximum, optional = false) {
    if (optional && (value === undefined || value === null)) return "";
    if (typeof value !== "string" || !value.trim() || value.length > maximum) throw fault(400, "surprise_map_invalid_request", "文字长度或格式不正确。");
    return value.trim();
}
function coordinate(value, maximum, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > maximum) throw fault(400, "surprise_map_location_invalid", label + " 不是有效坐标。");
    return number;
}
function radiusOf(value) {
    const number = value === undefined || value === null ? 200 : Number(value);
    if (!Number.isFinite(number) || number < 50 || number > 5000) throw fault(400, "surprise_map_invalid_request", "radius_m 需要在 50 到 5000 之间。");
    return Math.round(number);
}
function hashToken(token) { return createHash("sha256").update(String(token)).digest("hex"); }
function newToken() { return TOKEN_PREFIX + randomBytes(32).toString("base64url"); }
function jsonRpc(id, result) { return { jsonrpc: "2.0", id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }
function toolResult(value) { return { content: [{ type: "text", text: JSON.stringify(value) }] }; }
function toolError(code, message) { return { content: [{ type: "text", text: JSON.stringify({ ok: false, code, message }) }], isError: true }; }
async function result(query) {
    const response = await query;
    if (response?.error) throw response.error;
    return response?.data;
}

function hintArea(latitude, longitude, radius, random) {
    const areaRadius = Math.max(300, radius * 3);
    const angle = random() * Math.PI * 2, offset = (random() * areaRadius) / 2;
    const areaLatitude = Math.max(-90, Math.min(90, latitude + (offset * Math.cos(angle)) / 111320));
    const areaLongitude = ((longitude + (offset * Math.sin(angle)) / (111320 * Math.max(0.01, Math.cos((latitude * Math.PI) / 180))) + 540) % 360) - 180;
    return { areaRadius, areaLatitude, areaLongitude };
}

function toolDefinitions() {
    return [
        {
            name: "hide_letter",
            description: "在当前账号与伴侣的藏宝地图上藏一封私人信。需要明确 confirm:true；坐标由调用方提供，服务端只保存信件落点，不保存领取者轨迹。",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string", description: "标题，1-160 字" },
                    body: { type: "string", description: "信件正文，1-16000 字" },
                    hint: { type: "string", description: "给寻找者看的地点提示，1-240 字" },
                    lat: { type: "number", description: "WGS84 纬度" },
                    lon: { type: "number", description: "WGS84 经度" },
                    radius_m: { type: "number", description: "走近多少米可领取，50-5000，默认 200" },
                    confirm: { type: "boolean", description: "必须为 true，表示确认在这片真实位置藏信" }
                },
                required: ["title", "body", "hint", "lat", "lon", "confirm"],
                additionalProperties: false
            }
        },
        {
            name: "list_letters",
            description: "列出当前账号与伴侣的私人信件（标题、提示、状态），不返回未拆开的正文。",
            inputSchema: { type: "object", properties: { limit: { type: "number", description: "1-100，默认 20" } }, additionalProperties: false }
        },
        {
            name: "list_public_letters",
            description: "列出公共藏宝地图上已发布的惊喜（笔名、标题、公共地点、是否 AI 代笔），不返回正文或精确坐标。",
            inputSchema: { type: "object", properties: { limit: { type: "number", description: "1-50，默认 20" } }, additionalProperties: false }
        }
    ];
}

function createSurpriseMapMcpRouter({ database, now = Date.now, random = Math.random } = {}) {
    if (!database?.from) throw new Error("surprise map MCP requires a database");
    const router = express.Router();
    router.use(express.json({ limit: "128kb" }));

    const adminRoute = handler => async (req, res) => {
        try { await handler(req, res); }
        catch (error) {
            const status = Number(error?.status) || (error?.code === "42501" ? 403 : 503);
            res.status(status).json({ ok: false, code: error?.code || "surprise_map_mcp_failed", message: error?.message || "藏宝地图 MCP 请求未完成。" });
        }
    };

    router.post("/tokens", adminRoute(async (req, res) => {
        const scope = requireRequestScope(req);
        const label = String(req.body?.label ?? "").trim().slice(0, 80);
        const token = newToken();
        const row = await result(database.from(TOKEN_TABLE).insert({
            id: randomUUID(), user_id: scope.userId, companion_id: scope.companionId,
            token_hash: hashToken(token), label, created_at: new Date(Number(now())).toISOString()
        }).select("id,label,created_at").single());
        res.status(201).json({ ok: true, id: row.id, token, label: row.label, created_at: row.created_at, endpoint: "/api/v2/surprise-map/mcp" });
    }));

    router.get("/tokens", adminRoute(async (req, res) => {
        const scope = requireRequestScope(req);
        const rows = await result(database.from(TOKEN_TABLE).select("id,label,created_at,last_used_at")
            .eq("user_id", scope.userId).eq("companion_id", scope.companionId).is("revoked_at", null)
            .order("created_at", { ascending: false }).limit(50)) || [];
        res.json({ ok: true, tokens: rows });
    }));

    router.delete("/tokens/:id", adminRoute(async (req, res) => {
        const scope = requireRequestScope(req);
        const id = String(req.params.id || "");
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw fault(404, "surprise_map_not_found", "令牌不存在。");
        const row = await result(database.from(TOKEN_TABLE).update({ revoked_at: new Date(Number(now())).toISOString() })
            .eq("id", id).eq("user_id", scope.userId).eq("companion_id", scope.companionId).select("id").maybeSingle());
        if (!row) throw fault(404, "surprise_map_not_found", "令牌不存在。");
        res.json({ ok: true, id: row.id, revoked: true });
    }));

    async function authenticate(req) {
        const header = String(req.get("authorization") || "");
        const match = /^Bearer\s+(.+)$/i.exec(header);
        const token = match?.[1]?.trim();
        if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
        const row = await result(database.from(TOKEN_TABLE).select("id,user_id,companion_id,revoked_at")
            .eq("token_hash", hashToken(token)).maybeSingle());
        if (!row || row.revoked_at) return null;
        const companion = await result(database.from("companions").select("id")
            .eq("user_id", row.user_id).eq("id", row.companion_id).maybeSingle());
        if (!companion) return null;
        try { await database.from(TOKEN_TABLE).update({ last_used_at: new Date(Number(now())).toISOString() }).eq("id", row.id); } catch { /* usage timestamp is best effort */ }
        return { userId: row.user_id, companionId: row.companion_id, tokenId: row.id };
    }

    async function hideLetter(owner, args) {
        if (args?.confirm !== true) return toolError("surprise_map_confirmation_required", "需要 confirm:true 才会藏信。");
        const title = text(args.title, 160), body = text(args.body, 16000), hint = text(args.hint, 240);
        const latitude = coordinate(args.lat, 90, "lat"), longitude = coordinate(args.lon, 180, "lon");
        const radius = radiusOf(args.radius_m);
        const area = hintArea(latitude, longitude, radius, random);
        const row = await result(database.from(LETTER_TABLE).insert({
            id: randomUUID(), client_request_id: randomUUID(), user_id: owner.userId, companion_id: owner.companionId,
            title, body, hint, latitude, longitude, radius_m: radius,
            area_latitude: area.areaLatitude, area_longitude: area.areaLongitude, area_radius_m: area.areaRadius,
            created_at: new Date(Number(now())).toISOString()
        }).select("id,title,hint,radius_m,created_at").single());
        return toolResult({ ok: true, id: row.id, title: row.title, hint: row.hint, radius_m: row.radius_m, state: "sealed" });
    }

    async function listLetters(owner, args) {
        const limit = Math.min(100, Math.max(1, Math.round(Number(args?.limit) || 20)));
        const rows = await result(database.from(LETTER_TABLE).select("id,title,hint,radius_m,created_at")
            .eq("user_id", owner.userId).eq("companion_id", owner.companionId)
            .order("created_at", { ascending: false }).limit(limit)) || [];
        const ids = rows.map(row => row.id);
        const claims = ids.length ? await result(database.from("surprise_map_claims").select("letter_id").in("letter_id", ids).eq("user_id", owner.userId).eq("companion_id", owner.companionId)) || [] : [];
        const claimed = new Set(claims.map(row => row.letter_id));
        return toolResult({ ok: true, letters: rows.map(row => ({ id: row.id, title: row.title, hint: row.hint, radius_m: row.radius_m, state: claimed.has(row.id) ? "opened" : "sealed", created_at: row.created_at })) });
    }

    async function listPublic(args) {
        const limit = Math.min(50, Math.max(1, Math.round(Number(args?.limit) || 20)));
        const rows = await result(database.from(PUBLICATION_TABLE).select("id,public_title,public_place,author_alias,source,created_at")
            .eq("state", "published").order("created_at", { ascending: false }).limit(limit)) || [];
        return toolResult({ ok: true, letters: rows.map(row => ({ id: row.id, title: row.public_title, place: row.public_place, author_alias: row.author_alias || "路过的旅人", source: row.source === "ai" ? "ai" : "human", created_at: row.created_at })) });
    }

    router.post("/", async (req, res) => {
        let owner;
        try { owner = await authenticate(req); }
        catch { res.status(503).json(jsonRpcError(req.body?.id, -32000, "藏宝地图服务暂时不可用。")); return; }
        if (!owner) { res.status(401).json(jsonRpcError(req.body?.id, -32001, "MCP 令牌无效或已撤回。")); return; }
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) { res.status(400).json(jsonRpcError(null, -32600, "请求不是有效的 JSON-RPC 对象。")); return; }
        if (body.id === undefined || body.id === null && body.method?.startsWith("notifications/")) { res.status(202).end(); return; }
        const id = body.id ?? null, method = String(body.method || "");
        try {
            if (method === "initialize") { res.json(jsonRpc(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "dengta-surprise-map", version: "1.0.0" } })); return; }
            if (method === "ping") { res.json(jsonRpc(id, {})); return; }
            if (method === "tools/list") { res.json(jsonRpc(id, { tools: toolDefinitions() })); return; }
            if (method === "tools/call") {
                const name = String(body.params?.name || ""), args = body.params?.arguments;
                if (args !== undefined && (typeof args !== "object" || Array.isArray(args))) { res.json(jsonRpcError(id, -32602, "arguments 必须是对象。")); return; }
                if (name === "hide_letter") { res.json(jsonRpc(id, await hideLetter(owner, args || {}))); return; }
                if (name === "list_letters") { res.json(jsonRpc(id, await listLetters(owner, args || {}))); return; }
                if (name === "list_public_letters") { res.json(jsonRpc(id, await listPublic(args || {}))); return; }
                res.json(jsonRpcError(id, -32602, "未知工具：" + name));
                return;
            }
            res.json(jsonRpcError(id, -32601, "未知方法：" + method));
        } catch (error) {
            if (["surprise_map_invalid_request", "surprise_map_location_invalid", "surprise_map_confirmation_required"].includes(error?.code)) {
                res.json(jsonRpc(id, toolError(error.code, error.message)));
                return;
            }
            res.status(503).json(jsonRpcError(id, -32000, "藏宝地图 MCP 操作未完成。"));
        }
    });

    return router;
}

module.exports = { createSurpriseMapMcpRouter };
