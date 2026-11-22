import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { installWebCompatibility } from "../src/web-compat.js";

function legacyRuntime() {
  const object = vm.runInNewContext("delete Object.hasOwn; Object");
  class Signal {}
  return { Object: object, AbortSignal: Signal, DOMException };
}

test("legacy own-property checks handle null prototypes, symbols, primitives and inherited keys", () => {
  const runtime = legacyRuntime();
  installWebCompatibility(runtime);
  const symbol = Symbol("own");
  const record = Object.assign(Object.create({ inherited: true }), { own: 1, [symbol]: 2 });
  assert.equal(runtime.Object.hasOwn(record, "own"), true);
  assert.equal(runtime.Object.hasOwn(record, symbol), true);
  assert.equal(runtime.Object.hasOwn(record, "inherited"), false);
  assert.equal(runtime.Object.hasOwn(Object.create(null), "hasOwnProperty"), false);
  assert.equal(runtime.Object.hasOwn("abc", "length"), true);
  assert.throws(() => runtime.Object.hasOwn(null, "key"), TypeError);
  assert.equal(Object.getOwnPropertyDescriptor(runtime.Object, "hasOwn").enumerable, false);
});

test("legacy aborted signals reject with the original reason, including falsy reasons", () => {
  const runtime = legacyRuntime();
  installWebCompatibility(runtime);
  const signal = new runtime.AbortSignal();
  signal.aborted = false;
  signal.throwIfAborted();
  signal.aborted = true;
  assert.throws(() => signal.throwIfAborted(), { name: "AbortError" });
  for (const reason of [new Error("canceled"), null, 0, ""]) {
    signal.reason = reason;
    let rejected = false;
    try { signal.throwIfAborted(); } catch (error) { rejected = true; assert.equal(error, reason); }
    assert.equal(rejected, true);
  }
});

test("repeated installation leaves modern native implementations intact", () => {
  const runtime = { Object, AbortSignal, DOMException };
  const own = Object.hasOwn, abort = AbortSignal.prototype.throwIfAborted;
  installWebCompatibility(runtime);
  installWebCompatibility(runtime);
  assert.equal(Object.hasOwn, own);
  assert.equal(AbortSignal.prototype.throwIfAborted, abort);
});
