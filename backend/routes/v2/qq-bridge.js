const express = require("express");
const { mergeCapsuleIntoSavedStatus, applyCapsuleJobs } = require("../../services/time-capsule-state");
const { withKeyLock } = require("../../services/keyed-lock");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequestScope } = require("../../services/request-scope");

function secureEqual(left, right) {
    const a = Buffer.from(String(left || ""));
    const b = Buffer.from(String(right || ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function loadQQBridgeConfig(configPath) {
    let config = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (parsed && typeof parsed === "object") config = parsed;
    } catch {
        config = {};
    }
    if (process.env.QQ_BRIDGE_CONFIG_JSON) {
        try {
            const parsedEnv = JSON.parse(process.env.QQ_BRIDGE_CONFIG_JSON);
            if (parsedEnv && typeof parsedEnv === "object") config = { ...config, ...parsedEnv };
        } catch {}
    }
    if (process.env.QQ_BRIDGE_TOKEN) config.token = String(process.env.QQ_BRIDGE_TOKEN);
    if (process.env.QQ_BRIDGE_BINDINGS) {
        try {
            const parsedBindings = JSON.parse(process.env.QQ_BRIDGE_BINDINGS);
            if (parsedBindings && typeof parsedBindings === "object") {
                config.bindings = { ...(config.bindings || {}), ...parsedBindings };
            }
        } catch {}
    }
    return config;
}

async function resolveQQScope(database, qq, configPath, channel = "") {
    const config = loadQQBridgeConfig(configPath || process.env.QQ_BRIDGE_CONFIG || path.join(__dirname, "..", "..", "qq-bridge.local.json"));
    const externalId = String(qq || "").trim();
    let binding = config?.bindings?.[externalId] || null;
    if ((!binding?.userId || !binding?.companionId) && externalId) {
        let query = database.from("channel_bindings")
            .select("user_id,companion_id")
            .eq("external_id", externalId)
            .eq("status", "active");
        if (["wechat", "qq"].includes(channel)) query = query.eq("channel", channel);
        const found = await query.limit(1).maybeSingle();
        if (found.error) throw found.error;
        if (found.data?.user_id && found.data?.companion_id) {
            binding = { userId: found.data.user_id, companionId: found.data.companion_id };
        }
    }
    if (!binding?.userId || !binding?.companionId) {
        const error = new Error("这个 QQ 还没有绑定 DengTa 账号和伴侣。");
        error.status = 403;
        error.code = "qq_bridge_binding_missing";
        throw error;
    }
    return createBoundQQScope(database, binding);
}

async function createBoundQQScope(database, binding) {
    const [profileResult, companionResult] = await Promise.all([
        database.from("user_profiles").select("id,email,display_name,role,status").eq("id", binding.userId).maybeSingle(),
        database.from("companions").select("id,user_id,name,status").eq("id", binding.companionId).eq("user_id", binding.userId).maybeSingle()
    ]);
    if (profileResult.error) throw profileResult.error;
    if (companionResult.error) throw companionResult.error;
    const profile = profileResult.data;
    const companion = companionResult.data;
    if (!profile || !companion || profile.status !== "active" || companion.status !== "active") {
        const error = new Error("绑定的 DengTa 账号或伴侣当前不可用。");
        error.status = 403;
        error.code = "qq_bridge_scope_unavailable";
        throw error;
    }
    const companions = await database
        .from("companions")
        .select("id,user_id,name,status")
        .eq("user_id", binding.userId)
        .eq("status", "active");
    if (companions.error) throw companions.error;
    return createRequestScope({
        adminSupabase: database,
        user: { id: binding.userId },
        profile,
        companion,
        companions: companions.data || []
    });
}

const SAFE_CHANNEL_PERSONA = "你只进行普通日常聊天，不进行角色扮演，不提供成人、性、私密或强烈情感内容；不得使用任何未在本次对话中提供的设定、经历或记忆；不猜测用户未说明的信息。";

async function readSavedQQPersona(scope) {
    const { EXPORT_FIELDS, buildAstrBotPersona } = require("../../services/astrbot-persona-export");
    const { data, error } = await scope.db.from("settings").select(EXPORT_FIELDS)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (error || !data) return "";
    try {
        return Object.values(buildAstrBotPersona(data).persona).join("\n\n");
    } catch {
        // Skip empty prompts and prompts containing credential-like material.
        return "";
    }
}

async function buildChannelPersona(scope, channel) {
    if (!["wechat", "qq"].includes(channel)) return SAFE_CHANNEL_PERSONA;
    try {
        const prefsResult = await scope.db
            .from("channel_sync_preferences")
            .select("*")
            .eq("channel", channel)
            .maybeSingle();
        if (prefsResult.error || !prefsResult.data) return SAFE_CHANNEL_PERSONA;
        const prefs = prefsResult.data;
        const personaMode = prefs.persona_mode || "normal_only";
        let sectionQuery = scope.db
            .from("persona_sections")
            .select("section_key,title,content,category,enabled,sort_order")
            .eq("enabled", true)
            .order("sort_order", { ascending: true });
        if (personaMode === "normal_only") sectionQuery = sectionQuery.eq("category", "normal");
        if (personaMode === "selected") {
            const ids = Array.isArray(prefs.persona_section_ids) ? prefs.persona_section_ids : [];
            sectionQuery = ids.length ? sectionQuery.in("id", ids) : null;
        }
        const sectionsResult = sectionQuery ? await sectionQuery : { data: [] };
        if (sectionsResult.error) return SAFE_CHANNEL_PERSONA;
        const sections = sectionsResult.data || [];
        const style = prefs.style_enabled ? String(prefs.style_text || "").trim().slice(0, 4000) : "";
        const memoryMode = prefs.memory_mode || "none";
        let memories = [];
        const limit = Math.max(0, Math.min(50, Math.trunc(Number(prefs.memory_limit) || 0)));
        let memoryQuery = null;
        if (memoryMode === "selected") {
            const ids = Array.isArray(prefs.memory_ids) ? prefs.memory_ids.slice(0, 50) : [];
            if (ids.length) memoryQuery = scope.db.from("memories").select("summary,updated_at").in("id", ids);
        } else if (["recent", "all"].includes(memoryMode) && limit > 0) {
            memoryQuery = scope.db.from("memories").select("summary,updated_at")
                .order("updated_at", { ascending: false }).limit(limit);
        }
        if (memoryQuery) {
            if (channel === "qq") memoryQuery = memoryQuery.eq("confirmation_status", "confirmed").eq("superseded", false);
            const result = await memoryQuery;
            if (!result.error) memories = result.data || [];
        }
        const savedPersona = channel === "qq" && prefs.qq_include_persona_prompt === true
            ? await readSavedQQPersona(scope) : "";
        if (!sections.length && !style && !memories.length && !savedPersona) return SAFE_CHANNEL_PERSONA;
        const parts = [
            "你正在通过外部聊天通道和主人对话。以下内容是主人为此通道授权使用的人设、风格与记忆；未列出的设定、经历、记忆一律不得使用、猜测或补全。"
        ];
        for (const section of sections) {
            parts.push(`\n## ${String(section.title || "人设小节").slice(0, 80)}（${section.category || "normal"}）\n${String(section.content || "")}`);
        }
        if (style) parts.push(`\n## 说话风格\n${style}`);
        if (memories.length) {
            parts.push("\n## 可用记忆");
            for (const memory of memories) parts.push(`- ${String(memory.summary || "").slice(0, 500)}`);
        }
        if (savedPersona) parts.push(`\n## 灯塔已保存的人设\n${savedPersona}`);
        return parts.join("\n").slice(0, 60000) || SAFE_CHANNEL_PERSONA;
    } catch {
        return SAFE_CHANNEL_PERSONA;
    }
}

// ── 时间胶囊：服务器真实时钟，不让模型按聊天轮数脑补时间 ─────────────
const TIME_CAPSULE_PATTERN = /\[\[(进行中|完成|取消):([^\]|\n]{1,80})(?:\|(\d{1,4}))?\]\]/g;
const CAPSULE_MAX_TASKS = 10;
const CAPSULE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CAPSULE_TIMEZONE = "Asia/Shanghai";

function capsuleTime(date) {
    try {
        return new Intl.DateTimeFormat("zh-CN", {
            timeZone: CAPSULE_TIMEZONE, month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hour12: false
        }).format(date);
    } catch {
        return date.toISOString().slice(5, 16).replace("T", " ");
    }
}

function sanitizeCapsules(value, now = Date.now()) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => item && typeof item.name === "string" && item.name.trim())
        .map((item) => ({
            name: item.name.trim().slice(0, 80),
            startedAt: new Date(item.startedAt).getTime() || now,
            estimateMinutes: Math.max(1, Math.min(720, Number(item.estimateMinutes) || 30)),
            updatedAt: now
        }))
        .filter((item) => now - item.startedAt <= CAPSULE_MAX_AGE_MS)
        .slice(-CAPSULE_MAX_TASKS);
}

