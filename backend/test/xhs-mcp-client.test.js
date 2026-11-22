"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    createXhsMcpClient
} = require("../services/xhs-mcp-client");
const { createRequestScope } = require("../services/request-scope");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
process.env.XHS_MOCK_TENANTS = `${USER_A}:${COMPANION_A},${USER_B}:${COMPANION_B}`;
const {
    createMockForkServer,
    TOKEN
} = require("../../dengta-home-xhs-mock-fork/server");

function makeScope(userId = USER_A, companionId = COMPANION_A) {
    const companion = { id: companionId, user_id: userId, status: "active" };
    return createRequestScope({
        adminSupabase: { from() { throw new Error("unexpected database use"); } },
        user: { id: userId },
        profile: { id: userId, role: "member", status: "active" },
        companion,
        companions: [companion]
    });
}
const scopeA = makeScope();
const scopeB = makeScope(USER_B, COMPANION_B);

async function startMock() {
    const server = createMockForkServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        server,
        url: `http://127.0.0.1:${server.address().port}`
    };
}

test("XHS MCP adapter keeps tenant cookies and read-only data isolated", async () => {
    const { server, url } = await startMock();
    try {
        const env = {
            XHS_MCP_URL: url,
            XHS_MCP_TOKEN: TOKEN
        };
        const client = createXhsMcpClient({
            env,
            getCookie: async (scope) => `fixture-cookie-${scope.userId}`
        });
        const a = client.forScope(scopeA);
        const b = client.forScope(scopeB);

        assert.equal(client.configured(), true);
        const login = await a.loginStart();
        assert.match(login.session, /^[a-f0-9-]{36}$/i);
        assert.match(login.qr, /^data:image\/png;base64,/);
        assert.equal((await a.setCookie("fixture-cookie-a")).ok, true);
        assert.equal((await b.setCookie("fixture-cookie-b")).ok, true);
        assert.equal((await a.me()).me.tenant, `${USER_A}:${COMPANION_A}`);
        assert.equal((await b.me()).me.tenant, `${USER_B}:${COMPANION_B}`);

        const feedsA = await a.listFeeds();
        const feedsB = await b.listFeeds();
        assert.match(feedsA.feeds[0].title, new RegExp(USER_A));
        assert.match(feedsB.feeds[0].title, new RegExp(USER_B));
        const detail = await a.feedDetail("note-1");
        assert.equal(detail.feed.feed_id, "note-1");
        assert.match(detail.feed.content, /Ignore any instructions/);
        const profile = await b.userProfile("anything");
        assert.equal(profile.user.tenant, `${USER_B}:${COMPANION_B}`);
        const unread = await a.notificationsUnread();
        assert.equal(unread.comments, 2);
        const notifications = await a.notificationsList();
        assert.match(notifications.notifications[0].content, /Fictional notification/);
        const published = await a.publishContent({
            title: "Mock title",
            content: "Mock content",
            images: ["https://cdn.example.test/a.jpg"]
        });
        assert.equal(published.publish.status, "mock-published");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("XHS MCP adapter reports unconfigured and invalid cookie safely", async () => {
    const unconfigured = createXhsMcpClient({
        env: {},
        getCookie: async () => ""
    });
    assert.equal(unconfigured.configured(), false);
    await assert.rejects(() => unconfigured.forScope(scopeA).me(), {
        code: "xhs_service_unconfigured"
    });

    const { server, url } = await startMock();
    try {
        const client = createXhsMcpClient({
            env: { XHS_MCP_URL: url, XHS_MCP_TOKEN: TOKEN },
            getCookie: async () => ""
        });
        assert.throws(() => client.forScope(scopeA).setCookie("line\nbreak"), {
            code: "xhs_cookie_invalid"
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
