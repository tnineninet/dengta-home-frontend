import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatMemoryJobs } from "../src/chat-memory-jobs.js";

const kiwi = { ok: true, provider: "kiwi", storage: "kiwi", tenant_verified: true };
const sync = { ...kiwi, accepted: true, job_id: "job-1", turn_id: "turn-1", status: "pending" };
const done = { type: "done", ok: true, conversation_id: "chat", assistant_message: { id: "turn-1" }, memory_sync: sync };
const completed = { ...kiwi, job: { id: "job-1", status: "succeeded", result: { extraction: { saved: 0, skipped: 1, total: 4 } } } };
function fixture() {
  let current = true;
  const reads = [], events = [], jobEvents = [], timers = new Set();
  const watcher = createChatMemoryJobs({
    readJob: id => new Promise((resolve, reject) => reads.push({ id, resolve, reject })),
    notify: (source, jobId) => { events.push(source); jobEvents.push([source, jobId]); }, isCurrent: () => current,
    schedule: fn => { timers.add(fn); return fn; }, cancel: fn => timers.delete(fn),
  });
  return { watcher, reads, events, jobEvents, timers, retire: () => { current = false; },
    tick() { for (const fn of [...timers]) { timers.delete(fn); fn(); } } };
}
test("only a verified chat receipt for this completed turn starts a status read", () => {
  const f = fixture();
  for (const event of [null, { ...done, ok: false }, { ...done, conversation_id: "elsewhere" }, { ...done, memory_sync: null },
    ...[{ tenant_verified: false }, { accepted: false }, { turn_id: "another-turn" }, { job_id: "../bad" }, { provider: "old" }]
      .map(change => ({ ...done, memory_sync: { ...sync, ...change } }))]) f.watcher.observe(event, "chat");
  assert.equal(f.reads.length, 0);
  assert.deepEqual(f.events, []);
});
test("duplicate done and intermediate job statuses cause only one terminal invalidation, including zero new entries", async () => {
  const f = fixture();
  f.watcher.observe(done, "chat"); f.watcher.observe(done, "chat");
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve({ ...kiwi, job: { id: "job-1", status: "running" } }); await Promise.resolve();
  assert.deepEqual(f.events, ["chat-job-accepted"]);
  f.tick(); assert.equal(f.reads.length, 2);
  f.reads[1].resolve(completed); await Promise.resolve(); f.watcher.observe(done, "chat"); f.tick();
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.events, ["chat-job-accepted", "chat-job-succeeded"]);
});
test("a failed, partial or wrong job receipt never marks the profile as updated", async () => {
  for (const [reply, expected] of [[{ ...kiwi, job: { id: "job-1", status: "failed" } }, "chat-job-failed"],
    [{ ...kiwi, job: { id: "job-1", status: "cancelled" } }, "chat-job-cancelled"], [{ ...completed, storage: "legacy" }, "chat-job-unconfirmed"],
    [{ ...completed, tenant_verified: false }, "chat-job-unconfirmed"], [{ ...completed, job: { ...completed.job, id: "job-2" } }, "chat-job-unconfirmed"],
    [{ ...completed, job: { ...completed.job, result: {} } }, "chat-job-unconfirmed"]]) {
    const f = fixture(); f.watcher.observe(done, "chat"); f.reads[0].resolve(reply); await Promise.resolve();
    assert.deepEqual(f.events, ["chat-job-accepted", expected]); assert.equal(f.timers.size, 0);
  }
});
test("evicting a pending watch clears only that job's wait state and ignores its late answer", async () => {
  const f = fixture();
  for (let i = 1; i <= 9; i++) f.watcher.observe({ ...done, assistant_message: { id: `turn-${i}` }, memory_sync: { ...sync, job_id: `job-${i}`, turn_id: `turn-${i}` } }, "chat");
  assert.deepEqual(f.jobEvents.slice(-2), [["chat-job-unconfirmed", "job-1"], ["chat-job-accepted", "job-9"]]);
  f.reads[0].resolve(completed); await Promise.resolve();
  f.watcher.observe(done, "chat"); assert.equal(f.reads.length, 9);
  f.reads[1].resolve({ ...kiwi, job: { id: "job-2", status: "cancelled" } }); await Promise.resolve();
  assert.deepEqual(f.jobEvents.at(-1), ["chat-job-cancelled", "job-2"]);
  assert.ok(!f.events.includes("chat-job-succeeded"));
});
test("disposing or changing the account while reading never publishes to the next account", async () => {
  for (const change of [f => f.retire(), f => f.watcher.dispose()]) {
    const f = fixture(); f.watcher.observe(done, "chat"); change(f);
    f.reads[0].resolve(completed); await Promise.resolve(); f.tick();
    assert.deepEqual(f.events, ["chat-job-accepted"]); assert.equal(f.timers.size, 0);
  }
});
test("transient errors and pending jobs are bounded without inferring completion", async () => {
  const f = fixture(); f.watcher.observe(done, "chat");
  for (let n = 0; n < 24; n++) { f.reads[n].reject(new Error("offline")); await Promise.resolve(); f.tick(); }
  assert.equal(f.reads.length, 24); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.events, ["chat-job-accepted", "chat-job-unconfirmed"]);
});
