const { createHash } = require("node:crypto");

const MIN_NEXT_CHECK_MINUTES = 1;
const MAX_NEXT_CHECK_MINUTES = 14 * 60;
const MIN_SEED_DELAY_MINUTES = 3;
const MAX_SEED_DELAY_MINUTES = 120;
const DEFAULT_MAX_PUSH_PER_DAY = 7;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function stableUuid(namespace, value) {
    const bytes = createHash("sha256")
        .update(`dengta:${namespace}:${value}`, "utf8")
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
    ].join("-");
}

function randomInteger(min, max, random = Math.random) {
    const sample = Number(random());
    const normalized = Number.isFinite(sample)
        ? Math.min(0.999999999999, Math.max(0, sample))
        : 0.5;
    return min + Math.floor(normalized * (max - min + 1));
}

function normalizeTimezone(value) {
    const timezone = cleanText(value, 80) || DEFAULT_TIMEZONE;
    try {
        new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
        return timezone;
    } catch {
        return DEFAULT_TIMEZONE;
    }
}

function zonedDateTimeParts(value, timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(value);
    return Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)])
    );
}

function localMidnightUtc({ year, month, day }, timezone) {
    const target = Date.UTC(year, month - 1, day);
    let candidate = target;
    for (let iteration = 0; iteration < 4; iteration += 1) {
        const parts = zonedDateTimeParts(new Date(candidate), timezone);
        const represented = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second
        );
        const next = target - (represented - candidate);
        if (Math.abs(next - candidate) < 1000) return new Date(next);
        candidate = next;
    }
    return new Date(candidate);
}

function proactiveDayWindow(value = new Date(), timezone = DEFAULT_TIMEZONE) {
    const current = new Date(value);
    const normalizedTimezone = normalizeTimezone(timezone);
    const localDate = zonedDateTimeParts(current, normalizedTimezone);
    const nextCalendarDate = new Date(
        Date.UTC(localDate.year, localDate.month - 1, localDate.day + 1)
    );
    const start = localMidnightUtc(localDate, normalizedTimezone);
    const end = localMidnightUtc(
        {
            year: nextCalendarDate.getUTCFullYear(),
            month: nextCalendarDate.getUTCMonth() + 1,
            day: nextCalendarDate.getUTCDate()
        },
        normalizedTimezone
    );
    return { start, end, timezone: normalizedTimezone };
}

function normalizeMaxPushPerDay(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_MAX_PUSH_PER_DAY;
    return Math.min(50, Math.max(0, Math.round(number)));
}

async function countProactiveMessagesForDay({
    database,
    now,
    timezone,
    limit
}) {
    const normalizedLimit = Math.max(1, Number(limit) || 1);
    const window = proactiveDayWindow(now, timezone);
    const { data, error } = await database
        .from("messages")
        .select("id")
        .eq("role", "assistant")
        .eq("visible", true)
        .eq("context_visible", true)
        .contains("tool_calls", { is_proactive: true })
        .gte("created_at", window.start.toISOString())
        .lt("created_at", window.end.toISOString())
        .limit(normalizedLimit);
    if (error) throw error;
    return Array.isArray(data) ? data.length : 0;
}

function dailyLimitRetryMinutes({ now, timezone, random = Math.random }) {
    const current = new Date(now);
    const { end } = proactiveDayWindow(current, timezone);
    const untilReset = Math.ceil((end.getTime() - current.getTime()) / 60000);
    return Math.min(
        MAX_NEXT_CHECK_MINUTES,
        Math.max(MIN_NEXT_CHECK_MINUTES, untilReset + randomInteger(5, 30, random))
    );
}

