import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DUEL_SKILLS,
  applyDuelNarration,
  chooseCompanionSkill,
  createDuelState,
  playDuelRound,
  skillAvailability,
} from "../src/intimate-duel.js";

const initial = createDuelState({ playerName: "桃桃", companionName: "小灯" });
assert.equal(initial.player.stamina, 100);
assert.equal(initial.companion.pleasure, 0);
assert.equal(DUEL_SKILLS.length, 6);
assert.deepEqual(
  DUEL_SKILLS.map((skill) => skill.name),
  ["骑乘", "口交", "夹紧", "挑逗", "Pegging", "喘口气"],
  "成人对战招式必须与用户提供的参考保持一致",
);
assert.deepEqual(
  DUEL_SKILLS.map((skill) => skill.id),
  ["neck", "whisper", "waist", "thigh", "reverse", "breathe"],
  "保留内部技能 ID，避免破坏既有回合规则",
);
assert.match(initial.logs[0].text, /性爱格斗/);

const first = playDuelRound(initial, "neck", () => 0);
assert.equal(first.state.round, 2);
assert.equal(first.state.player.combo, 1);
assert.equal(first.event.playerSkill.id, "neck");
assert.ok(first.event.companionSkill);
assert.match(first.state.logs.at(-1).text, /跨坐|骑乘/);

const second = playDuelRound(first.state, "whisper", () => 0);
assert.equal(second.state.player.combo, 2, "alternating attacks build a combo");
assert.equal(second.state.player.cooldowns.whisper, 1);
assert.equal(
  skillAvailability(
    second.state.player,
    DUEL_SKILLS.find((skill) => skill.id === "whisper"),
  ).available,
  false,
);

const third = playDuelRound(second.state, "neck", () => 0);
assert.equal(third.state.player.cooldowns.whisper, 0);

const pressured = createDuelState();
pressured.companion.pleasure = 76;
pressured.companion.stamina = 60;
assert.equal(
  chooseCompanionSkill(pressured, () => 0).id,
  "breathe",
  "AI prioritizes recovery near the limit",
);

const finishingState = createDuelState();
finishingState.companion.pleasure = 92;
const finished = playDuelRound(finishingState, "neck", () => 0);
assert.equal(finished.state.status, "finished");
assert.equal(finished.state.winner, "player");
assert.equal(finished.event.companionSkill, null);

const narrated = applyDuelNarration(finished.state, finished.event.id, "新的场景叙述");
assert.equal(narrated.logs.at(-1).text, "新的场景叙述");
assert.equal(narrated.winner, "player", "narration cannot rewrite the result");

const [appSource, componentSource, statusSource, cssSource] = await Promise.all([
  readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/IntimateDuel.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/CompanionStatus.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/apple-ui.css", import.meta.url), "utf8"),
]);
assert.match(appSource, /const IntimateDuel = lazy\(/);
assert.match(appSource, /\{ id: "duel", icon: "⚔", label: "Duel" \}/);
assert.match(componentSource, /\/api\/v2\/intimate-duel\/narrate/);
assert.match(componentSource, /conversation_id: conversationId \|\| undefined/);
assert.match(statusSource, /className="sun-glass-liquid-capsule-toggle"/);
assert.match(statusSource, /onOpenNavigation/);
assert.match(statusSource, /onOpenSettings/);
assert.match(cssSource, /\.duel-skill-grid\s*\{[\s\S]*?grid-template-columns: repeat\(3/);

console.log("frontend intimate duel tests passed");
