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
assert.ok(
  touchZone.indexOf("setExpanded(false)") <
    touchZone.indexOf("onInteract?.(zone.id)"),
  "interaction panel must collapse before starting the chat interaction",
);
assert.doesNotMatch(
  status,
  /interactionCollapseTimerRef|1100/,
  "interaction collapse must not depend on an arbitrary timer",
);
assert.match(
  app,
  /function handleCompanionInteraction\(zoneId\)[\s\S]*?shouldAutoScrollRef\.current = true;[\s\S]*?setActiveView\("chat"\);[\s\S]*?registerCompanionInteraction\(zoneId\)/,
  "interaction replies must return to chat and target the newest message",
);
assert.match(
  app,
  /onInteract=\{handleCompanionInteraction\}/,
  "the status panel must use the chat-aware interaction handler",
);

console.log("mobile layout regression tests passed");
