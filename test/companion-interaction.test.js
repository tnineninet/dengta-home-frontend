import assert from "node:assert/strict";
import {
  HOT_ZONES,
  createDefaultCompanionInteractionStats,
  localCompanionInteractionReaction,
  normalizeCompanionInteractionStats,
  recordCompanionInteraction,
} from "../src/companion-status.js";
import { enqueueCompanionInteraction } from "../src/companion-interaction.js";

const handZone = HOT_ZONES.find((zone) => zone.id === "hand");
const shoulderZone = HOT_ZONES.find((zone) => zone.id === "shoulder");
assert.ok(handZone);
assert.ok(shoulderZone);

let stats = createDefaultCompanionInteractionStats();
const startedAt = Date.parse("2026-07-21T08:00:00.000Z");

for (let index = 0; index < 100; index += 1) {
  stats = recordCompanionInteraction(stats, "hand", startedAt + index * 100);
}

assert.equal(stats.counts.hand, 100);
assert.equal(stats.streakCount, 100);
assert.equal(stats.lastZoneId, "hand");

const hundredthReaction = localCompanionInteractionReaction(
  handZone,
  stats,
  100,
);
assert.match(hundredthReaction.text, /100/);
assert.match(hundredthReaction.record, /100/);

const switched = recordCompanionInteraction(
  stats,
  "shoulder",
  startedAt + 10_100,
);
assert.equal(switched.counts.shoulder, 1);
assert.equal(switched.streakCount, 1);
assert.equal(switched.lastZoneId, "shoulder");

const afterPause = recordCompanionInteraction(
  switched,
  "shoulder",
  startedAt + 41_000,
);
assert.equal(afterPause.counts.shoulder, 2);
assert.equal(afterPause.streakCount, 1);

let queueStats = createDefaultCompanionInteractionStats();
let interactionQueue = [];
for (let index = 0; index < 100; index += 1) {
  const now = startedAt + index * 50;
  queueStats = recordCompanionInteraction(queueStats, "hand", now);
  interactionQueue = enqueueCompanionInteraction({
    queue: interactionQueue,
    zoneId: "hand",
    stats: queueStats,
    sessionId: "session-a",
    now,
    eventId: `event-${index}`,
  });
}
assert.equal(interactionQueue.length, 1);
assert.equal(interactionQueue[0].burstCount, 100);
assert.equal(interactionQueue[0].batchCounts.hand, 100);
assert.equal(interactionQueue[0].interactionCounts.hand, 100);
assert.equal(interactionQueue[0].eventId, "event-0");

queueStats = recordCompanionInteraction(
  queueStats,
  "hand",
  startedAt + 5_100,
);
interactionQueue = enqueueCompanionInteraction({
  queue: interactionQueue,
  zoneId: "hand",
  stats: queueStats,
  sessionId: "session-a",
  now: startedAt + 5_100,
  eventId: "event-100",
});
assert.equal(interactionQueue.length, 2);
assert.equal(interactionQueue[1].burstCount, 1);
assert.equal(interactionQueue[1].interactionCounts.hand, 101);
assert.equal(interactionQueue[1].eventId, "event-100");

queueStats = recordCompanionInteraction(
  queueStats,
  "heart",
  startedAt + 5_150,
);
interactionQueue = enqueueCompanionInteraction({
  queue: interactionQueue,
  zoneId: "heart",
  stats: queueStats,
  sessionId: "session-a",
  now: startedAt + 5_150,
  eventId: "unused-merged-event",
});
assert.equal(interactionQueue[1].burstCount, 2);
assert.deepEqual(interactionQueue[1].batchCounts, {
  hand: 1,
  shoulder: 0,
  heart: 1,
  lamp: 0,
});
assert.equal(interactionQueue[1].interactionCounts.hand, 101);
assert.equal(interactionQueue[1].interactionCounts.heart, 1);
assert.deepEqual(interactionQueue[1].recentSequence, ["hand", "heart"]);

const normalized = normalizeCompanionInteractionStats({
  counts: { hand: 999999, shoulder: -2, heart: "3", unknown: 9 },
  lastZoneId: "unknown",
  streakCount: 999999,
  lastInteractionAt: "invalid",
});
assert.deepEqual(normalized.counts, {
  hand: 999999,
  shoulder: 0,
  heart: 3,
  lamp: 0,
});
assert.equal(normalized.lastZoneId, null);
assert.equal(normalized.streakCount, 0);
assert.equal(normalized.lastInteractionAt, null);

console.log("frontend companion interaction tests passed");
