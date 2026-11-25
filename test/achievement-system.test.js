import assert from "node:assert/strict";
import test from "node:test";
import {
  ACHIEVEMENT_CATALOG_META,
  ACHIEVEMENT_RANKS,
  CUSTOM_ACHIEVEMENT_IDEAS,
  PREVIEW_ACHIEVEMENTS,
  computeAchievementSummary,
  enrichAchievementItem,
  readPinnedAchievements,
  resolveAchievementRank,
  savePinnedAchievements,
  togglePinnedAchievement,
} from "../src/achievement-system.js";
import { ACHIEVEMENT_ACTIONS } from "../src/achievement-guide.js";

test("every catalog achievement has metadata, rarity, points, hint and guided action", () => {
  for (const code of Object.keys(ACHIEVEMENT_CATALOG_META)) {
    assert.ok(ACHIEVEMENT_ACTIONS[code], `Expected direct action for ${code}`);
    const enriched = enrichAchievementItem({ code, title: code, unlocked: false });
    assert.ok(enriched.points >= 15);
    assert.ok(enriched.hint.length > 0);
    assert.ok(["warm", "star", "aurora", "secret"].includes(enriched.rarityTone));
  }
  assert.ok(CUSTOM_ACHIEVEMENT_IDEAS.length >= 6);
});

test("starlight ranks, progress, and smart next-up recommendations calculate accurately", () => {
  assert.equal(resolveAchievementRank(0).currentRank.level, 1);
  assert.equal(resolveAchievementRank(80).currentRank.level, 2);
  assert.equal(resolveAchievementRank(200).currentRank.level, 3);
  assert.equal(resolveAchievementRank(400).currentRank.level, 4);
  assert.equal(resolveAchievementRank(600).currentRank.level, 5);
  assert.equal(resolveAchievementRank(600).nextRank, null);
  assert.equal(ACHIEVEMENT_RANKS.length, 5);

  const summary = computeAchievementSummary(PREVIEW_ACHIEVEMENTS);
  assert.equal(summary.unlockedCount, 6);
  assert.equal(summary.totalCount, PREVIEW_ACHIEVEMENTS.length);
  assert.ok(summary.totalPoints >= 150);
  assert.equal(summary.rank.currentRank.level, 2);
  assert.ok(summary.rank.pointsToNextRank > 0);
  // Highest-progress locked achievement (chat_10 at 80%) should be recommended first!
  assert.equal(summary.recommendedNext[0].code, "chat_10");
});

test("pinned trophy showcase enforces max 3 slots and persists per scope", () => {
  const original = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    let pins = [];
    pins = togglePinnedAchievement(pins, "first_chat");
    pins = togglePinnedAchievement(pins, "music_1");
    pins = togglePinnedAchievement(pins, "art_1");
    pins = togglePinnedAchievement(pins, "explorer_1");
    assert.equal(pins.length, 3);
    assert.deepEqual(pins, ["explorer_1", "art_1", "music_1"]);

    savePinnedAchievements("acc1:comp1", pins);
    assert.deepEqual(readPinnedAchievements("acc1:comp1"), ["explorer_1", "art_1", "music_1"]);
    assert.deepEqual(readPinnedAchievements("acc2:comp1"), []);

    pins = togglePinnedAchievement(pins, "art_1");
    assert.deepEqual(pins, ["explorer_1", "music_1"]);
  } finally {
    globalThis.localStorage = original;
  }
});
