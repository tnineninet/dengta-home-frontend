import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const status = fs.readFileSync(
  new URL("../src/CompanionStatus.jsx", import.meta.url),
  "utf8",
);

assert.match(
  css,
  /--mobile-nav-reserved-height:\s*calc\(72px\s*\+\s*env\(safe-area-inset-bottom\)\)/,
  "mobile nav must expose one shared reserved height",
);
assert.match(
  css,
  /\.main-panel\s*\{[^}]*padding-bottom:\s*var\(--mobile-nav-reserved-height\)/s,
  "chat layout must reserve the full mobile nav height",
);
assert.match(
  css,
  /\.mobile-nav\s*\{[^}]*height:\s*var\(--mobile-nav-reserved-height\)/s,
  "mobile nav and chat reservation must use the same height",
);

const touchZone = status.match(
  /function touchZone\(zone\)\s*\{([\s\S]*?)\n\s*\}/,
)?.[1];
assert.ok(touchZone, "touchZone handler must exist");
assert.doesNotMatch(
  touchZone,
  /setExpanded\(false\)/,
  "interaction buttons must leave the status panel open",
);
assert.doesNotMatch(
  status,
  /interactionCollapseTimerRef|1100/,
  "interaction collapse must not depend on an arbitrary timer",
);
assert.match(
  status,
  /document\.addEventListener\("pointerdown", closeFromOutside\)/,
  "status panel must close when the user clicks outside it",
);
assert.match(
  status,
  /closest\("\.composer-wrap, \.mobile-nav"\)/,
  "using the composer or mobile navigation must not collapse the status panel",
);
assert.match(
  css,
  /\.status-panel\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s,
  "expanded status content must use an independent scroll container",
);
assert.match(
  css,
  /@media \(max-width: 820px\)[\s\S]*?\.view-chat \.view-content\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1 1 auto/s,
  "mobile chat content must remain a shrinkable region above navigation",
);
assert.doesNotMatch(
  css,
  /\.main-panel\.view-chat:has\(\.companion-status\.expanded\) \.message-list\s*\{[^}]*height:\s*0/s,
  "expanded status must not collapse the message scroller to zero height",
);
assert.match(
  css,
  /\.view-chat \.view-content\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/s,
  "chat must reserve an independent row for the composer",
);
assert.match(
  status,
  /LIVE COMPANION SIGNAL/,
  "expanded status must expose the live companion signal heading",
);
assert.match(
  status,
  /status-vital-tile energy[\s\S]*status-vital-tile resonance[\s\S]*status-vital-tile pulse/,
  "expanded status must show energy, interaction resonance and pulse tiles",
);
assert.match(
  status,
  /formatUpdatedAt\(record\.createdAt, clockNow\)/,
  "recent status records must expose readable timestamps",
);
assert.match(
  css,
  /\.status-vitals-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s,
  "the live signal metrics must keep three stable columns",
);
assert.match(
  css,
  /\.status-vital-tile\s*\{[^}]*min-height:\s*112px/s,
  "desktop metric tiles must reserve a stable height",
);
assert.match(
  css,
  /\.status-pulse-bg\s*\{[^}]*opacity:\s*0\.68/s,
  "the heartbeat trace must remain visible on mobile displays",
);

const interactionHandler = app.match(
  /function handleCompanionInteraction\(zoneId\)\s*\{([\s\S]*?)\n\s*\}/,
)?.[1];
assert.ok(interactionHandler, "chat-aware interaction handler must exist");
assert.doesNotMatch(
  interactionHandler,
  /setActiveView|shouldAutoScrollRef|CollapseToken/,
  "status interaction must not navigate, scroll chat, or remount the panel",
);
assert.match(
  interactionHandler,
  /registerCompanionInteraction\(zoneId\)/,
  "status interaction must still be recorded and answered",
);
assert.match(
  app,
  /onInteract=\{handleCompanionInteraction\}/,
  "the status panel must use the chat-aware interaction handler",
);
assert.match(
  app,
  /className="composer-tool-menu"/,
  "voice and attachment actions must live in the expandable composer menu",
);
assert.match(
  app,
  /function changeView\(view\)[\s\S]*?setIsComposerMenuOpen\(false\)[\s\S]*?setActiveView\(view\)/,
  "the composer tool menu must close when navigating away from chat",
);
assert.match(
  css,
  /\.new-chat-label\s*\{[^}]*display:\s*none/s,
  "the compact mobile new-chat button must hide its text label",
);
assert.match(
  app,
  /accept="video\/mp4,video\/webm,video\/quicktime"/,
  "the composer menu must provide a dedicated video picker",
);
assert.equal(
  (app.match(/className="voice-hold-button"/g) || []).length,
  1,
  "the hold-to-talk control must not remain duplicated below the composer",
);
assert.doesNotMatch(
  app,
  /key=\{`companion-status-/,
  "status panel must keep one stable component instance",
);
assert.match(
  app,
  /window\.setTimeout\(enqueue,\s*800\)/,
  "settings changes must be autosaved after a short debounce",
);
assert.match(
  app,
  /pendingSettingsSaveRef/,
  "autosaves must queue newer edits instead of racing requests",
);
assert.doesNotMatch(
  app,
  />保存设置</,
  "settings must not require the old bottom save button",
);

console.log("mobile layout regression tests passed");