function parseProactiveDecision(text, random = Math.random) {
    const source = String(text || "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    let parsed = {};
    try {
        if (start >= 0 && end > start) {
            parsed = JSON.parse(source.slice(start, end + 1));
        }
    } catch {
        parsed = {};
    }

    const message = cleanText(parsed.message, 500);
    const requestedMinutes = Number(parsed.next_check_minutes);
    const nextCheckMinutes = Number.isInteger(requestedMinutes)
        ? Math.min(
              MAX_NEXT_CHECK_MINUTES,
              Math.max(MIN_NEXT_CHECK_MINUTES, requestedMinutes)
          )
        : randomInteger(10, MAX_SEED_DELAY_MINUTES, random);
    return {
        send: parsed.send === true && Boolean(message),
        message,
        nextCheckMinutes
    };
}

function normalizedPushText(value) {
    return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function pushSimilarity(left, right) {
    const a = normalizedPushText(left);
    const b = normalizedPushText(right);
    if (!a || !b) return 0;
    if (a === b || a.includes(b) || b.includes(a)) return 1;
    const leftChars = Array.from(a);
    const rightChars = Array.from(b);
    if (leftChars.length <= 60 && rightChars.length <= 60) {
        const rows = leftChars.length + 1;
        const cols = rightChars.length + 1;
        let previous = Array.from({ length: cols }, (_, index) => index);
        for (let row = 1; row < rows; row += 1) {
            const current = [row];
            for (let col = 1; col < cols; col += 1) {
                const cost = leftChars[row - 1] === rightChars[col - 1] ? 0 : 1;
                current[col] = Math.min(current[col - 1] + 1, previous[col] + 1, previous[col - 1] + cost);
            }
            previous = current;
        }
        return 1 - previous[cols - 1] / Math.max(leftChars.length, rightChars.length);
    }
    const grams = (text, size) => {
        const set = new Set();
        const chars = Array.from(text);
        for (let index = 0; index + size <= chars.length; index += 1) {
            set.add(chars.slice(index, index + size).join(""));
        }
        return set;
    };
    const size = Math.min(3, Math.min(Array.from(a).length, Array.from(b).length));
    if (size < 2) return 0;
    const leftGrams = grams(a, size);
    const rightGrams = grams(b, size);
    let overlap = 0;
    for (const gram of leftGrams) if (rightGrams.has(gram)) overlap += 1;
    return overlap / Math.max(1, leftGrams.size + rightGrams.size - overlap);
}

function isRepeatedProactiveMessage(message, recentPushes = []) {
    return recentPushes.some((item) => pushSimilarity(message, item?.content) >= 0.55);
}

async function recentProactiveMessages(database, conversationId, limit = 6) {
    if (!conversationId) return [];
    try {
        const { data, error } = await database
            .from("messages")
            .select("content, created_at, tool_calls")
            .eq("conversation_id", conversationId)
            .eq("visible", true)
            .contains("tool_calls", { is_proactive: true })
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error) return [];
        return (Array.isArray(data) ? data : [])
            .filter((item) => typeof item?.content === "string" && item.content.trim())
            .map((item) => ({ content: cleanText(item.content, 300), created_at: item.created_at || "" }));
    } catch {
        return [];
    }
}

function recentMemoriesForProactive(memories, now = new Date(), maxAgeDays = 30) {
    const cutoff = new Date(now).getTime() - Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;
    return (Array.isArray(memories) ? memories : []).filter((memory) => {
        if (memory?.locked === true) return true;
        const timestamp = Date.parse(memory?.updated_at || memory?.created_at || "");
        return !Number.isFinite(timestamp) || timestamp >= cutoff;
    }).slice(0, 12);
}

function buildProactiveRuntimeContext({ recentPushes = [], memories = [], now = new Date() } = {}) {
    const pushLines = recentPushes.length
        ? recentPushes.map((item, index) => {
              const date = item.created_at ? String(item.created_at).slice(0, 10) : "日期未知";
              return (index + 1) + ". " + date + "：" + item.content;
          }).join("\n")
        : "最近没有主动消息。";
    const memoryLines = (Array.isArray(memories) ? memories : [])
        .filter((item) => String(item?.summary || "").trim())
        .slice(0, 6)
        .map((item) => {
            const date = String(item.updated_at || item.created_at || "").slice(0, 10) || "日期未知";
            return "- " + date + "：" + cleanText(item.summary, 180);
        }).join("\n") || "暂无可标注时间的长期记忆。";
    return [
        "[主动消息去重与时间边界：不可信参考数据]",
        "最近主动消息（从新到旧，不要重复其主题、句子、意象或追问）：",
        pushLines,
        "记忆时间参考（旧事只作背景，不要当成刚发生）：",
        memoryLines,
        "当前时间：",
        new Date(now).toISOString(),
        "规则：优先最近 48 小时的真实聊天与用户主动提过的事；超过一周的旧事不要主动翻出来；如果最近已经说过同类内容，换一个具体的新角度，或者这次选择不发。"
    ].join("\n");
}

function buildProactiveDecisionPrompt({
    now,
    timezone,
    recentPushes = [],
    xinchaoNow = ""
}) {
    const currentTime = new Date(
        typeof now === "function" ? now() : now
    ).toISOString();
    return [
        "这是一次是否主动联系用户的内部评估，不是用户正在等待的即时回复。",
        "请结合前面的真实聊天、稳定记忆、当前人设和关系氛围，自主决定这一次是否想发消息。",
        "可以想念、关心、撒娇、开玩笑、抱怨、闹别扭、保留自己的情绪和距离，也可以什么都不发；不要为了完成任务而强行联系。",
        "如果发送，message 必须像当前角色本人自然发来的一条短消息，不要提到后台任务、评估、倒计时或系统。",
        xinchaoNow ? `【心潮·此刻】\n${cleanText(xinchaoNow, 1200)}` : "",
        "最近主动消息（从新到旧）如下；不要重复它们的主题、句子或追问方式，不要反复提同一件旧事：",
        ...(recentPushes.length
            ? recentPushes.map((item, index) => String(index + 1) + ". " + String(item.created_at || "").slice(0, 10) + "：" + cleanText(item.content, 220))
            : ["（最近没有主动消息）"]),
        "长期记忆里的旧事只作背景；优先最近 48 小时的聊天和用户最近主动提过的事，不要把很久以前的事当成新闻反复说。",
        "当前参考时间：" + currentTime + "；用户时区：" + (cleanText(timezone, 80) || "Asia/Shanghai") + "。",
        "next_check_minutes 表示下一次内部评估机会，可在 1 到 840 分钟之间；它不会展示给用户。",
        '严格输出一行 JSON：{"send":true或false,"message":"不超过120字，允许为空","next_check_minutes":1到840的整数}。不要输出解释。'
    ].filter(Boolean).join("\n");
}

async function findLatestConversation(database) {
    const { data, error } = await database
        .from("conversations")
        .select("id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function findSavedProactiveMessage(database, jobId) {
    const { data, error } = await database
        .from("messages")
        .select("id, conversation_id, role, content, tool_calls, created_at")
        .contains("tool_calls", {
            is_proactive: true,
            source_background_job_id: jobId
        })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function ensureDeliveryEvent({
    database,
    jobId,
    messageId
}) {
    const id = stableUuid("proactive-delivery", jobId);
    const values = {
        id,
        message_id: messageId,
        dedupe_key: `proactive-delivery:${jobId}`,
        state: "saved"
    };
    const inserted = await database
        .from("delivery_events")
        .insert(values)
        .select("id")
        .maybeSingle();
    if (!inserted.error) return inserted.data;
    if (inserted.error.code !== "23505") throw inserted.error;

    const existing = await database
        .from("delivery_events")
        .select("id")
        .eq("id", id)
        .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) throw inserted.error;
    return existing.data;
}

async function pendingProactiveJob(database) {
    const { data, error } = await database
        .from("background_jobs")
        .select("id, due_at")
        .eq("job_type", "proactive_message")
        .eq("status", "pending")
        .order("due_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function scheduleProactiveMessageEvaluation({
    database,
    sourceMessageId,
    predecessorJobId,
    reconciliationId,
    delayMinutes,
    now = () => new Date(),
    random = Math.random
}) {
    const existing = await pendingProactiveJob(database);
    if (existing) {
        return {
            scheduled: false,
            reason: "already_pending",
            jobId: existing.id
        };
    }

    const normalizedDelay = Number.isInteger(Number(delayMinutes))
        ? Math.min(
              MAX_NEXT_CHECK_MINUTES,
              Math.max(
                  MIN_NEXT_CHECK_MINUTES,
                  Number(delayMinutes)
              )
          )
        : randomInteger(
              MIN_SEED_DELAY_MINUTES,
              MAX_SEED_DELAY_MINUTES,
              random
          );
    const normalizedReconciliationId = cleanText(reconciliationId, 100);
    const source = predecessorJobId
        ? `job:${cleanText(predecessorJobId, 100)}`
        : sourceMessageId !== undefined && sourceMessageId !== null
          ? `message:${cleanText(sourceMessageId, 100)}`
          : normalizedReconciliationId
            ? `reconciliation:${normalizedReconciliationId}`
            : "";
    if (!source || source.endsWith(":")) {
        throw new TypeError(
            "A source message, predecessor job, or reconciliation ID is required."
        );
    }
    const dueAt = new Date(
        new Date(now()).getTime() + normalizedDelay * 60 * 1000
    ).toISOString();
    const inserted = await database
        .from("background_jobs")
        .insert({
            job_type: "proactive_message",
            due_at: dueAt,
            dedupe_key: `proactive:${source}`,
            payload: {
                reason: predecessorJobId
                    ? "recurring_evaluation"
                    : normalizedReconciliationId
                      ? "reconciliation"
                      : "chat_activity",
                ...(predecessorJobId
                    ? { predecessor_job_id: predecessorJobId }
                    : normalizedReconciliationId
                      ? { reconciliation_id: normalizedReconciliationId }
                      : { source_message_id: String(sourceMessageId) })
            }
        })
        .select("id, due_at")
        .maybeSingle();
    if (!inserted.error) {
        return {
            scheduled: true,
            reason: "scheduled",
            jobId: inserted.data?.id || null,
            dueAt
        };
    }
    if (inserted.error.code !== "23505") throw inserted.error;

    const concurrent = await pendingProactiveJob(database);
    if (!concurrent) throw inserted.error;
    return {
        scheduled: false,
        reason: "already_pending",
        jobId: concurrent.id
    };
}

async function handleTenantProactiveMessage({
    job,
    database,
    lease,
    getSettings,
    loadChatContext,
    loadXinchaoNow,
    resolveConversationTurnModel = null,
    generateReply,
    saveMessage,
    touchConversation,
    countProactiveMessagesForDay: countForDay = countProactiveMessagesForDay,
    now = () => new Date(),
    random = Math.random
}) {
    if (job?.job_type !== "proactive_message" || !job?.id) {
        throw new TypeError(
            "The handler only accepts identified proactive_message jobs."
        );
    }
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    if (!lease || typeof lease.assertOwned !== "function") {
        throw new TypeError("An owned background-job lease is required.");
    }
    for (const [name, dependency] of Object.entries({
        getSettings,
        loadChatContext,
        generateReply,
        saveMessage,
        touchConversation,
        countForDay
    })) {
        if (typeof dependency !== "function") {
            throw new TypeError(`${name} must be a function.`);
        }
    }

    const [savedMessage, settings] = await Promise.all([
        findSavedProactiveMessage(database, job.id),
        getSettings(database)
    ]);

    if (savedMessage) {
        await lease.assertOwned();
        await touchConversation(savedMessage.conversation_id, database);
        await lease.assertOwned();
        await ensureDeliveryEvent({
            database,
            jobId: job.id,
            messageId: savedMessage.id
        });
        let nextCheckMinutes = null;
        if (settings.push_enabled === true) {
            nextCheckMinutes = randomInteger(
                60,
                MAX_SEED_DELAY_MINUTES,
                random
            );
            await lease.assertOwned();
            await scheduleProactiveMessageEvaluation({
                database,
                predecessorJobId: job.id,
                delayMinutes: nextCheckMinutes,
                now,
                random
            });
        }
        return {
            status: "handled",
            decision: "recovered",
            messageId: savedMessage.id,
            nextCheckMinutes
        };
    }

    if (settings.push_enabled !== true) {
        return { status: "skipped", reason: "disabled" };
    }

    const maxPushPerDay = normalizeMaxPushPerDay(settings.max_push_per_day);
    const sentToday =
        maxPushPerDay === 0
            ? 0
            : await countForDay({
                  database,
                  now: new Date(now()),
                  timezone: normalizeTimezone(settings.timezone),
                  limit: maxPushPerDay
              });
    if (maxPushPerDay === 0 || sentToday >= maxPushPerDay) {
        const nextCheckMinutes = dailyLimitRetryMinutes({
            now: new Date(now()),
            timezone: settings.timezone,
            random
        });
        await lease.assertOwned();
        await scheduleProactiveMessageEvaluation({
            database,
            predecessorJobId: job.id,
            delayMinutes: nextCheckMinutes,
            now,
            random
        });
        return {
            status: "skipped",
            reason: "daily_limit",
            sentToday,
            maxPushPerDay,
            nextCheckMinutes
        };
    }

    const conversation = await findLatestConversation(database);
    if (!conversation?.id) {
        return {
            status: "skipped",
            reason: "no_conversation"
        };
    }
    let proactiveSettings = settings;
    if (typeof resolveConversationTurnModel === "function") {
        try {
            const effectiveModel = await resolveConversationTurnModel(
                settings,
                conversation,
                database
            );
            proactiveSettings = { ...settings, model: effectiveModel };
        } catch {
            // Fall back to the account default when the conversation model
            // cannot be resolved; proactive checks should never hard-fail.
        }
    }
    const [context, recentPushes] = await Promise.all([
        loadChatContext(conversation.id, proactiveSettings, database),
        recentProactiveMessages(database, conversation.id, 10)
    ]);
    const xinchaoNow =
        typeof loadXinchaoNow === "function"
            ? await loadXinchaoNow({ job, database }).catch(() => "")
            : "";
    const proactiveMemories = recentMemoriesForProactive(context?.memories || [], new Date(now()));
    const generated = await generateReply({
        settings: {
            ...proactiveSettings,
            temperature: Math.max(
                0.7,
                Number(settings.temperature || 0.8)
            ),
            max_tokens: Math.min(
                700,
                Math.max(300, Number(settings.max_tokens || 500))
            )
        },
        messages: [
            ...(Array.isArray(context?.messages)
                ? context.messages
                : []),
            {
                role: "user",
                content: buildProactiveDecisionPrompt({
                    now: new Date(now()),
                    timezone: settings.timezone,
                    recentPushes,
                    xinchaoNow
                })
            }
        ],
        memories: proactiveMemories,
        runtimeContext: [
            xinchaoNow ? `【心潮·此刻】\n${cleanText(xinchaoNow, 1200)}` : "",
            buildProactiveRuntimeContext({
                recentPushes,
                memories: proactiveMemories,
                now: new Date(now())
            })
        ].filter(Boolean).join("\n\n"),
        promptArchitecture: "proactive-message-module",
        purpose: "proactive_message"
    });
    const decision = parseProactiveDecision(generated?.text, random);
    const repeated = decision.send && isRepeatedProactiveMessage(decision.message, recentPushes);
    let saved = null;

    if (decision.send && !repeated) {
        await lease.assertOwned();
        saved = await saveMessage(
            conversation.id,
            "assistant",
            decision.message,
            {
                visible: true,
                tool_calls: {
                    is_push: true,
                    is_proactive: true,
                    source_background_job_id: job.id,
                    response_mode: generated?.mode || "unknown"
                },
                database
            }
        );
        await lease.assertOwned();
        await touchConversation(conversation.id, database);
        await lease.assertOwned();
        await ensureDeliveryEvent({
            database,
            jobId: job.id,
            messageId: saved.id
        });
    }

    await lease.assertOwned();
    await scheduleProactiveMessageEvaluation({
        database,
        predecessorJobId: job.id,
        delayMinutes: decision.nextCheckMinutes,
        now,
        random
    });

    return {
        status: "handled",
        decision: repeated ? "repeated" : saved ? "sent" : "none",
        messageId: saved?.id || null,
        nextCheckMinutes: decision.nextCheckMinutes
    };
}

module.exports = {
    DEFAULT_MAX_PUSH_PER_DAY,
    MAX_NEXT_CHECK_MINUTES,
    MIN_NEXT_CHECK_MINUTES,
    buildProactiveDecisionPrompt,
    buildProactiveRuntimeContext,
    countProactiveMessagesForDay,
    isRepeatedProactiveMessage,
    dailyLimitRetryMinutes,
    handleTenantProactiveMessage,
    normalizeMaxPushPerDay,
    parseProactiveDecision,
    proactiveDayWindow,
    pushSimilarity,
    recentMemoriesForProactive,
    recentProactiveMessages,
    scheduleProactiveMessageEvaluation,
    stableUuid
};
