const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
    path.join(__dirname, "..", "routes", "v2", "core.js"),
    "utf8"
);

assert.doesNotMatch(source, /vision_debug/);
assert.match(source, /code:\s*"vision_unavailable"/);
assert.match(source, /description:\s*result\.text/);

console.log("vision response privacy tests passed");
