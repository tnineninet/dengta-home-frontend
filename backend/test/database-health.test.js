const assert = require("node:assert/strict");
const {
    boundedTimeout,
    createDatabaseHealthCheck,
    publicDatabaseHealth
} = require("../services/database-health");

assert.equal(boundedTimeout("5000"), 5000);
assert.equal(boundedTimeout("1"), 1000);
assert.equal(boundedTimeout("99999"), 15000);
assert.equal(boundedTimeout(undefined), 8000);

(async () => {
    let clock = 0;
    let reads = 0;
    const success = createDatabaseHealthCheck({
        readOnce: async () => { reads += 1; },
        cacheMs: 15000,
        now: () => clock
    });
    const first = await success();
    assert.equal(first.ok, true);
    assert.equal(first.dependency, "database");
    assert.equal(first.status, "up");
    assert.equal(reads, 1);
    const second = await success();
    assert.equal(second.ok, true);
    assert.equal(reads, 1, "cache should prevent repeated DB reads");
    clock += 15001;
    await success();
    assert.equal(reads, 2, "expired cache should allow a new read");

    const failure = createDatabaseHealthCheck({
        readOnce: async () => { throw new Error("connection refused"); },
        cacheMs: 0
    });
    const failed = await failure();
    assert.equal(failed.ok, false);
    assert.equal(failed.status, "down");
    assert.equal(failed.reason, "query_failed");
    const publicFailure = publicDatabaseHealth(failed, new Date(0));
    assert.deepEqual(publicFailure, {
        ok: false,
        dependency: "database",
        status: "down",
        error: "Database dependency down",
        reason: "query_failed",
        time: new Date(0).toISOString()
    });
    assert.equal("logMessage" in publicFailure, false);

    let timeoutSignal = null;
    const timeout = createDatabaseHealthCheck({
        readOnce: (signal) => {
            timeoutSignal = signal;
            return new Promise(() => {});
        },
        timeoutMs: 20,
        cacheMs: 0
    });
    const timedOut = await timeout();
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.reason, "timeout");
    assert.equal(timeoutSignal.aborted, true, "timeout must abort the underlying query");

    let inFlightReads = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const shared = createDatabaseHealthCheck({
        readOnce: async () => {
            inFlightReads += 1;
            await gate;
        },
        cacheMs: 15000
    });
    const a = shared();
    const b = shared();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.ok, true);
    assert.equal(rb.ok, true);
    assert.equal(inFlightReads, 1, "concurrent checks should share one in-flight read");

    console.log("database health tests passed");
})();
