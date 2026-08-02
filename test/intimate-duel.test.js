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

const first = playDuelRound(initial, "neck", () => 0);
assert.equal(first.state.round, 2);
assert.equal(first.state.player.combo, 1);
assert.equal(first.event.playerSkill.id, "neck");
assert.ok(first.event.companionSkill);

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
assert.match(statusSource, /dengta_companion_status_minimized_v1/);
assert.match(statusSource, /className="status-restore-button"/);
assert.match(cssSource, /\.chat-presence-stack:has\(\.companion-status\.minimized\)/);
assert.match(cssSource, /\.duel-skill-grid\s*\{[\s\S]*?grid-template-columns: repeat\(3/);

console.log("frontend intimate duel tests passed");
