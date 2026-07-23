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
  css,
  /\.status-panel\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s,
  "expanded status content must use an independent scroll container",
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
