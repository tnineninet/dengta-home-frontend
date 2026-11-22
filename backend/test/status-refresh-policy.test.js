const assert = require("node:assert/strict");
const test = require("node:test");
const {
    STATUS_REFRESH_COOLDOWN_MS,
    reserveStatusRefresh,
    releaseStatusRefresh
} = require("../services/status-refresh-policy");

test("status refresh cooldown is atomic and can be rolled back", () => {
    const cache = new Map();
    const key = "user:companion";
    assert.equal(reserveStatusRefresh(cache, key, 1_000), true);
    assert.equal(reserveStatusRefresh(cache, key, 1_000 + STATUS_REFRESH_COOLDOWN_MS - 1), false);
    assert.equal(reserveStatusRefresh(cache, key, 1_000 + STATUS_REFRESH_COOLDOWN_MS), true);
    releaseStatusRefresh(cache, key, 1_000 + STATUS_REFRESH_COOLDOWN_MS);
    assert.equal(cache.has(key), false);
    assert.equal(reserveStatusRefresh(cache, key, 2_000), true);
});
