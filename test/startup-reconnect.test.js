import assert from "node:assert/strict";
import {
  STARTUP_REQUEST_OPTIONS,
  createStartupReconnectController,
  mergeRecoveredStartupData,
} from "../src/startup-reconnect.js";

assert.deepEqual(STARTUP_REQUEST_OPTIONS, {
  retry: false,
  timeoutMs: 15_000,
});

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimeoutFake(callback, delay = 0) {
    const id = nextId;
    nextId += 1;
    timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
    return id;
  }

  function clearTimeoutFake(id) {
    timers.delete(id);
  }

  async function advanceBy(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.callback();
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    }
    now = target;
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  }

  return {
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    advanceBy,
    pendingDelays() {
      return [...timers.values()].map((timer) => timer.at - now).sort((a, b) => a - b);
    },
  };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) || new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      [...(listeners.get(type) || [])].forEach((listener) => listener({ type }));
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

{
  const timers = createFakeTimers();
  const attempts = [];
  const controller = createStartupReconnectController({
    attempt: async () => {
      attempts.push(timers.pendingDelays());
      throw new Error("backend asleep");
    },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await controller.start();
  assert.deepEqual(timers.pendingDelays(), [2_000]);
  await timers.advanceBy(2_000);
  assert.deepEqual(timers.pendingDelays(), [5_000]);
  await timers.advanceBy(5_000);
  assert.deepEqual(timers.pendingDelays(), [10_000]);
  await timers.advanceBy(10_000);
  assert.deepEqual(timers.pendingDelays(), [30_000]);
  await timers.advanceBy(30_000);
  assert.deepEqual(timers.pendingDelays(), [30_000]);
  assert.equal(attempts.length, 5);
  controller.stop();
}

{
  const timers = createFakeTimers();
  const windowTarget = createEventTarget();
  let calls = 0;
  const controller = createStartupReconnectController({
    attempt: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { ok: true };
    },
    windowTarget,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await controller.start();
  assert.deepEqual(timers.pendingDelays(), [2_000]);
  windowTarget.dispatch("online");
  await flushPromises();
  assert.equal(calls, 2, "online must retry immediately");
  assert.deepEqual(timers.pendingDelays(), []);
  controller.stop();
}

{
  const timers = createFakeTimers();
  const documentTarget = Object.assign(createEventTarget(), {
    visibilityState: "visible",
  });
  let calls = 0;
  const controller = createStartupReconnectController({
    attempt: async () => {
      calls += 1;
      throw new Error("still unavailable");
    },
    documentTarget,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await controller.start();
  documentTarget.visibilityState = "hidden";
  documentTarget.dispatch("visibilitychange");
  assert.deepEqual(
    timers.pendingDelays(),
    [30_000],
    "hidden pages must pause high-frequency retries",
  );
  await timers.advanceBy(10_000);
  assert.equal(calls, 1);
  documentTarget.visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  await flushPromises();
  assert.equal(calls, 2, "returning visible must retry immediately");
  controller.stop();
}

{
  const timers = createFakeTimers();
  const pendingAttempt = deferred();
  let concurrent = 0;
  let peakConcurrent = 0;
  let calls = 0;
  const controller = createStartupReconnectController({
    attempt: async () => {
      calls += 1;
      concurrent += 1;
      peakConcurrent = Math.max(peakConcurrent, concurrent);
      try {
        return await pendingAttempt.promise;
      } finally {
        concurrent -= 1;
      }
    },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  const first = controller.start();
  const second = controller.retryNow("manual");
  const third = controller.retryNow("online");
  await flushPromises();
  assert.equal(calls, 1);
  assert.equal(peakConcurrent, 1);
  pendingAttempt.resolve({ ok: true });
  await Promise.all([first, second, third]);
  controller.stop();
}

{
  const timers = createFakeTimers();
  let current = {
    message: "还没发出的草稿",
    messageReference: { id: 42, text: "上一张照片" },
    chatAttachments: [{ id: "photo-1", name: "selfie.jpg" }],
    sessions: [{ id: 1, title: "旧会话" }],
    activeSessionId: 1,
    settings: { ai_name: "旧名字" },
  };
  let calls = 0;
  const controller = createStartupReconnectController({
    attempt: async () => {
      calls += 1;
      if (calls === 1) throw new Error("cold start timeout");
      current = mergeRecoveredStartupData(current, {
        sessions: [
          { id: 2, title: "另一会话" },
          { id: 1, title: "当前会话" },
        ],
        settings: { ai_name: "小灯" },
      });
    },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await controller.start();
  const latestReference = { id: 43, text: "等待重连时新引用的消息" };
  const latestAttachments = [{ id: "photo-2", name: "new-photo.jpg" }];
  current = {
    ...current,
    message: "等待重连时继续写的新草稿",
    messageReference: latestReference,
    chatAttachments: latestAttachments,
  };
  await timers.advanceBy(2_000);

  assert.equal(current.message, "等待重连时继续写的新草稿");
  assert.equal(current.messageReference, latestReference);
  assert.equal(current.chatAttachments, latestAttachments);
  assert.equal(current.activeSessionId, 1);
  assert.equal(current.settings.ai_name, "小灯");
  controller.stop();
}

console.log("startup reconnect tests passed");
