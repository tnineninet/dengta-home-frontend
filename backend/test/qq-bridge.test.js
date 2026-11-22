"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const test = require("node:test");
const { createQQBridgeRouter } = require("../routes/v2/qq-bridge");

const USER = "11111111-1111-4111-8111-111111111111";
const COMPANION = "22222222-2222-4222-8222-222222222222";
const TOKEN = "fixture-qq-bridge-token";
const rows = {
  user_profiles: [{ id: USER, email: "fixture@example.test", display_name: "Fixtures", role: "owner", status: "active" }],
  companions: [{ id: COMPANION, user_id: USER, name: "Fixture companion", status: "active" }],
  settings: [{ user_id: USER, companion_id: COMPANION, ai_name: "Fixture AI", unified_system_prompt: "Fixture persona", personality: "Fixture personality", user_details: "Fixture user", additional_prompt: "", system_prompt: "" }],
  memories: [{ user_id: USER, companion_id: COMPANION, summary: "Fixture memory", updated_at: "2026-10-23T00:00:00Z" }],
  messages: [{ user_id: USER, companion_id: COMPANION, role: "assistant", content: "Fixture message", created_at: "2026-10-23T00:00:00Z" }],
    companion_runtime_states: [{ user_id: USER, companion_id: COMPANION, status: { time_capsules: [{ name: "Existing task", startedAt: new Date(Date.now() - 1000).toISOString(), estimateMinutes: 30, updatedAt: "2026-10-23T00:00:00Z" }] } }],
};
function database() {
  return {
    from(table) {
      const filters = [];
      const chain = {
        select() { return chain; },
        eq(name, value) { filters.push([name, value]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() {
          const match = (rows[table] || []).find((row) => filters.every(([name, value]) => row[name] === value));
          return Promise.resolve({ data: match || null, error: null });
        },
        upsert(values) {
            if (!rows[table]) rows[table] = [];
            const index = rows[table].findIndex((row) => row.user_id === USER && row.companion_id === COMPANION);
            if (index >= 0) rows[table][index] = { ...rows[table][index], ...values };
            else rows[table].push({ id: "11111111-1111-4111-8111-111111111119", user_id: USER, companion_id: COMPANION, ...values });
            return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          const matches = (rows[table] || []).filter((row) => filters.every(([name, value]) => row[name] === value));
          resolve({ data: matches, error: null });
        }
      };
      return chain;
    }
  };
}
async function start(executeChatTurn = async () => ({ reply: "Fixture reply", conversation_id: "fixture-conversation" })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qq-bridge-"));
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ token: TOKEN, bindings: { "941867089": { userId: USER, companionId: COMPANION } } }));
  const app = express();
  app.use(express.json());
  app.use("/qq", createQQBridgeRouter({ database: database(), executeChatTurn, configPath }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code || "", message: error.message }));
  const server = await new Promise((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  return { server, base: `http://127.0.0.1:${server.address().port}`, dir };
}
async function call(base, pathname, body, token = TOKEN) {
  return fetch(base + pathname, { method: "POST", headers: { "content-type": "application/json", "x-dengta-qq-token": token }, body: JSON.stringify(body) });
}

test("QQ bridge context reads the bound DengTa persona and memory", async () => {
  const fixture = await start();
  try {
    const response = await call(fixture.base, "/qq/context", { qq: 941867089 });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.companion.id, COMPANION);
    assert.equal(data.persona.unified_system_prompt, "Fixture persona");
    assert.equal(data.memories[0].summary, "Fixture memory");
    assert.equal(data.recent_messages[0].content, "Fixture message");
    assert.equal((await call(fixture.base, "/qq/context", { qq: 941867089 }, "wrong-token")).status, 401);
    assert.equal((await call(fixture.base, "/qq/context", { qq: 1 })).status, 403);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("QQ bridge chat executes the real DengTa chat callback with the bound scope", async () => {
  let received = null;
  const fixture = await start(async (input) => {
    received = input;
    return { reply: "DengTa reply", conversation_id: "conversation-1" };
  });
  try {
    const response = await call(fixture.base, "/qq/chat", { qq: 941867089, text: "hello", conversation_id: "existing" });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.reply, "DengTa reply");
    assert.equal(data.conversation_id, "conversation-1");
    assert.equal(received.scope.userId, USER);
    assert.equal(received.scope.companionId, COMPANION);
    assert.equal(received.body.message, "hello");
    assert.equal(data.time_capsule?.active, 1);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
