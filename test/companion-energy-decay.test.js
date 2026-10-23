import assert from "node:assert/strict";
import test from "node:test";
import {
  ENERGY_DECAY_INTERVAL_MS,
  createDefaultCompanionStatus,
  decayCompanionEnergy,
} from "../src/companion-status.js";

test("companion energy decays with elapsed time and stops at zero", () => {
  const now = Date.parse("2026-10-23T06:00:00.000Z");
  const status = {
    ...createDefaultCompanionStatus(),
    energyLevel: 60,
    revision: 4,
    updatedAt: new Date(now - 10 * 60 * 1000).toISOString(),
  };
  const decayed = decayCompanionEnergy(status, now);
  assert.equal(decayed.energyLevel, 55);
  assert.equal(decayed.revision, 5);
  assert.equal(decayed.updatedAt, new Date(now).toISOString());
  assert.equal(decayCompanionEnergy(decayed, now + ENERGY_DECAY_INTERVAL_MS - 1), decayed);

  const empty = { ...status, energyLevel: 3, updatedAt: new Date(now - ENERGY_DECAY_INTERVAL_MS).toISOString() };
  assert.equal(decayCompanionEnergy(empty, now).energyLevel, 2);
  const zero = { ...empty, energyLevel: 0 };
  assert.equal(decayCompanionEnergy(zero, now), zero);
});
