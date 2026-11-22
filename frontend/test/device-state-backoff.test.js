import assert from "node:assert/strict";
import test from "node:test";
import { reportDeviceState } from "../src/device-signals.js";

test("device state reporting backs off after repeated backend failures", async () => {
  let calls = 0;
  const client = async () => {
    calls += 1;
    throw new Error("fictional device state 500");
  };
  for (let index = 0; index < 6; index += 1) {
    assert.equal(await reportDeviceState({ battery_pct: 50 }, { client }), null);
  }
  assert.equal(calls, 3, "the fourth request is suppressed for the cooldown window");
});
