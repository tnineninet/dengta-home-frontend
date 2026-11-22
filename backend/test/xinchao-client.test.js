const assert = require("node:assert/strict");
const {
    createXinchaoClient
} = require("../services/xinchao-client");

const ENV = {
    XINCHAO_BASE_URL: "https://xinchao.example.test/",
    XINCHAO_TOKEN: "test-token",
    XINCHAO_OWNER_USER_ID: "user-1",
    XINCHAO_OWNER_COMPANION_ID: "companion-1"
};
const SCOPE = { userId: "user-1", companionId: "companion-1" };

(async () => {
    const requests = [];
    const client = createXinchaoClient({
        env: ENV,
        now: () => 1000,
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            if (url.endsWith("/v1/now")) {
                return {
                    ok: true,
                    status: 200,
                    async json() {
                        return { text: "【心潮·此刻】情绪：平静" };
                    }
                };
            }
            if (url.endsWith("/v1/state")) {
                return {
                    ok: true,
                    status: 200,
                    async json() {
                        return {
                            revision: 16,
                            consciousness: "awake",
                            lastConversationAt: "2026-10-22T13:42:44.779Z",
                            drives: { possess: 0.31, monitor: 0.3, bad: "x" },
                            emotion: { label: "平静", valence: 0.55, arousal: 0.3 }
                        };
                    }
                };
            }
            return { ok: true, status: 200 };
        }
    });
    assert.equal(client.enabled, true);
    assert.equal(client.scopeMatches(SCOPE), true);
    assert.equal(
        client.scopeMatches({ userId: "user-2", companionId: "companion-1" }),
        false
    );
    assert.equal(await client.loadNow({ userId: "user-2", companionId: "companion-1" }), "");

    const first = await client.loadNow(SCOPE);
    const second = await client.loadNow(SCOPE);
    assert.equal(first, "【心潮·此刻】情绪：平静");
    assert.equal(second, first);
    assert.equal(
        requests.filter((item) => item.url.endsWith("/v1/now")).length,
        1,
        "now should be cached briefly"
    );
    assert.equal(
        requests[0].url,
        "https://xinchao.example.test/v1/now"
    );
    assert.equal(
        requests[0].options.headers.Authorization,
        "Bearer test-token"
    );

    const state = await client.loadState(SCOPE);
    assert.equal(state.revision, 16);
    assert.equal(state.emotion.label, "平静");
    assert.equal(state.drives.possess, 0.31);
    assert.equal(Object.hasOwn(state.drives, "bad"), false);
    assert.equal(await client.loadState({ userId: "user-2", companionId: "companion-1" }), null);

    const recorded = await client.recordExchange({
        scope: SCOPE,
        userMessage: "今天有点累",
        assistantMessage: "那先休息一下，我在。",
        messageId: "message-1"
    });
    assert.equal(recorded.sent, true);
    const event = requests.find((item) =>
        item.url.endsWith("/v1/conversation-event")
    );
    assert.ok(event);
    const body = JSON.parse(event.options.body);
    assert.match(body.event_id, /^dengta-turn:message-1$/);
    assert.match(body.exchange, /^她说：今天有点累\n他回：/);

    const gatewayRequests = [];
    const gateway = createXinchaoClient({
        env: {
            XINCHAO_TENANT_GATEWAY_URL: "https://gateway.example.test/",
            XINCHAO_TENANT_GATEWAY_TOKEN: "g".repeat(32)
        },
        fetchImpl: async (url, options) => {
            const tenant = options.headers["X-Tenant-Id"];
            gatewayRequests.push({ url, options, tenant });
            if (url.endsWith("/v1/now")) {
                return { ok: true, status: 200, async json() { return { text: "tenant:" + tenant }; } };
            }
            if (url.endsWith("/v1/state")) {
                if (tenant === "user-other:companion-other") {
                    return { ok: false, status: 404 };
                }
                return {
                    ok: true,
                    status: 200,
                    async json() {
                        return {
                            revision: tenant === "user-gw:companion-gw" ? 7 : 99,
                            drives: { possess: 0.4 },
                            emotion: { label: "平静" }
                        };
                    }
                };
            }
            return { ok: true, status: 200, async json() { return {}; } };
        }
    });
    const otherScope = { userId: "user-gw", companionId: "companion-gw" };
    assert.equal(gateway.enabled, true);
    assert.equal(gateway.scopeMatches(otherScope), true);
    assert.equal(gateway.scopeMatches({ userId: "bad id", companionId: "x" }), false);
    assert.equal(await gateway.loadNow(otherScope), "tenant:user-gw:companion-gw");
    assert.equal(await gateway.loadNow(otherScope), "tenant:user-gw:companion-gw");
    assert.equal(
        gatewayRequests.filter((item) => item.url.endsWith("/v1/now")).length,
        1,
        "gateway now cache should also be tenant-scoped"
    );
    const gatewayState = await gateway.loadState(otherScope);
    assert.equal(gatewayState.revision, 7);
    assert.equal(
        gatewayRequests.at(-1).options.headers.Authorization,
        "Bearer " + "g".repeat(32)
    );
    assert.equal(gatewayRequests.at(-1).options.headers["X-Tenant-Id"], "user-gw:companion-gw");
    assert.equal(
        await gateway.loadState({ userId: "user-other", companionId: "companion-other" }),
        null
    );

    const disabled = createXinchaoClient({
        env: { XINCHAO_BASE_URL: "", XINCHAO_TOKEN: "" },
        fetchImpl: async () => {
            throw new Error("disabled client must not fetch");
        }
    });
    assert.equal(disabled.enabled, false);
    assert.equal(await disabled.loadNow(SCOPE), "");
    assert.deepEqual(
        await disabled.recordExchange({
            scope: SCOPE,
            userMessage: "a",
            assistantMessage: "b",
            messageId: "m"
        }),
        { skipped: true }
    );

    const failing = createXinchaoClient({
        env: ENV,
        fetchImpl: async () => {
            throw new Error("network down");
        }
    });
    assert.equal(await failing.loadNow(SCOPE), "");
    assert.equal(
        (
            await failing.recordExchange({
                scope: SCOPE,
                userMessage: "a",
                assistantMessage: "b",
                messageId: "m"
            })
        ).sent,
        false
    );

    console.log("xinchao bridge client tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
