const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("server routes do not fall back to service-role database", () => {
    const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const forbidden = [
        /req\.scope\?\.db\s*\|\|\s*supabase/,
        /input\.requestScope\?\.db\s*\|\|\s*supabase/,
        /scope\?\.db\s*\|\|\s*supabase/
    ];
    for (const pattern of forbidden) {
        assert.equal(pattern.test(server), false, `forbidden service-role fallback: ${pattern}`);
    }
    assert.match(server, /function requestDatabase\(req\)/);
});
