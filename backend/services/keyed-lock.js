"use strict";

// Serialize read-modify-write sequences for the same logical key inside one
// Node process. Render runs a single instance per service, so this closes the
// concurrency window that a plain read-latest -> upsert leaves open.
const tails = new Map();

async function withKeyLock(key, task) {
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    tails.set(key, tail);
    await previous.catch(() => {});
    try {
        return await task();
    } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
    }
}

module.exports = { withKeyLock };
