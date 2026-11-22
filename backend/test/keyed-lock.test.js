"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { withKeyLock } = require("../services/keyed-lock");

test("withKeyLock serializes read-modify-write for the same companion", async () => {
    let value = 0;
    const bump = () => withKeyLock("u:c", async () => {
        const current = value;
        await new Promise((resolve) => setTimeout(resolve, 20));
        value = current + 1;
    });
    await Promise.all([bump(), bump()]);
    assert.equal(value, 2);
});

test("withKeyLock releases after a task throws", async () => {
    await assert.rejects(withKeyLock("u:c", async () => { throw new Error("boom"); }));
    const value = await withKeyLock("u:c", async () => "next");
    assert.equal(value, "next");
});

test("withKeyLock lets different keys run concurrently", async () => {
    const order = [];
    const task = (name, ms) => withKeyLock("key-"+name, async () => {
        order.push("start-"+name);
        await new Promise((resolve) => setTimeout(resolve, ms));
        order.push("end-"+name);
    });
    await Promise.all([task("a", 40), task("b", 5)]);
    assert.deepEqual(order, ["start-a", "start-b", "end-b", "end-a"]);
});

