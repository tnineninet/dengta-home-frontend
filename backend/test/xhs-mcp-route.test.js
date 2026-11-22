"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createXhsRouter } = require("../routes/v2/xhs");
const { createXhsMcpClient } = require("../services/xhs-mcp-client");
const { createRequestScope } = require("../services/request-scope");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
process.env.XHS_MOCK_TENANTS = `${USER_A}:${COMPANION_A},${USER_B}:${COMPANION_B}`;
const { createMockForkServer, TOKEN } = require("../../dengta-home-xhs-mock-fork/server");

function scopeFor(authorization) {
    const user = authorization === `Bearer ${USER_B}` ? USER_B : USER_A;
    const companion = user === USER_B ? COMPANION_B : COMPANION_A;
    return createRequestScope({
        adminSupabase: { from() { throw new Error("unexpected database use"); } },
        user: { id: user },
        profile: { id: user, role: "member", status: "active" },
        companion: { id: companion, user_id: user, status: "active" },
        companions: [{ id: companion, user_id: user, status: "active" }]
    });
}

test("new read-only XHS routes preserve tenant scope through the MCP adapter", async () => {
    const mock = createMockForkServer();
    await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.scope = scopeFor(String(req.headers.authorization || ""));
        next();
    });
    app.use("/xhs", createXhsRouter({
        client: createXhsMcpClient({
            env: {
                XHS_MCP_URL: `http://127.0.0.1:${mock.address().port}`,
                XHS_MCP_TOKEN: TOKEN
            },
            getCookie: async () => "fixture-cookie"
        }),
        writeConfirmationSecret: "fixture-route-confirmation-secret"
    }));
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}/xhs`;
        const a = await (await fetch(base + "/feeds", { headers: { Authorization: `Bearer ${USER_A}` } })).json();
        const b = await (await fetch(base + "/feeds", { headers: { Authorization: `Bearer ${USER_B}` } })).json();
        assert.match(a.feeds.feeds[0].title, new RegExp(USER_A));
        assert.match(b.feeds.feeds[0].title, new RegExp(USER_B));
        const login = await (await fetch(base + "/login/start", { method: "POST", headers: { Authorization: `Bearer ${USER_A}` } })).json();
        assert.match(login.login.session, /^[a-f0-9-]{36}$/i);
        assert.match(login.login.qr, /^data:image\/png;base64,/);
        const detail = await (await fetch(base + "/notes/note-1", { headers: { Authorization: `Bearer ${USER_A}` } })).json();
        assert.equal(detail.note.feed.feed_id, "note-1");
        const preview = await (await fetch(base + "/actions/preview", {
            method: "POST",
            headers: { Authorization: `Bearer ${USER_A}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "like", note_id: "note1234567890" })
        })).json();
        assert.ok(preview.preview.confirmation_token);
        const confirmed = await (await fetch(base + "/actions/confirm", {
            method: "POST",
            headers: { Authorization: `Bearer ${USER_A}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                confirmation_token: preview.preview.confirmation_token,
                idempotency_key: "route-key"
            })
        })).json();
        assert.equal(confirmed.ok, true);
        assert.equal(confirmed.replayed, false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await new Promise((resolve) => mock.close(resolve));
    }
});
