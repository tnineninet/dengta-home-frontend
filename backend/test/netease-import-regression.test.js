"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createNeteaseQrLoginService } = require("../services/netease-qr-login");

const source = fs.readFileSync(path.join(__dirname, "..", "services", "netease-qr-login.js"), "utf8");

test("importPlaylist cannot be shadowed by the async resolver", () => {
    assert.doesNotMatch(source, /async function songUrl\(scope/);
    assert.match(source, /async function resolveSongUrl\(scope/);
    assert.match(source, /external_url: songUrl\(track\.provider_track_id\)/);
    assert.doesNotMatch(source, /DBG |STEP before upsert|rows\?\.\[0\]/);
});

test("service.songUrl is the 2-arg async resolver (not the 1-arg URL helper)", async () => {
    const db = { from() { const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle: async () => ({ data: null, error: null }) }; return chain; } };
    const service = createNeteaseQrLoginService({ database: db });
    assert.equal(service.songUrl.name, "resolveSongUrl");
    assert.equal(service.songUrl.length, 2);
    const pending = service.songUrl({ userId: "u", companionId: "c" }, "123");
    assert.equal(typeof pending.then, "function");
    await pending.catch(() => {});
});

test("importPlaylist query errors are surfaced", () => {
    assert.match(source, /if \(existing\.error\) throw existing\.error/);
});