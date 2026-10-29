import assert from "node:assert/strict";
import test from "node:test";
import { createVisualLoop } from "../src/visual-loop.js";

function fakeEnvironment({ hidden = false, mediaMatches = false } = {}) {
  const frames = [];
  const timers = [];
  const listeners = new Map();
  const windowObject = {
    matchMedia: () => ({
      matches: mediaMatches,
      addEventListener() {},
      removeEventListener() {},
    }),
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  };
  const documentObject = {
    hidden,
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  return { windowObject, documentObject, frames, timers, listeners };
}

test("reduced motion paints once and never starts an animation timer", () => {
  const env = fakeEnvironment();
  const draws = [];
  const loop = createVisualLoop((now) => draws.push(now), {
    windowObject: env.windowObject,
    documentObject: env.documentObject,
    reducedMotion: true,
  });
  assert.equal(env.frames.length, 1);
  env.frames.shift()(1000);
  assert.deepEqual(draws, [0]);
  assert.equal(env.timers.length, 0);
  loop.dispose();
});

test("prefers-reduced-motion media query also freezes to one frame", () => {
  const env = fakeEnvironment({ mediaMatches: true });
  const draws = [];
  const loop = createVisualLoop((now) => draws.push(now), {
    windowObject: env.windowObject,
    documentObject: env.documentObject,
  });
  env.frames.shift()(1000);
  assert.deepEqual(draws, [0]);
  assert.equal(env.timers.length, 0);
  loop.dispose();
});

test("hidden documents do not schedule frames, and dispose stops the loop", () => {
  const env = fakeEnvironment({ hidden: true });
  let draws = 0;
  const loop = createVisualLoop(() => draws++, {
    windowObject: env.windowObject,
    documentObject: env.documentObject,
  });
  assert.equal(env.frames.length, 0);
  loop.invalidate();
  assert.equal(env.frames.length, 0);
  loop.dispose();
  assert.equal(draws, 0);
});
