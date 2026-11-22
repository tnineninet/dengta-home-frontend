const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { createRequestScope } = require("../services/request-scope");
const { createSurpriseMapMcpRouter } = require("../services/surprise-map-mcp");

const userA = "11111111-1111-4111-8111-111111111111", userB = "22222222-2222-4222-8222-222222222222";
const companionA = "33333333-3333-4333-8333-333333333333", companionB = "44444444-4444-4444-8444-444444444444";
const time = Date.parse("2026-10-20T00:00:00Z");
const sql = fs.readFileSync(require.resolve("../supabase/062_surprise_map.sql"), "utf8");

function client(db) {
    const safe = value => { assert.match(value, /^[a-z_]+$/u); return `"${value}"`; };
    return { from(table) {
        const filters = [], params = [], ordering = []; let action = "select", payload, columns = "*", limit = "", one = false;
        const bind = value => { params.push(value); return `$${params.length}`; };
        const query = {
            select(value = "*") { columns = value; return query; },
            insert(value) { action = "insert"; payload = value; return query; },
            update(value) { action = "update"; payload = value; return query; },
            eq(key, value) { filters.push([key, "eq", value]); return query; },
            is(key, value) { filters.push([key, "is", value]); return query; },
            in(key, value) { filters.push([key, "in", value]); return query; },
            order(key, options) { ordering.push(`${safe(key)} ${options?.ascending === false ? "desc" : "asc"}`); return query; },
            limit(value) { assert.ok(Number.isInteger(value) && value >= 0); limit = ` limit ${value}`; return query; },
            single() { one = true; return query; }, maybeSingle() { one = true; return query; },
            then(resolve, reject) {
                const run = async () => {
                    try {
                        const projection = columns === "*" ? "*" : columns.split(",").map(key => safe(key.trim())).join(",");
                        let command;
                        if (action === "insert") {
                            const keys = Object.keys(payload);
                            command = `insert into ${safe(table)} (${keys.map(safe).join(",")}) values (${keys.map(key => bind(payload[key])).join(",")}) returning ${projection}`;
                        } else {
                            const change = action === "update" ? Object.entries(payload).map(([key, value]) => `${safe(key)}=${bind(value)}`).join(",") : "";
                            const comparison = (key, op, value) => op === "is" ? `${safe(key)} is null` : `${safe(key)} = ${bind(value)}`;
                            const where = filters.map(([key, op, value]) => op === "in" ? `${safe(key)} in (${value.map(bind).join(",")})` : comparison(key, op, value)).join(" and ");
                            command = action === "select" ? `select ${projection} from ${safe(table)}` : `update ${safe(table)} set ${change}`;
                            command += where ? ` where ${where}` : "";
                            command += action === "select" ? (ordering.length ? ` order by ${ordering.join(",")}` : "") + limit : ` returning ${projection}`;
                        }
                        const data = (await db.query(command, params)).rows;
                        return { data: one ? data[0] || null : data, error: null };
                    } catch (error) { return { data: null, error }; }
                };
                return run().then(resolve, reject);
            },
        };
        return query;
    } };
}

test("MCP tokens create scoped letters, list only own data and revoke cleanly", { timeout: 30000 }, async () => {
    const db = new PGlite(); let server;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
          create table companions(user_id uuid not null, id uuid not null, primary key(user_id,id));
          insert into companions values ('${userA}','${companionA}'),('${userB}','${companionB}');`);
        await db.exec(sql);
        const raw = client(db);
        const scope = (user, companion) => createRequestScope({ adminSupabase: raw, user: { id: user }, profile: { id: user, role: "member", status: "active" },
            companions: [{ id: companion, user_id: user, status: "active" }], companion: { id: companion, user_id: user, status: "active" } });
        const scopes = { A: scope(userA, companionA), B: scope(userB, companionB) };
        const app = express(); app.use((req, _res, next) => { req.scope = scopes[req.get("x-fixture")] || null; next(); });
        app.use("/mcp", createSurpriseMapMcpRouter({ database: raw, now: () => time, random: () => 0.5 }));
        server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const post = async (path, body, headers = {}) => {
            const response = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
            return { status: response.status, ...(await response.json().catch(() => ({}))) };
        };
        assert.equal((await post("/mcp/tokens", {}, {})).status, 401);
        const created = await post("/mcp/tokens", { label: "测试令牌" }, { "x-fixture": "A" });
        assert.equal(created.status, 201); assert.match(created.token, /^dengta_map_[A-Za-z0-9_-]{20,}$/);
        const stored = (await db.query("select token_hash,label from surprise_map_mcp_tokens")).rows[0];
        assert.equal(stored.label, "测试令牌"); assert.equal(stored.token_hash.length, 64);
        const rpc = async (body, token = created.token) => post("/mcp", body, token ? { Authorization: "Bearer " + token } : {});
        assert.equal((await post("/mcp", { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
        const initialized = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
        assert.equal(initialized.result.serverInfo.name, "dengta-surprise-map");
        const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        assert.deepEqual(listed.result.tools.map(tool => tool.name).sort(), ["hide_letter", "list_letters", "list_public_letters"]);
        const missingConfirm = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hide_letter", arguments: { title: "t", body: "b", hint: "h", lat: 0, lon: 0 } } });
        assert.equal(missingConfirm.result.isError, true);
        assert.equal(JSON.parse(missingConfirm.result.content[0].text).code, "surprise_map_confirmation_required");
        const hidden = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "hide_letter", arguments: { title: "虚构标题", body: "虚构正文", hint: "虚构提示", lat: 0, lon: 0, radius_m: 300, confirm: true } } });
        const hiddenValue = JSON.parse(hidden.result.content[0].text);
        assert.equal(hiddenValue.ok, true); assert.equal(hiddenValue.state, "sealed");
        const rows = (await db.query("select * from surprise_map_letters")).rows;
        assert.equal(rows.length, 1); assert.equal(rows[0].user_id, userA); assert.equal(rows[0].companion_id, companionA);
        assert.equal(rows[0].title, "虚构标题"); assert.equal(rows[0].area_radius_m, 900);
        const mine = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_letters", arguments: {} } });
        assert.equal(JSON.parse(mine.result.content[0].text).letters[0].title, "虚构标题");
        const other = await post("/mcp/tokens", {}, { "x-fixture": "B" });
        const otherList = await post("/mcp", { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "list_letters", arguments: {} } }, { Authorization: "Bearer " + other.token });
        assert.deepEqual(JSON.parse(otherList.result.content[0].text).letters, []);
        const publicList = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "list_public_letters", arguments: {} } });
        assert.deepEqual(JSON.parse(publicList.result.content[0].text).letters, []);
        const unknown = await rpc({ jsonrpc: "2.0", id: 8, method: "unknown/method" });
        assert.equal(unknown.error.code, -32601);
        const revoked = await fetch(origin + "/mcp/tokens/" + created.id, { method: "DELETE", headers: { "x-fixture": "A" } });
        assert.equal(revoked.status, 200);
        assert.equal((await rpc({ jsonrpc: "2.0", id: 9, method: "initialize" })).status, 401);
        assert.equal((await rpc({ jsonrpc: "2.0", id: 10, method: "initialize" }, "dengta_map_invalid")).status, 401);
    } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); }
});
