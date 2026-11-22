const crypto = require("node:crypto");
const { promptContainsLikelySecret } = require("./prompt-security");
const { redactCredentialLikeText } = require("./ai-service");
const { buildChannelPersona, createBoundQQScope } = require("../routes/v2/qq-bridge");

const QR_LIFETIME = 3 * 60_000;
const PAIR_LIFETIME = 15 * 60_000;
const LEASE_LIFETIME = 45_000;
const TICK_INTERVAL = 8_000;
const BOT_TABLE = "qq_cloud_connections";
const RECEIPT_TABLE = "qq_cloud_receipts";
const STATUS_FIELDS = "id,stage,pair_nonce,pair_expires_at,online,lease_until";

function fail(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

function unpack(result) {
    if (result.error) throw result.error;
    return result.data;
}

function bindingCode(key, row) {
    const bytes = crypto.createHmac("sha256", key).update(`pair:${row.id}:${row.pair_nonce}`).digest();
    const digits = (bytes.readBigUInt64BE(0) % 1_000_000_000_000n).toString().padStart(12, "0");
    return "灯塔绑定 " + digits;
}

function credentialAad(row) {
    return JSON.stringify([row.id, row.user_id, row.companion_id, row.app_id]);
}

function qqMessageUuid(connectionId, messageId) {
    const bytes = crypto.createHash("sha256").update(connectionId + ":" + messageId).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function encryptCredential(key, row, secret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(credentialAad(row)));
    const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

function decryptCredential(key, row) {
    const raw = Buffer.from(row.app_secret_encrypted, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(credentialAad(row)));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

async function startTencentQr(callbacks, source) {
    const { startQrConnect } = await import("@tencent-connect/qqbot-connector");
    return startQrConnect(callbacks, {
        source, displayQrCodeToConsole: false
    });
}

async function createTencentBot({ appId, appSecret }) {
    const { QQBot } = await import("@tencent-connect/qqbot-nodejs");
    return new QQBot({
        appId,
        appSecret,
        // GROUP_AND_C2C_EVENT, also required for C2C. Group messages are dropped below.
        intents: 1 << 25,
        reconnect: { maxAttempts: 6 }
    });
}

function createQQCloudService({
    database, executeChatTurn, env = process.env, now = Date.now,
    startQr = startTencentQr, createBot = createTencentBot,
    makeQrImage = (url) => require("qrcode").toDataURL(url, { width: 232, margin: 2 }),
    createScope = createBoundQQScope, channelPersona = buildChannelPersona
}) {
    const key = Buffer.from(env.QQ_CLOUD_ENCRYPTION_KEY || "", "base64");
    const enabled = env.QQ_CLOUD_ENABLED === "true" && key.length === 32;
    const source = env.QQ_CLOUD_TENCENT_SOURCE || "";
    const worker = crypto.randomUUID();
    const maxConnections = Math.max(1, Math.min(200, Math.trunc(Number(env.QQ_CLOUD_MAX_CONNECTIONS) || 50)));
    const pending = new Map();
    const online = new Map();
    let timer;
    let tickRunning = false;
    let stopping = false;
    let inFlight = 0;
    let nextCleanup = 0;
    const iso = (time = now()) => new Date(time).toISOString();
    const scopeKey = ({ userId, companionId }) => `${userId}:${companionId}`;
    const byScope = (query, scope) => query.eq("user_id", scope.userId).eq("companion_id", scope.companionId);
    const ownerRow = (scope) => byScope(database.from(BOT_TABLE).select(STATUS_FIELDS), scope).maybeSingle();
    const ownedByWorker = (query, id) => query.eq("id", id).eq("lease_owner", worker).gt("lease_until", iso());

    function disposeJob(job) {
        job.cancelled = true;
        job.stop?.();
        clearTimeout(job.timer);
    }

    async function status(scope) {
        if (!enabled) return { enabled: false, state: "unavailable" };
        const row = unpack(await ownerRow(scope));
        if (row) return {
            enabled: true,
            state: row.stage,
            online: row.online === true && Date.parse(row.lease_until) > now(),
            pair_code: row.stage === "awaiting_owner" && Date.parse(row.pair_expires_at) > now()
                ? bindingCode(key, row) : null
        };
        const job = pending.get(scopeKey(scope));
        if (!job || now() >= job.deadline) return { enabled: true, state: "disconnected" };
        return { enabled: true, state: job.state, qr_image: job.image, qr_url: job.url };
    }

    function assertEnabled() {
        if (!enabled || stopping) throw fail(503, "qq_cloud_unavailable", "QQ 云接入暂未开放。");
    }

    async function begin(scope) {
        assertEnabled();
        if (unpack(await ownerRow(scope))) return status(scope);
        const id = scopeKey(scope);
        const prior = pending.get(id);
        if (prior && ["scanning", "saving"].includes(prior.state)) return status(scope);
        if (prior) {
            disposeJob(prior);
            pending.delete(id);
        }
        if (pending.size >= 100) throw fail(429, "qq_cloud_busy", "正在扫码的人较多，请稍后重试。");
        const job = { state: "scanning", deadline: now() + QR_LIFETIME, qrRevision: 0 };
        pending.set(id, job);
        job.timer = setTimeout(() => {
            disposeJob(job);
            pending.delete(id);
        }, QR_LIFETIME);
        job.timer.unref?.();
        try {
            job.stop = await startQr({
                async onQrDisplayed(url) {
                    const revision = ++job.qrRevision;
                    try {
                        const parsed = new URL(url);
                        if (parsed.origin !== "https://q.qq.com" || parsed.pathname !== "/qqbot/openclaw/connect.html") {
                            throw new Error("Unexpected Tencent QR URL");
                        }
                        const image = await makeQrImage(url);
                        if (!job.cancelled && pending.get(id) === job && job.state === "scanning" && revision === job.qrRevision) {
                            job.url = url;
                            job.image = image;
                        }
                    } catch {
                        if (!job.cancelled) job.state = "failed";
                    }
                },
                onQrExpired() {
                    job.qrRevision += 1;
                    delete job.url;
                    delete job.image;
                },
                async onSuccess(credentials) {
                    if (job.cancelled || pending.get(id) !== job || job.state !== "scanning") return;
                    job.state = "saving";
                    delete job.url;
                    delete job.image;
                    try {
                        const { appId, appSecret, userOpenid } = credentials?.[0] || {};
                        if (credentials?.length !== 1 || !/^\d{5,32}$/.test(String(appId)) ||
                            typeof appSecret !== "string" || !appSecret || appSecret.length > 512) {
                            throw new Error("Invalid Tencent bot credentials");
                        }
                        const owner = typeof userOpenid === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(userOpenid)
                            ? userOpenid : null;
                        const row = {
                            id: crypto.randomUUID(), user_id: scope.userId, companion_id: scope.companionId,
                            app_id: String(appId), stage: owner ? "active" : "awaiting_owner", qq_owner: owner,
                            pair_nonce: owner ? null : crypto.randomUUID(),
                            pair_expires_at: owner ? null : iso(now() + PAIR_LIFETIME)
                        };
                        row.app_secret_encrypted = encryptCredential(key, row, appSecret);
                        const result = await database.from(BOT_TABLE).insert(row);
                        if (result.error?.code === "23505") {
                            job.state = "already_linked";
                            return;
                        }
                        unpack(result);
                        if (job.cancelled || pending.get(id) !== job) {
                            await database.from(BOT_TABLE).delete().eq("id", row.id);
                            return;
                        }
                        disposeJob(job);
                        pending.delete(id);
                        void tick();
                    } catch {
                        if (!job.cancelled) job.state = "failed";
                    }
                },
                onFailure() {
                    if (!job.cancelled && job.state === "scanning") job.state = "failed";
                }
            }, source);
            if (job.cancelled) job.stop();
        } catch {
            job.state = "failed";
        }
        return status(scope);
    }

    async function resetPairCode(scope) {
        assertEnabled();
        unpack(await byScope(database.from(BOT_TABLE).update({
            pair_nonce: crypto.randomUUID(), pair_expires_at: iso(now() + PAIR_LIFETIME)
        }), scope).eq("stage", "awaiting_owner"));
        return status(scope);
    }

    async function disconnect(scope) {
        assertEnabled();
        const id = scopeKey(scope);
        const job = pending.get(id);
        if (job) {
            pending.delete(id);
            disposeJob(job);
        }
        const rows = unpack(await byScope(database.from(BOT_TABLE).delete(), scope).select("id"));
        for (const row of rows || []) online.get(row.id)?.bot.stop();
        return { enabled: true, state: "disconnected" };
    }

    async function markOnline(id, ready) {
        unpack(await ownedByWorker(database.from(BOT_TABLE).update({ online: ready }), id));
    }

    async function handleMessage(entry, msg) {
        const target = msg.replyTarget;
        if (stopping || entry.busy || msg.kind !== "c2c" || target?.scope !== "c2c" ||
            !target.msgId || target.msgId.length > 200 || !target.targetId || target.targetId.length > 160) return;
        const text = typeof msg.content === "string" ? msg.content.trim() : "";
        if (!text || msg.attachments?.length || text.length > 4000) return;
        entry.busy = true;
        try {
            const row = unpack(await ownedByWorker(database.from(BOT_TABLE).select(
                "id,user_id,companion_id,stage,pair_nonce,pair_expires_at,qq_owner,conversation_id"
            ), entry.id).maybeSingle());
            if (!row) return;
            if (row.stage === "awaiting_owner") {
                if (Date.parse(row.pair_expires_at) <= now() || text !== bindingCode(key, row)) return;
                const paired = unpack(await ownedByWorker(database.from(BOT_TABLE).update({
                    stage: "active", qq_owner: target.targetId, pair_nonce: null, pair_expires_at: null
                }), entry.id).eq("stage", "awaiting_owner").eq("pair_nonce", row.pair_nonce)
                    .gt("pair_expires_at", iso()).select("id").maybeSingle());
                if (paired) await entry.bot.sendText(target, "灯塔接上啦。现在可以在这个私聊里和我聊天。");
                return;
            }
            if (row.qq_owner !== target.targetId || inFlight >= 12 || now() < entry.nextTurn) return;
            inFlight += 1;
            try {
                const receipt = await database.from(RECEIPT_TABLE).insert({ connection_id: row.id, message_id: target.msgId });
                if (receipt.error?.code === "23505") return;
                unpack(receipt);
                entry.nextTurn = now() + 2000;
                const memoryCommand = /^记住\s*[:：]\s*([\s\S]*)$/.exec(text);
                if (memoryCommand) {
                    const summary = memoryCommand[1].trim();
                    let reply = "请在「灯塔 → QQ → 人设与记忆」开启 QQ 记忆候选。";
                    if (!summary || Array.from(summary).length > 500 || promptContainsLikelySecret(summary)) {
                        reply = "请填写 1 到 500 个字的记忆内容，避开密码、密钥和令牌。";
                    } else {
                        try {
                            const queued = unpack(await database.rpc("queue_qq_memory_candidate", {
                                p_connection_id: row.id, p_worker_id: worker, p_owner: target.targetId,
                                p_id: qqMessageUuid(row.id, target.msgId), p_summary: summary
                            }));
                            if (queued) reply = "收到。约 5 分钟后可在灯塔的「QQ 记忆候选」中确认。";
                        } catch {
                            reply = "这次没有提交成功，请稍后重试。";
                        }
                    }
                    const active = unpack(await ownedByWorker(database.from(BOT_TABLE).select("id"), entry.id)
                        .eq("stage", "active").eq("qq_owner", target.targetId).maybeSingle());
                    if (active && !stopping) await entry.bot.sendText(target, reply);
                    return;
                }
                let result;
                try {
                    const scope = await createScope(database, { userId: row.user_id, companionId: row.companion_id });
                    result = await executeChatTurn({
                        body: {
                            message: text, session_id: row.conversation_id || "",
                            client_message_id: qqMessageUuid(row.id, target.msgId),
                            channel_persona: await channelPersona(scope, "qq")
                        },
                        files: [], scope, isChannelBridge: true, isQQCloud: true
                    });
                } catch {
                    console.warn("[qq-cloud] chat generation failed");
                }
                const stillActive = unpack(await ownedByWorker(database.from(BOT_TABLE).update({
                    conversation_id: result?.conversation_id || result?.session_id || row.conversation_id
                }), entry.id).eq("stage", "active").eq("qq_owner", target.targetId).select("id").maybeSingle());
                const reply = typeof result?.reply === "string" ? result.reply.trim().slice(0, 1000) : "";
                if (stillActive && !stopping) {
                    await entry.bot.sendText(target, reply || "灯塔这次没接上模型，等一会儿再发一条吧。");
                }
            } finally {
                inFlight -= 1;
            }
        } finally {
            entry.busy = false;
        }
    }

    async function launch(row) {
        const bot = await createBot({ appId: row.app_id, appSecret: decryptCredential(key, row) });
        if (stopping) return bot.stop();
        const entry = { bot, id: row.id, nextTurn: 0 };
        online.set(row.id, entry);
        const updateOnline = (ready) => void markOnline(row.id, ready).catch(() => {});
        bot.on("ready", () => updateOnline(true));
        bot.on("resumed", () => updateOnline(true));
        bot.on("disconnected", () => updateOnline(false));
        bot.on("error", () => {});
        bot.on("message", (_ctx, message) => handleMessage(entry, message).catch(() => {}));
        void Promise.resolve().then(() => bot.start()).catch(() => {}).finally(() => {
            online.delete(row.id);
            void markOnline(row.id, false).catch(() => {});
        });
    }

    async function tick() {
        if (!enabled || tickRunning || stopping) return;
        tickRunning = true;
        try {
            const ids = [...online.keys()];
            const lease_until = iso(now() + LEASE_LIFETIME);
            if (ids.length) {
                const renewed = unpack(await database.from(BOT_TABLE).update({ lease_until })
                    .in("id", ids).eq("lease_owner", worker).gt("lease_until", iso()).select("id"));
                const kept = new Set(renewed.map((row) => row.id));
                for (const id of ids) if (!kept.has(id)) online.get(id)?.bot.stop();
            }
            const remaining = maxConnections - online.size;
            if (remaining > 0) {
                const claimable = `lease_until.is.null,lease_until.lt.${iso()}`;
                const rows = unpack(await database.from(BOT_TABLE).select("id").or(claimable)
                    .order("id", { ascending: true }).limit(remaining));
                for (const { id } of rows) {
                    if (stopping) break;
                    const row = unpack(await database.from(BOT_TABLE).update({ lease_owner: worker, lease_until, online: false })
                        .eq("id", id).or(claimable).select("id,user_id,companion_id,app_id,app_secret_encrypted").maybeSingle());
                    if (row) await launch(row).catch(() => {});
                }
            }
            if (now() >= nextCleanup) {
                nextCleanup = now() + 60 * 60_000;
                await database.from(RECEIPT_TABLE).delete().lt("created_at", iso(now() - 24 * 60 * 60_000));
            }
        } catch {
            // Stop a socket if database authorization or lease renewal cannot be checked.
            for (const entry of online.values()) entry.bot.stop();
            console.warn("[qq-cloud] gateway sync failed");
        } finally {
            tickRunning = false;
        }
    }

    function start() {
        if (!enabled || timer) return;
        timer = setInterval(() => void tick(), TICK_INTERVAL);
        timer.unref?.();
        void tick();
    }

    async function stop() {
        stopping = true;
        clearInterval(timer);
        for (const job of pending.values()) disposeJob(job);
        pending.clear();
        for (const entry of online.values()) entry.bot.stop();
        if (enabled) {
            await database.from(BOT_TABLE).update({ lease_owner: null, lease_until: null, online: false })
                .eq("lease_owner", worker);
        }
    }

    return { status, begin, resetPairCode, disconnect, start, stop };
}

function buildQQCloudSystemInstructions(channelPersona) {
    return [
        "当前是已绑定用户的 QQ 文字私聊。用自然、简洁的口吻回复，只使用本段对话与下方提供的资料。没有相关记忆时，直接说明这一点，不推断其他渠道聊过什么。",
        redactCredentialLikeText(String(channelPersona || ""))
    ].filter(Boolean).join("\n\n");
}

module.exports = { buildQQCloudSystemInstructions, createQQCloudService };
