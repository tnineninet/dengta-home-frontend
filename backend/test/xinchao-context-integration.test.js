const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    buildProactiveDecisionPrompt
} = require("../services/tenant-proactive-message");

const withState = buildProactiveDecisionPrompt({
    now: new Date("2026-10-22T12:00:00.000Z"),
    timezone: "Asia/Shanghai",
    recentPushes: [{ content: "上次说过晚安", created_at: "2026-10-22" }],
    xinchaoNow: "情绪：低落；驱力：想她（涨）"
});
assert.match(withState, /【心潮·此刻】/);
assert.match(withState, /情绪：低落/);
assert.match(withState, /上次说过晚安/);

const withoutState = buildProactiveDecisionPrompt({
    now: new Date("2026-10-22T12:00:00.000Z"),
    timezone: "Asia/Shanghai",
    recentPushes: []
});
assert.doesNotMatch(withoutState, /【心潮·此刻】/);

const serverSource = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);
assert.match(serverSource, /xinchaoClient\.loadNow\(/);
assert.match(serverSource, /xinchaoClient\s*\.recordExchange\(/);
assert.match(serverSource, /loadXinchaoNow: \(\{ job \}\)/);

console.log("xinchao context integration tests passed");
