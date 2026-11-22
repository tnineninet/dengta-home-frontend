const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

assert.match(
    source,
    /res\.status\(200\)\.json\(\{[\s\S]*?checks:\s*\{[\s\S]*?process:\s*"ok"[\s\S]*?database:\s*"not_checked"[\s\S]*?\},\s*features:/,
    "/health must explicitly declare it is a shallow process check and database is not checked"
);
assert.doesNotMatch(
    source,
    /\/health[\s\S]{0,800}?\.from\("settings"\)/,
    "/health must not query the database"
);
assert.match(
    source,
    /vision_configured:\s*Boolean\(visionConfigured\(process\.env\)\)/,
    "/health must expose only the non-sensitive vision configured boolean"
);
assert.match(
    source,
    /xinchao_configured:\s*xinchaoClient\.enabled/,
    "/health must expose only the non-sensitive Xinchao configured boolean"
);
assert.doesNotMatch(
    source,
    /vision_configured[\s\S]{0,200}?visionConfig\(|vision_configured[\s\S]{0,200}?VISION_/,
    "/health must not expose vision endpoint, model, or credentials"
);
const authSource = fs.readFileSync(
    path.join(__dirname, "..", "services", "auth-context.js"),
    "utf8"
);
assert.match(
    authSource,
    /"\/health",\s*"\/health\/database"/,
    "the deep database health endpoint must be public for the external monitor"
);
const databaseHealthSource = fs.readFileSync(
    path.join(__dirname, "..", "services", "database-health.js"),
    "utf8"
);
assert.match(databaseHealthSource, /"Database dependency down"/);
assert.doesNotMatch(databaseHealthSource, /console\.log\(.*logMessage/);

console.log("health semantics tests passed");
