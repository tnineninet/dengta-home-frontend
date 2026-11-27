import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_HUMAN_ENERGY,
  RECOVERY_ACTIONS,
  createDefaultCompanionStatus,
  createResetCompanionStatus,
  localCompanionInteractionReaction,
  readCompanionStatus,
  recordCompanionInteraction,
  createDefaultCompanionInteractionStats,
  settleAmbientCompanionEnergy,
} from "../src/companion-status.js";
import {
  describeCareSectionHeading,
  describeRecoveryIntent,
  resolveHumanEmotionQuadrant,
} from "../src/emotion-state.js";
import { normalizeSimplifiedPlaceName } from "../src/live-location-weather.js";
import { BallPhysics } from "../src/cotton/upstream/interaction-controller.js";

test("human energy baseline stays in healthy 70-80 range, never resets to 0, and heals legacy 0% storage", () => {
  const def = createDefaultCompanionStatus();
  assert.ok(def.energyLevel >= 70 && def.energyLevel <= 80, `default energy ${def.energyLevel} must be 70-80`);

  const reset = createResetCompanionStatus();
  assert.equal(reset.resetBlank, true);
  assert.ok(reset.energyLevel >= 70 && reset.energyLevel <= 80, `reset energy ${reset.energyLevel} must never be 0`);
  assert.ok(reset.pulseBpm >= 60 && reset.pulseBpm <= 90, `reset pulse ${reset.pulseBpm} must be alive`);

  // Legacy persisted 0% heals back to healthy baseline on read
  const prevStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    store.set(
      "dengta_companion_status_v1:heal-test",
      JSON.stringify({
        mood: "平静",
        energyLevel: 0,
        pulseBpm: 0,
        statusSource: "",
        updatedAt: new Date().toISOString(),
      }),
    );
    const healed = readCompanionStatus("heal-test");
    assert.equal(healed.energyLevel, DEFAULT_HUMAN_ENERGY);
    assert.ok(healed.pulseBpm >= 60);
  } finally {
    globalThis.localStorage = prevStorage;
  }

  // Circadian ambient settling never drains a healthy companion down to 0
  const daytime = Date.parse("2026-11-27T06:00:00.000Z"); // 14:00 CST
  let current = {
    ...def,
    energyLevel: 88,
    updatedAt: new Date(daytime - 60 * 60 * 1000).toISOString(),
  };
  for (let i = 0; i < 40; i += 1) {
    current = settleAmbientCompanionEnergy(current, daytime + (i + 1) * 30 * 60 * 1000);
  }
  assert.ok(current.energyLevel >= 56, `ambient energy ${current.energyLevel} must never drain toward 0`);
});

test("authentic human 喜怒哀乐 quadrants and context-aware care actions replace gamey +HP meters", () => {
  assert.equal(resolveHumanEmotionQuadrant("guarded", { mood: "有点吃醋" }).badge, "怒");
  assert.equal(resolveHumanEmotionQuadrant("low", { mood: "委屈" }).badge, "哀");
  assert.equal(resolveHumanEmotionQuadrant("joyful", { mood: "开心" }).badge, "喜");
  assert.equal(resolveHumanEmotionQuadrant("calm", { mood: "平静" }).badge, "乐");

  const angryCare = describeCareSectionHeading("guarded", 76, "小小灯", "TA");
  assert.match(angryCare.kicker, /顺毛哄哄/);
  const angryEmbrace = describeRecoveryIntent("embrace", "guarded", 76, "TA");
  assert.match(angryEmbrace.label, /顺毛|抱抱/);
  assert.doesNotMatch(angryEmbrace.caption, /回元气|\+\d+%/);

  const embraceAction = RECOVERY_ACTIONS.find((a) => a.id === "embrace");
  const stats = recordCompanionInteraction(createDefaultCompanionInteractionStats(), "embrace");
  const grumpyReply = localCompanionInteractionReaction(embraceAction, stats, 1, {
    mood: "赌气",
    energyLevel: 76,
    pulseBpm: 80,
  });
  assert.match(grumpyReply.mood, /嘴硬心软/);
  assert.match(grumpyReply.text, /哼|服软|气/);

  const statusSource = fs.readFileSync(new URL("../src/CompanionStatus.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(statusSource, /回元气 \+/, "must not show gamey +HP recovery percentage labels");
});

test("location place names normalize Traditional Chinese to Simplified and weather pill stays compact", () => {
  assert.equal(normalizeSimplifiedPlaceName("上海市 · 黃浦區"), "上海市 · 黄浦区");
  assert.equal(normalizeSimplifiedPlaceName("臺北市"), "台北市");
  const statusSource = fs.readFileSync(new URL("../src/CompanionStatus.jsx", import.meta.url), "utf8");
  assert.match(statusSource, /di-top-capsule-row/);
  assert.match(statusSource, /di-weather-capsule-btn/);
  assert.match(statusSource, /di-panel-tabs/);
});

test("CottonPet ball physics responds to phone gyroscope tilt gravity and bounces cleanly", () => {
  const ball = new BallPhysics();
  ball.position = { x: 0, y: ball.radius, z: 0.3 };
  ball.velocity = { x: 0, y: 0, z: 0 };
  ball.setTiltGravity(3.0, -1.8);
  for (let i = 0; i < 30; i += 1) {
    ball.update(1 / 60);
  }
  assert.ok(ball.position.x > 0.08, `tilt gravity should accelerate ball along +X, got ${ball.position.x}`);
  assert.ok(ball.position.z < 0.25, `tilt gravity should accelerate ball along -Z, got ${ball.position.z}`);
});

test("chat mic supports tap-to-talk + speech recognition fallback and CottonPet House scrolls cleanly", () => {
  const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(appSource, /localSpeechListening/);
  assert.match(appSource, /getSpeechRecognitionCtor/);
  assert.match(appSource, /requestNativeMediaPermissions/);

  const cottonCss = fs.readFileSync(new URL("../src/cotton-pet.css", import.meta.url), "utf8");
  assert.match(cottonCss, /\.cotton-pet\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(cottonCss, /touch-action:\s*pan-y/);

  const desktopPet = fs.readFileSync(new URL("../src/CottonDesktopPet.jsx", import.meta.url), "utf8");
  assert.match(desktopPet, /translate3d\(/);
  assert.match(desktopPet, /createGyroController/);
});