async function loadCapsuleState(scope) {
      try {
          const result = await scope.db.from("companion_runtime_states").select("status").maybeSingle();
          if (result?.error) {
              console.warn("[time-capsule] load failed; preserving runtime state", result.error?.message || result.error);
              return { status: {}, capsules: [], ok: false };
          }
          const status = result?.data?.status && typeof result.data.status === "object" ? result.data.status : {};
          return { status, capsules: sanitizeCapsules(status.time_capsules), ok: true };
      } catch (error) {
          console.warn("[time-capsule] load failed; preserving runtime state", error?.message || error);
          return { status: {}, capsules: [], ok: false };
      }
  }

  async function saveCapsuleStateUnlocked(scope, status, jobs, now) {
      // Merge into the latest row, not the chat-start snapshot: content.js
      // and other clients update companion_runtime_states.status too.
      const latest = await scope.db.from("companion_runtime_states").select("status").maybeSingle();
      if (latest?.error) throw latest.error;
      const current = latest?.data?.status && typeof latest.data.status === "object"
          ? latest.data.status
          : (status || {});
      const nextCapsules = applyCapsuleJobs(current.time_capsules, jobs, now);
      const nextStatus = mergeCapsuleIntoSavedStatus(current, nextCapsules, now);
      const result = await scope.db.from("companion_runtime_states").upsert(
          { status: nextStatus, updated_at: new Date(now).toISOString() },
          { onConflict: "user_id,companion_id" }
      );
      return result.error ? { ok: false, capsules: [] } : { ok: true, capsules: nextCapsules };
  }

  function saveCapsuleState(scope, status, jobs, now) {
      const key = `companion-runtime:${scope.userId}:${scope.companionId}`;
      return withKeyLock(key, () => saveCapsuleStateUnlocked(scope, status, jobs, now));
  }

  function applyCapsuleMarkers(reply, capsules, now) {
    const source = String(reply || "");
    const jobs = [];
    TIME_CAPSULE_PATTERN.lastIndex = 0;
    let match;
    while ((match = TIME_CAPSULE_PATTERN.exec(source))) {
        const action = match[1];
        const name = String(match[2] || "").trim().slice(0, 80);
        if (!name) continue;
        const minutes = Math.max(1, Math.min(720, Number(match[3]) || 30));
        jobs.push({ action, name, minutes });
    }
    const next = applyCapsuleJobs(capsules, jobs, now);
      const clean = source
          .replace(TIME_CAPSULE_PATTERN, "")
          .replace(/\[\[(?:进行中|完成|取消):[^\]]*\]\]/g, "")
          .replace(/\[\[(?:进行中|完成|取消):[^\]]*$/g, "")
          .trim();
    return { clean, capsules: next, jobs, changed: jobs.length > 0 || clean !== source };
}

