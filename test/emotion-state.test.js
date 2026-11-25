import assert from "node:assert/strict";
import test from "node:test";
import {
  XINCHAO_DRIVE_LABELS,
  classifyEmotionTone,
  deriveLocalEmotionSnapshot,
  describeEnergyState,
  describeMoodMeter,
  describePatienceMeter,
  describePulseState,
  localizeConsciousness,
  localizeMoodWord,
  localizeXinchaoEmotion,
  resolveEmotionPresentation,
} from "../src/emotion-state.js";

test("emotion presentation localizes flat/English moods and replaces mechanical labels", () => {
  assert.equal(localizeMoodWord("平静"), "安稳静谧");
  assert.equal(localizeMoodWord("开心"), "眉眼含笑");
  assert.equal(localizeMoodWord("有点害羞"), "耳尖发烫");
  assert.equal(localizeMoodWord("happy"), "眉眼含笑");
  assert.equal(localizeMoodWord("melancholy"), "心绪微沉");
  assert.equal(localizeMoodWord("想听窗外雨声"), "想听窗外雨声");

  assert.equal(localizeXinchaoEmotion("tender"), "温润柔软");
  assert.equal(localizeConsciousness("awake"), "清醒陪伴中");
  assert.equal(localizeConsciousness("dreaming"), "浅梦浮想");
  assert.equal(XINCHAO_DRIVE_LABELS.libido, "心动牵引");
  assert.equal(XINCHAO_DRIVE_LABELS.monitor, "悄悄惦记");

  assert.equal(describeEnergyState(92), "元气满满");
  assert.equal(describeEnergyState(72), "状态正好");
  assert.equal(describeEnergyState(18), "电量偏低");
  assert.equal(describePulseState(112), "怦怦加快");
  assert.equal(describePulseState(74), "平稳轻缓");
  assert.equal(describeMoodMeter(null).display, "细细体会");
  assert.equal(describeMoodMeter(86).display, "雀跃明朗 · 86");
  assert.equal(describePatienceMeter(null).display, "随心舒展");
  assert.equal(describePatienceMeter(84).display, "从容温柔 · 84");
});

test("resolveEmotionPresentation classifies tones and produces natural presence copy", () => {
  const calmView = resolveEmotionPresentation({
    mood: "平静",
    energyLevel: 72,
    pulseBpm: 76,
    moodLevel: null,
    patienceLevel: null,
    statusSource: "",
  });
  assert.equal(calmView.tone, "calm");
  assert.equal(calmView.displayMood, "安稳静谧");
  assert.equal(calmView.sourceBadge, "静静等你靠近");
  assert.equal(calmView.presenceLabel, "安稳守在身旁");

  const shyModelView = resolveEmotionPresentation(
    {
      mood: "有点害羞",
      energyLevel: 80,
      pulseBpm: 108,
      moodLevel: 84,
      patienceLevel: 76,
      statusSource: "model",
    },
    { isResponding: false },
  );
  assert.equal(shyModelView.tone, "shy");
  assert.equal(shyModelView.displayMood, "耳尖发烫");
  assert.equal(shyModelView.sourceBadge, "此刻真情流露");
  assert.equal(shyModelView.pulseLabel, "怦怦加快");

  const respondingView = resolveEmotionPresentation(
    { mood: "开心", energyLevel: 78, pulseBpm: 88 },
    { isResponding: true },
  );
  assert.equal(respondingView.presenceLabel, "轻声斟酌回复中");
  assert.equal(respondingView.vitalsPresence, "正在认真回你");
  assert.equal(classifyEmotionTone({ mood: "困倦", energyLevel: 20 }), "tired");
});

test("deriveLocalEmotionSnapshot creates distinct psychology & feeling and bounded meters", () => {
  const snap = deriveLocalEmotionSnapshot(
    { id: "hand", focus: "感受你指尖的靠近" },
    { mode: "shy", streakCount: 3, microState: "视线躲开了一瞬" },
    { moodLevel: 72, patienceLevel: 80 },
  );
  assert.ok(snap.psychology.length > 5);
  assert.ok(snap.feeling.length > 5);
  assert.notEqual(snap.psychology, snap.feeling);
  assert.ok(snap.moodLevel >= 12 && snap.moodLevel <= 100);
  assert.ok(snap.patienceLevel >= 15 && snap.patienceLevel <= 100);

  // Regression: null moodLevel/patienceLevel must start from healthy defaults (72 / 82), never Number(null) === 0
  const fromNull = deriveLocalEmotionSnapshot(
    { id: "hand", focus: "感受你指尖的靠近" },
    { mode: "shy", streakCount: 1, microState: "视线躲开了一瞬" },
    { moodLevel: null, patienceLevel: null },
  );
  assert.equal(fromNull.moodLevel, 78);
  assert.equal(fromNull.patienceLevel, 83);
});
