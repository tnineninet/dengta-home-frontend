"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { preserveCapsuleKeys, mergeCapsuleIntoSavedStatus, applyCapsuleJobs } = require("../services/time-capsule-state");

test("web status writes keep channel-bridge capsule keys", () => {
    const existing = { mood: "old", time_capsules: [{ name: "洗澡" }], last_capsule_interaction_at: "2026-10-29T00:00:00Z" };
    const next = preserveCapsuleKeys(existing, { mood: "new" });
    assert.equal(next.mood, "new");
    assert.deepEqual(next.time_capsules, [{ name: "洗澡" }]);
    assert.equal(next.last_capsule_interaction_at, "2026-10-29T00:00:00Z");
});

test("explicit incoming capsule keys win", () => {
    const next = preserveCapsuleKeys({ time_capsules: [{ name: "old" }] }, { time_capsules: [] });
    assert.deepEqual(next.time_capsules, []);
});

test("chat snapshot merges latest status instead of wiping it", () => {
    const merged = mergeCapsuleIntoSavedStatus({ mood: "fresh", content: { x: 1 } }, [{ name: "写代码" }], 1700000000000);
    assert.equal(merged.mood, "fresh");
    assert.deepEqual(merged.content, { x: 1 });
    assert.deepEqual(merged.time_capsules, [{ name: "写代码" }]);
    assert.equal(merged.last_capsule_interaction_at, new Date(1700000000000).toISOString());
});

test("concurrent markers merge into latest capsules instead of overwriting", () => {
    const now = 1700000000000;
    const latest = { time_capsules: [{ name: "A", startedAt: now - 1000, estimateMinutes: 30, updatedAt: now - 1000 }] };
    const merged = applyCapsuleJobs(latest.time_capsules, [{ action: "进行中", name: "B", minutes: 20 }], now);
    assert.deepEqual(merged.map((item) => item.name), ["A", "B"]);
});

test("completion removes the latest capsule with the same name", () => {
    const now = 1700000000000;
    const latest = { time_capsules: [{ name: "A", startedAt: now - 1000, estimateMinutes: 30, updatedAt: now - 1000 }] };
    const merged = applyCapsuleJobs(latest.time_capsules, [{ action: "完成", name: "A" }], now);
    assert.deepEqual(merged, []);
});