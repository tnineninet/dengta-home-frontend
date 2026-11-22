const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);

test("deleted session ids recover to a fresh conversation instead of failing the turn", () => {
    assert.match(source, /let existingConversationId =\s*[\s\S]*savedUserMessage\?\.conversation_id \|\| input\.conversationId/);
    assert.match(source, /if \(error\?\.status !== 404\) throw error;/);
    assert.match(source, /existingConversationId = "";/);
    assert.match(source, /stage: "session_recovered"/);
    assert.match(source, /原会话已不存在，已自动开启新会话/);
});
