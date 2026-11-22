const assert = require("node:assert/strict");
const { test } = require("node:test");
const { setTimeout: wait } = require("node:timers/promises");
const { createQQCloudService } = require("../services/qq-cloud");
const { normalizeClientMessageId } = require("../services/chat-idempotency");
const express = require("express");
const { createQQCloudRouter } = require("../routes/v2/qq-cloud");

test("cloud QQ endpoints reject an unauthenticated or forged account scope", async (t) => {
    const fail = () => assert.fail("A forged scope reached the service");
    const app = express();
    app.use((req, _res, next) => {
        req.scope = { userId: "forged", companionId: "forged" };
        next();
    });
    app.use("/qq", createQQCloudRouter({ status: fail, begin: fail, resetPairCode: fail, disconnect: fail }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    for (const [method, route] of [["GET", ""], ["POST", "/start"], ["POST", "/pair-code"], ["DELETE", ""]]) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/qq${route}`, { method });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
});

function fixtureDatabase() {
    const tables = new Map();
    return {
        tables,
        from(table) {
            const rows = tables.get(table) || [];
            tables.set(table, rows);
            const conditions = [];
            let action = "select", fields = "*", payload, count = Infinity;
            function execute(single = false) {
                if (action === "insert") {
                    const conflict = table.endsWith("connections") ? rows.some((row) => row.app_id === payload.app_id ||
                        (row.user_id === payload.user_id && row.companion_id === payload.companion_id))
                        : rows.some((row) => row.connection_id === payload.connection_id && row.message_id === payload.message_id);
                    if (conflict) return { error: { code: "23505" } };
                    rows.push({ online: false, lease_until: null, ...payload });
                    return { data: null };
                }
                const matches = rows.filter((row) => conditions.every((condition) => condition(row))).slice(0, count);
                if (action === "update") matches.forEach((row) => Object.assign(row, payload));
                if (action === "delete") matches.forEach((row) => rows.splice(rows.indexOf(row), 1));
                const result = matches.map((row) => fields === "*" ? { ...row }
                    : Object.fromEntries(fields.split(",").map((key) => [key, row[key]])));
                return { data: single ? result[0] || null : result };
            }
            const q = {
                select(value) { fields = value; return q; },
                insert(value) { action = "insert"; payload = value; return q; },
                update(value) { action = "update"; payload = value; return q; },
                delete() { action = "delete"; return q; },
                eq(key, value) { conditions.push((row) => row[key] === value); return q; },
                gt(key, value) { conditions.push((row) => row[key] > value); return q; },
                lt(key, value) { conditions.push((row) => row[key] < value); return q; },
                in(key, values) { conditions.push((row) => values.includes(row[key])); return q; },
                or(value) {
                    const iso = value.split("lease_until.lt.")[1];
                    conditions.push((row) => !row.lease_until || row.lease_until < iso);
                    return q;
                },
                limit(value) { count = value; return q; },
                order() { return q; },
                maybeSingle() { return Promise.resolve(execute(true)); },
                then(resolve) { resolve(execute()); }
            };
            return q;
        }
    };
}

test("isolated cloud QR onboarding, QQ owner access, idempotency, and revocation", async (t) => {
    let time = Date.now();
    const db = fixtureDatabase();
    const scans = [], turns = [], sent = [];
    const bots = new Map();
    const service = createQQCloudService({
        database: db,
        env: { QQ_CLOUD_ENABLED: "true", QQ_CLOUD_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64") },
        now: () => time,
        startQr(callbacks) { scans.push(callbacks); return () => {}; },
        makeQrImage: async () => "data:image/png;base64,fixture",
        createBot: async ({ appId, appSecret }) => {
            assert.equal(appSecret, "fixture-secret");
            const handlers = {};
            const bot = {
                on(name, handler) { handlers[name] = handler; },
                start() { handlers.ready(); return new Promise((resolve) => { bot.finish = resolve; }); },
                stop() { bot.finish?.(); },
                async sendText(target, text) { sent.push({ appId, target, text }); },
                message(owner, id, content, kind = "c2c") {
                    return handlers.message({}, { kind, content, replyTarget: { scope: kind, targetId: owner, msgId: id } });
                }
            };
            bots.set(appId, bot);
            return bot;
        },
        createScope: async (_, ids) => ids,
        channelPersona: async (scope) => "selected-for-" + scope.companionId,
        executeChatTurn: async (req) => {
            normalizeClientMessageId(req.body.client_message_id);
            turns.push(req);
            if (req.body.message === "model-failure") throw new Error("private provider detail");
            return { reply: "fixture-reply", conversation_id: "session-" + req.scope.companionId };
        }
    });
    t.after(() => service.stop());
    const a = { userId: "account-a", companionId: "companion-a" };
    const b = { userId: "account-b", companionId: "companion-b" };
    await service.begin(a);
    await scans[0].onQrDisplayed("https://q.qq.com/qqbot/openclaw/connect.html?task_id=fixture");
    assert.equal((await service.status(a)).state, "scanning");
    assert.equal((await service.status(b)).qr_image, undefined);
    await scans[0].onSuccess([{ appId: "123456", appSecret: "fixture-secret", userOpenid: "owner-openid-a" }]);
    await wait(30);
    assert.deepEqual(await service.status(a), { enabled: true, state: "active", online: true, pair_code: null });
    assert.ok(!JSON.stringify(db.tables.get("qq_cloud_connections")).includes("fixture-secret"));
    await service.begin(b);
    await scans[1].onSuccess([{ appId: "123456", appSecret: "fixture-secret", userOpenid: "owner-openid-b" }]);
    assert.equal((await service.status(b)).state, "already_linked");
    await service.begin(b);
    await scans[2].onSuccess([{ appId: "234567", appSecret: "fixture-secret" }]);
    await wait(30);
    const pending = await service.status(b);
    assert.equal(pending.state, "awaiting_owner");
    assert.match(pending.pair_code, /^灯塔绑定 \d{12}$/);

    const botA = bots.get("123456");
    const botB = bots.get("234567");
    await botA.message("owner-openid-b", "1", "guest");
    await botA.message("owner-openid-a", "1", "group", "group");
    await botB.message("owner-openid-b", "1", "unverified");
    assert.equal(turns.length, 0);
    await botB.message("owner-openid-b", "2", pending.pair_code);
    assert.equal((await service.status(b)).state, "active");
    await botA.message("owner-openid-a", "2", "hello");
    time += 3000;
    await botA.message("owner-openid-a", "2", "replay");
    await botB.message("owner-openid-b", "3", "hello");
    assert.deepEqual(turns.map((turn) => turn.scope), [a, b]);
    assert.deepEqual(turns.map((turn) => turn.body.channel_persona), ["selected-for-companion-a", "selected-for-companion-b"]);
    assert.ok(sent.every(({ target }) => target.scope === "c2c" && target.msgId));
    await service.disconnect(a);
    await botA.message("owner-openid-a", "4", "after disconnect");
    assert.equal((await service.status(a)).state, "disconnected");
    assert.equal((await service.status(b)).state, "active");
    assert.equal(turns.length, 2);
    assert.ok(turns.every((turn) => turn.isQQCloud && turn.isChannelBridge));
    time += 3000;
    await botB.message("owner-openid-b", "5", "model-failure");
    assert.match(sent.at(-1).text, /没接上模型/);
    assert.ok(sent.every(({ text }) => !text.includes("private provider detail")));
    time += 3000;
    await botB.message("owner-openid-b", "5", "model-failure");
    assert.equal(turns.length, 3);
});
