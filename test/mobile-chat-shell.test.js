import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("mobile chat uses one decorative rainbow capsule as the status toggle", () => {
  const status = read("src/CompanionStatus.jsx");
  const styles = read("src/sun-glass-chat.css");

  assert.match(status, /className="sun-glass-liquid-capsule-toggle"/);
  assert.match(
    status,
    /sun-glass-liquid-capsule-toggle[\s\S]*?aria-expanded=\{expanded\}[\s\S]*?onClick=\{togglePanel\}/,
  );
  assert.match(
    status,
    /sun-glass-capsule-decoration[\s\S]*?<Heart[\s\S]*?<MessageCircle[\s\S]*?<Sparkles/,
  );
  assert.doesNotMatch(
    status,
    /sun-glass-liquid-action-stage[\s\S]*?QUICK_ACTIONS\.map/,
    "the decorative capsule icons must not remain independent action buttons",
  );
  assert.match(status, /onOpenNavigation/);
  assert.match(status, /onOpenSettings/);
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.main-panel\.view-chat > \.topbar\s*\{[^}]*display:\s*none/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.sun-glass-status-ribbon\s*\{[^}]*display:\s*none/s,
  );
  assert.match(
    styles,
    /\.sun-glass-floating-status-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s,
  );
});

test("time and weather controls live inside the plus menu and coalesce scrubbing", () => {
  const app = read("src/App.jsx");
  const deck = read("src/SunGlassTimeDeck.jsx");
  const menuStart = app.indexOf('<section className="composer-tool-menu"');
  const deckStart = app.indexOf("<SunGlassTimeDeck");

  assert.ok(menuStart >= 0, "the plus menu must exist");
  assert.ok(
    deckStart > menuStart,
    "the time deck must not occupy the always-visible composer area",
  );
  assert.match(deck, /requestAnimationFrame/);
  assert.match(deck, /cancelAnimationFrame/);
  assert.match(deck, /data-time-scrubbing/);
});

test("mobile message bubbles expand toward the screen edges", () => {
  const styles = read("src/sun-glass-chat.css");

  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.main-panel\.view-chat \.message-list\s*\{[^}]*padding-inline:\s*8px/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.main-panel\.view-chat \.message-bubble[^{]*\{[^}]*max-width:\s*min\(94%,\s*720px\)/s,
  );
});