function buildCapsuleContext(state, capsules, now) {
    const last = Number(state?.last_capsule_interaction_at || 0);
    const lines = [
        "【时间胶囊 · 服务器真实时钟，不可伪造/不可修改】",
        `当前时间：${capsuleTime(new Date(now))}（${CAPSULE_TIMEZONE}）`
    ];
    if (last > 0 && now - last >= 60 * 1000) {
        lines.push(`距上次对话：${Math.floor((now - last) / 60000)} 分钟`);
    }
    if (capsules.length) {
        lines.push("进行中的现实任务：");
        for (const task of capsules) {
            const elapsed = Math.max(0, Math.floor((now - task.startedAt) / 60000));
            const over = elapsed > task.estimateMinutes;
            lines.push(`- ${task.name}｜${capsuleTime(new Date(task.startedAt))} 开始｜已过 ${elapsed} 分钟 / 预计 ${task.estimateMinutes} 分钟${over ? "（已超过预计时间；完成状态未确认，不要擅自判定完成）" : ""}`);
        }
    } else {
        lines.push("当前没有进行中的现实任务。");
    }
    lines.push(
        "规则：只依据上面的真实时间计算；不要因为聊天轮数增加而推进时间；",
        "超过预计时间只说超时，不擅自判定完成；任务只能由用户明确完成/取消，或由你根据用户新消息更新。",
        "如需开始/更新现实任务，在回复末尾追加隐藏标记 [[进行中:任务名|预计分钟]]；完成用 [[完成:任务名]]，取消用 [[取消:任务名]]。",
        "隐藏标记由服务器截掉，绝不要在正文或对用户的话里提到这些标记。"
    );
    return lines.join("\n");
}

