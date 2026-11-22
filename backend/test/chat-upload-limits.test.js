const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
assert.match(
    source,
    /const chatUpload = multer\(\{[\s\S]{0,500}?fields:\s*20/,
    "chat multipart must allow the current 14 text fields plus headroom"
);
assert.match(
    source,
    /const chatUpload = multer\(\{[\s\S]{0,500}?parts:\s*MAX_ATTACHMENT_FILES\s*\+\s*20/,
    "multipart parts limit must match the fields limit"
);

console.log("chat upload limit tests passed");
