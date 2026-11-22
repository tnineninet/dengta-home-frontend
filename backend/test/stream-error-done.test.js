const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { streamErrorEvents } = require("../services/chat-stream-contract");

const error = Object.assign(new Error("upstream failed"), {
    code: "provider_stream_incomplete",
    status: 502
});
const events = streamErrorEvents(error, { userMessageCommitted: true });
assert.equal(events.length, 2);
assert.equal(events[0].type, "error");
assert.equal(events[0].ok, false);
assert.equal(events[1].type, "done");
assert.equal(events[1].ok, false);
assert.doesNotMatch(JSON.stringify(events), /upstream failed/);

const serverSource = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);
assert.match(
    serverSource,
    /streamFailure\(error,\s*\{[\s\S]{0,300}?\{ type: "done", ok: false \}/,
    "after SSE headers, the route must send error then done"
);

console.log("stream error done tests passed");