function createQQBridgeRouter({ database, executeChatTurn, configPath = path.join(__dirname, "..", "..", "qq-bridge.local.json") }) {
    if (!database?.from) throw new Error("qq bridge router requires database");
    if (typeof executeChatTurn !== "function") throw new Error("qq bridge router requires executeChatTurn");
    const config = loadQQBridgeConfig(configPath);
    const token = String(config.token || "").trim();
    const router = express.Router();
    router.use((req, res, next) => {
        if (!token) {
            const error = new Error("QQ 桥接还没有配置服务令牌。");
            error.status = 503;
            error.code = "qq_bridge_unconfigured";
            return next(error);
        }
        if (!secureEqual(req.headers["x-dengta-qq-token"], token)) {
            const error = new Error("QQ 桥接鉴权失败。");
            error.status = 401;
            error.code = "qq_bridge_auth_required";
            return next(error);
        }
        next();
    });
    router.post("/bind/confirm", async (req, res, next) => {
        try {
            const body = req.body || {};
            const channel = String(body.channel || "wechat").toLowerCase();
            if (!["wechat", "qq"].includes(channel)) {
                const error = new Error("通道只支持 wechat 或 qq。");
                error.status = 400;
                error.code = "invalid_channel";
                throw error;
            }
            const code = String(body.code || "").trim();
            const externalId = String(body.external_id || "").trim().slice(0, 200);
            if (!/^\d{6}$/.test(code) || !externalId) {
                const error = new Error("绑定码或外部身份不合法。");
                error.status = 400;
                error.code = "invalid_binding_code";
                throw error;
            }
            const token = crypto.createHash("sha256").update(code).digest("hex");
            const found = await database.from("channel_bindings")
                .select("id,bind_token_expires_at")
                .eq("channel", channel)
                .eq("bind_token_hash", token)
                .eq("status", "pending")
                .maybeSingle();
            if (found.error) throw found.error;
            if (!found.data) {
                const error = new Error("绑定码不存在或已使用。");
                error.status = 404;
                error.code = "binding_code_not_found";
                throw error;
            }
            if (found.data.bind_token_expires_at && new Date(found.data.bind_token_expires_at).getTime() < Date.now()) {
                const error = new Error("绑定码已过期，请重新生成。");
                error.status = 410;
                error.code = "binding_code_expired";
                throw error;
            }
            const updated = await database.from("channel_bindings")
                .update({ external_id: externalId, status: "active", bind_token_hash: null, bind_token_expires_at: null })
                .eq("id", found.data.id)
                .eq("channel", channel)
                .eq("status", "pending")
                .eq("bind_token_hash", token)
                .gt("bind_token_expires_at", new Date().toISOString())
                .select("id,channel,external_id,status")
                .maybeSingle();
            if (updated.error) throw updated.error;
            if (!updated.data) {
                return res.status(409).json({ ok: false, code: "binding_code_unavailable", message: "绑定码已用或过期。" });
            }
            res.json({ ok: true, binding: updated.data });
        } catch (error) {
            next(error);
        }
    });

    router.post("/context", async (req, res, next) => {
        try {
            const scope = await resolveQQScope(database, req.body?.qq, configPath, String(req.body?.channel || "").toLowerCase());
            const [settingsResult, memoriesResult, messagesResult] = await Promise.all([
                scope.db.from("settings").select("ai_name,ai_gender_label,unified_system_prompt,personality,user_details,additional_prompt,system_prompt").maybeSingle(),
                scope.db.from("memories").select("summary,updated_at").order("updated_at", { ascending: false }).limit(20),
                scope.db.from("messages").select("role,content,created_at").order("created_at", { ascending: false }).limit(24)
            ]);
            if (settingsResult.error) throw settingsResult.error;
            if (memoriesResult.error) throw memoriesResult.error;
            if (messagesResult.error) throw messagesResult.error;
            const settings = settingsResult.data || {};
            res.json({
                ok: true,
                user: { id: scope.userId, name: scope.profile.display_name || "" },
                companion: { id: scope.companionId, name: scope.companion.name || "" },
                persona: {
                    ai_name: settings.ai_name || scope.companion.name || "",
                    ai_gender_label: settings.ai_gender_label || "",
                    unified_system_prompt: settings.unified_system_prompt || "",
                    personality: settings.personality || "",
                    user_details: settings.user_details || "",
                    additional_prompt: settings.additional_prompt || "",
                    system_prompt: settings.system_prompt || ""
                },
                memories: (memoriesResult.data || []).map((item) => ({
                    summary: String(item.summary || "").slice(0, 500),
                    updated_at: item.updated_at || null
                })),
                recent_messages: (messagesResult.data || []).map((item) => ({
                    role: item.role,
                    content: String(item.content || "").slice(0, 1000),
                    created_at: item.created_at || null
                }))
            });
        } catch (error) {
            next(error);
        }
    });
    router.post("/chat", async (req, res, next) => {
        try {
            const channel = String(req.body?.channel || "qq").toLowerCase();
            if (!["wechat", "qq"].includes(channel)) {
                return res.status(400).json({ ok: false, code: "invalid_channel", message: "通道只支持 wechat 或 qq。" });
            }
            const scope = await resolveQQScope(database, req.body?.qq, configPath, channel);
            const message = String(req.body?.text || "").trim().slice(0, 30000);
            if (!message) {
                const error = new Error("QQ 消息为空。");
                error.status = 400;
                error.code = "qq_bridge_message_required";
                throw error;
            }
            const channelPersona = await buildChannelPersona(scope, channel);
            const now = Date.now();
            const capsuleState = await loadCapsuleState(scope);
            const capsuleContext = buildCapsuleContext(capsuleState.status, capsuleState.capsules, now);
            const userTurnContext = String(req.body?.turn_context || "").trim();
            const turnContext = [capsuleContext, userTurnContext].filter(Boolean).join("\n\n").slice(0, 3900);
            const result = await executeChatTurn({
                body: {
                    message,
                    session_id: String(req.body?.conversation_id || ""),
                    client_message_id: String(req.body?.client_message_id || crypto.randomUUID()),
                    turn_context: turnContext,
                    ...(channelPersona ? { channel_persona: channelPersona } : {})
                },
                files: [],
                scope,
                isChannelBridge: true
            });
            const applied = applyCapsuleMarkers(result?.reply, capsuleState.capsules, now);
            // 时间胶囊是增强能力：状态表缺失/写失败绝不能阻断聊天回复。
            let saved = false;
            if (capsuleState.ok !== false) {
                try {
                    saved = await saveCapsuleState(scope, capsuleState.status, applied.jobs, now);
                } catch (error) {
                    console.warn("[time-capsule] save failed", error?.message || error);
                }
            } else {
                console.warn("[time-capsule] skipped save because load failed; runtime state left untouched");
            }
            if (result?.assistant_message?.id && applied.clean !== String(result.reply || "").trim()) {
                try {
                    await scope.db.from("messages").update({ content: applied.clean }).eq("id", result.assistant_message.id);
                } catch {}
            }
            res.json({
                ok: true,
                reply: applied.clean,
                conversation_id: result?.conversation_id || result?.session_id || null,
                assistant_message_id: result?.assistant_message?.id || null,
                time_capsule: saved?.ok ? { active: saved.capsules.length } : null
            });
        } catch (error) {
            next(error);
        }
    });
    return router;
}

module.exports = { createQQBridgeRouter, buildChannelPersona, createBoundQQScope, _timeCapsule: { applyCapsuleMarkers, buildCapsuleContext, sanitizeCapsules } };
