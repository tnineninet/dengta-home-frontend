
import fs from "node:fs";
import assert from "node:assert/strict";
const status = fs.readFileSync("src/CompanionStatus.jsx", "utf8");
const checks = [];
function match(name, re, input, msg) {
  try { assert.match(input, re, msg); checks.push("OK  " + name); }
  catch (e) { checks.push("FAIL " + name + " :: " + (msg || e.message)); }
}
function noMatch(name, re, input, msg) {
  try { assert.doesNotMatch(input, re, msg); checks.push("OK  " + name); }
  catch (e) { checks.push("FAIL " + name + " :: " + (msg || e.message)); }
}
match("toggle-class", /className="sun-glass-liquid-capsule-toggle"/, status);
match("toggle-expanded", /sun-glass-liquid-capsule-toggle[\s\S]*?aria-expanded=\{expanded\}[\s\S]*?onClick=\{togglePanel\}/, status);
match("decoration-heart", /sun-glass-capsule-decoration[\s\S]*?<Heart[\s\S]*?<MessageCircle[\s\S]*?<Sparkles/, status);
noMatch("no-quick-actions", /sun-glass-liquid-action-stage[\s\S]*?QUICK_ACTIONS\.map/, status);
match("nav", /onOpenNavigation/, status);
match("settings", /onOpenSettings/, status);
noMatch("no-drag", /dragPosition|data-status-drag-handle/, status);
console.log(checks.join("\n"));
