const express = require("express");
const crypto = require("node:crypto");
const { requireRequestScope } = require("../../services/request-scope");

const CHANNELS = new Set(["wechat", "qq"]);
const PERSONA_MODES = new Set(["normal_only", "selected", "all"]);
const MEMORY_MODES = new Set(["none", "recent", "selected", "all"]);
const CATEGORIES = new Set(["normal", "private", "nsfw", "style"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function routeError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}
function text(value, max) {
    return String(value ?? "").trim().slice(0, max);
}
function uuidList(value, field, max = 100) {
    const list = Array.isArray(value) ? value : [];
    const clean = [];
    for (const item of list.slice(0, max)) {
        if (!UUID_PATTERN.test(String(item))) throw routeError(400, "invalid_" + field, field + " 含非法 ID。");
        clean.push(String(item));
    }
    return [...new Set(clean)];
}
function bool(value, fallback = false) {
    return value === undefined ? fallback : value === true;
}

function createChannelSyncRouter() {
    const router = express.Router();

    router.get("/persona-sections", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await scope.db.from("persona_sections")
                .select("id,section_key,title,content,category,enabled,sort_order,updated_at")
                .order("sort_order", { ascending: true });
            if (result.error) throw result.error;
            res.json({ ok: true, sections: result.data || [] });
        } catch (error) { next(error); }
    });

    router.put("/persona-sections", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const sections = Array.isArray(req.body?.sections) ? req.body.sections.slice(0, 100) : [];
            let total = 0;
            const rows = sections.map((section, index) => {
                const category = String(section?.category || "normal");
                if (!CATEGORIES.has(category)) throw routeError(400, "invalid_category", "人设小节分类不合法。");
                const content = String(section?.content ?? "");
                total += Array.from(content).length;
                if (total > 120000) throw routeError(413, "persona_too_large", "人设小节总长度超过 120000 字。");
                const key = text(section?.section_key || section?.id || `section-${index + 1}`, 80) || `section-${index + 1}`;
                return {
                    section_key: key,
                    title: text(section?.title || key, 80),
                    content,
                    category,
                    enabled: bool(section?.enabled, false),
                    sort_order: Number.isFinite(Number(section?.sort_order)) ? Number(section.sort_order) : index
                };
            });
            const removed = await scope.db.from("persona_sections").delete().neq("id", "00000000-0000-0000-0000-000000000000");
            if (removed.error) throw removed.error;
            if (rows.length) {
                const inserted = await scope.db.from("persona_sections").insert(rows).select("id");
                if (inserted.error) throw inserted.error;
            }
            res.json({ ok: true, count: rows.length });
        } catch (error) { next(error); }
    });

    router.get("/preferences", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const channel = String(req.query?.channel || "wechat");
            if (!CHANNELS.has(channel)) throw routeError(400, "invalid_channel", "通道只支持 wechat 或 qq。");
            const result = await scope.db.from("channel_sync_preferences")
                .select("*").eq("channel", channel).maybeSingle();
            if (result.error) throw result.error;
            res.json({
                ok: true,
                channel,
                preferences: result.data || {
                    channel,
                    persona_mode: "normal_only",
                    persona_section_ids: [],
                    style_enabled: false,
                    style_text: "",
                    ...(channel === "qq" ? { qq_include_persona_prompt: false, qq_receive_memory_candidates: false } : {}),
                    memory_mode: "none",
                    memory_ids: [],
                    memory_keywords: [],
                    memory_limit: 0,
                    media_enabled: false
                }
            });
        } catch (error) { next(error); }
    });

    router.put("/preferences", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const body = req.body || {};
            const channel = String(body.channel || "wechat");
            if (!CHANNELS.has(channel)) throw routeError(400, "invalid_channel", "通道只支持 wechat 或 qq。");
            const personaMode = String(body.persona_mode || "normal_only");
            if (!PERSONA_MODES.has(personaMode)) throw routeError(400, "invalid_persona_mode", "人设模式不合法。");
            const memoryMode = String(body.memory_mode || "none");
            if (!MEMORY_MODES.has(memoryMode)) throw routeError(400, "invalid_memory_mode", "记忆模式不合法。");
            const payload = {
                channel,
                persona_mode: personaMode,
                persona_section_ids: uuidList(body.persona_section_ids, "persona_section_ids"),
                style_enabled: bool(body.style_enabled, false),
                style_text: text(body.style_text, 4000),
                memory_mode: memoryMode,
                memory_ids: uuidList(body.memory_ids, "memory_ids", 50),
                memory_keywords: (Array.isArray(body.memory_keywords) ? body.memory_keywords : []).slice(0, 20).map((item) => text(item, 50)).filter(Boolean),
                memory_limit: Math.max(0, Math.min(50, Number(body.memory_limit) || 0)),
                media_enabled: bool(body.media_enabled, false)
            };
            if (channel === "qq") {
                for (const key of ["qq_include_persona_prompt", "qq_receive_memory_candidates"]) {
                    if (body[key] !== undefined) payload[key] = body[key] === true;
                }
            }
            const result = await scope.db.from("channel_sync_preferences")
                .upsert(payload, { onConflict: "user_id,companion_id,channel" }).select("*").maybeSingle();
            if (result.error) throw result.error;
            res.json({ ok: true, preferences: result.data || payload });
        } catch (error) { next(error); }
    });

    router.get("/qq-memory-candidates", async (req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            const scope = requireRequestScope(req);
            const { data, error } = await scope.db.from("stable_memory_candidates")
                .select("id,summary,qq_available_at")
                .eq("status", "pending").lte("qq_available_at", new Date().toISOString())
                .order("qq_available_at", { ascending: false }).limit(50);
            if (error) throw error;
            res.json({ candidates: data || [] });
        } catch (error) { next(error); }
    });

    router.post("/qq-memory-candidates/:id/decision", async (req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            const scope = requireRequestScope(req);
            if (!UUID_PATTERN.test(req.params.id) || typeof req.body?.accept !== "boolean") {
                throw routeError(400, "invalid_qq_memory_decision", "候选记忆或确认选项无效。");
            }
            const { data, error } = await scope.db.rpc("decide_qq_memory_candidate", {
                p_id: req.params.id, p_accept: req.body.accept
            });
            if (error) throw error;
            if (!data) throw routeError(404, "qq_memory_candidate_unavailable", "这条候选记忆当前不可处理。");
            res.json({ ok: true });
        } catch (error) { next(error); }
    });

    router.get("/memories", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 50));
            const q = text(req.query?.q, 80);
            let query = scope.db.from("memories").select("id,summary,updated_at").order("updated_at", { ascending: false }).limit(limit);
            if (req.query?.channel === "qq") query = query.eq("confirmation_status", "confirmed").eq("superseded", false);
            if (q) query = query.ilike("summary", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
            const result = await query;
            if (result.error) throw result.error;
            res.json({ ok: true, memories: result.data || [] });
        } catch (error) { next(error); }
    });

    router.patch("/persona-sections/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const id = String(req.params.id || "");
            if (!UUID_PATTERN.test(id)) throw routeError(400, "invalid_section_id", "人设小节 ID 不合法。");
            const body = req.body || {};
            const patch = {};
            if (body.enabled !== undefined) patch.enabled = body.enabled === true;
            if (body.title !== undefined) patch.title = text(body.title, 80);
            if (body.content !== undefined) patch.content = String(body.content ?? "").slice(0, 120000);
            if (body.category !== undefined) {
                const category = String(body.category || "normal");
                if (!CATEGORIES.has(category)) throw routeError(400, "invalid_category", "人设小节分类不合法。");
                patch.category = category;
            }
            if (!Object.keys(patch).length) throw routeError(400, "empty_patch", "没有需要保存的小节字段。");
            patch.updated_at = new Date().toISOString();
            const result = await scope.db.from("persona_sections").update(patch).eq("id", id).select("id,enabled,title,category").maybeSingle();
            if (result.error) throw result.error;
            res.json({ ok: true, section: result.data });
        } catch (error) { next(error); }
    });

    router.get("/bind/status", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const channel = String(req.query?.channel || "wechat");
            if (!CHANNELS.has(channel)) throw routeError(400, "invalid_channel", "通道只支持 wechat 或 qq。");
            const result = await scope.db.from("channel_bindings")
                .select("id,channel,external_id,status,bind_token_expires_at,created_at,updated_at")
                .eq("channel", channel)
                .order("created_at", { ascending: false })
                .limit(10);
            if (result.error) throw result.error;
            res.json({ ok: true, channel, bindings: result.data || [] });
        } catch (error) { next(error); }
    });

    router.post("/bind/start", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const body = req.body || {};
            const channel = String(body.channel || "wechat");
            if (!CHANNELS.has(channel)) throw routeError(400, "invalid_channel", "通道只支持 wechat 或 qq。");
            const code = String(crypto.randomInt(100000, 1000000));
            const token = crypto.createHash("sha256").update(code).digest("hex");
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            const inserted = await scope.db.from("channel_bindings").insert({
                channel,
                external_id: `pending-${crypto.randomUUID()}`,
                status: "pending",
                bind_token_hash: token,
                bind_token_expires_at: expiresAt
            }).select("id,channel,status,bind_token_expires_at").maybeSingle();
            if (inserted.error) throw inserted.error;
            res.json({ ok: true, code, expires_at: expiresAt, binding: inserted.data });
        } catch (error) { next(error); }
    });

    router.post("/bind/confirm", async (req, res, next) => {
        try {
            const body = req.body || {};
            const channel = String(body.channel || "wechat");
            if (!CHANNELS.has(channel)) throw routeError(400, "invalid_channel", "通道只支持 wechat 或 qq。");
            const code = String(body.code || "").trim();
            const externalId = text(body.external_id, 200);
            if (!/^\d{6}$/.test(code) || !externalId) throw routeError(400, "invalid_binding_code", "绑定码或外部身份不合法。");
            const token = crypto.createHash("sha256").update(code).digest("hex");
            const found = await requireRequestScope(req).db
                .from("channel_bindings")
                .select("id,user_id,companion_id,bind_token_expires_at")
                .eq("channel", channel)
                .eq("bind_token_hash", token)
                .maybeSingle();
            if (found.error) throw found.error;
            if (!found.data) throw routeError(404, "binding_code_not_found", "绑定码不存在或已使用。");
            if (found.data.bind_token_expires_at && new Date(found.data.bind_token_expires_at).getTime() < Date.now()) {
                throw routeError(410, "binding_code_expired", "绑定码已过期，请重新生成。");
            }
            const updated = await requireRequestScope(req).db.from("channel_bindings")
                .update({ external_id: externalId, status: "active", bind_token_hash: null, bind_token_expires_at: null })
                .eq("id", found.data.id)
                .select("id,channel,external_id,status")
                .maybeSingle();
            if (updated.error) throw updated.error;
            res.json({ ok: true, binding: updated.data });
        } catch (error) { next(error); }
    });

    router.delete("/bind/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const id = String(req.params.id || "");
            if (!UUID_PATTERN.test(id)) throw routeError(400, "invalid_binding_id", "绑定 ID 不合法。");
            const result = await scope.db.from("channel_bindings").delete().eq("id", id).select("id").maybeSingle();
            if (result.error) throw result.error;
            res.json({ ok: true, deleted: Boolean(result.data) });
        } catch (error) { next(error); }
    });

    return router;
}

module.exports = { createChannelSyncRouter };
