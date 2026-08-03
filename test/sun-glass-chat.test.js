import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("the approved Variant A controls are wired into the real chat screen", () => {
  const app = read("src/App.jsx");
  const deck = read("src/SunGlassTimeDeck.jsx");
  const status = read("src/CompanionStatus.jsx");

  assert.match(app, /<SunGlassTimeDeck[\s\S]*?onGlassLevel=/);
  assert.match(app, /weatherModeOverride=\{weatherPreviewMode\}/);
  assert.match(deck, /清晨 08:00/);
  assert.match(deck, /红霞 18:00/);
  assert.match(deck, /蓝调 18:40/);
  assert.match(deck, /银河 22:00/);
  assert.match(deck, /微云/);
  assert.match(deck, /雨幕/);
  assert.match(deck, /晴雷/);
  assert.match(deck, /晴空/);
  assert.match(deck, /aria-label="全局玻璃度"/);
  assert.match(status, /sun-glass-liquid-action-stage/);
  assert.match(status, /sun-glass-popover-liquid-actions/);
  assert.match(status, /Heart/);
  assert.match(status, /MessageCircle/);
  assert.match(status, /Sparkles/);
  assert.match(status, /听歌/);
  assert.match(status, /看书/);
  assert.match(status, /看电视/);
  assert.match(status, /sun-glass-floating-status-shell/);
  assert.match(status, /sun-glass-status-scroll/);
  assert.match(status, /data-status-drag-handle/);
  assert.doesNotMatch(
    status,
    /status-advanced-content/,
    "the legacy dark status dashboard must not remain behind the glass template",
  );
});

test("the mobile layer preserves the prototype dimensions and jelly motion", () => {
  const styles = read("src/sun-glass-chat.css");

  assert.match(
    styles,
    /\.sun-glass-liquid-action-module\s*\{[\s\S]*?width:\s*236px;[\s\S]*?height:\s*64px;[\s\S]*?border-radius:\s*34px;/,
  );
  assert.match(
    styles,
    /\.sun-glass-status-ribbon\s*\{[\s\S]*?min-height:\s*70px;[\s\S]*?border-radius:\s*25px;/,
  );
  assert.match(
    styles,
    /\.sun-glass-time-deck\s*\{[\s\S]*?border-radius:\s*25px;/,
  );
  assert.match(styles, /@keyframes sun-glass-liquid-color-crossing/);
  assert.match(styles, /@keyframes sun-glass-rainbow-shimmer/);
  assert.match(styles, /@keyframes sun-glass-rainbow-breathe/);
  assert.match(styles, /@keyframes sun-glass-jelly-open/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the local visual preview is isolated from production startup data", () => {
  const app = read("src/App.jsx");

  assert.match(app, /const visualPreview = arguments\[0\]\?\.visualPreview === true/);
  assert.match(app, /if \(visualPreview\)[\s\S]*?setIsLoading\(false\)/);
  assert.match(app, /showStartupRecovery =\s*!visualPreview/);
});

test("time preview changes the shared sky snapshot without changing system time", () => {
  const theme = read("src/dengta-theme.js");
  const backdrop = read("src/CelestialBackdrop.jsx");

  assert.match(theme, /const \[previewMinute, setPreviewMinute\] = useState\(null\)/);
  assert.match(theme, /dateAtChinaMinute\(clock, previewMinute\)/);
  assert.match(backdrop, /weatherModeOverride/);
  assert.match(backdrop, /\["clear", "cloudy", "rain", "storm"\]\.includes/);
});
