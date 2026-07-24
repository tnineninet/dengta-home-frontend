import assert from "node:assert/strict";
import fs from "node:fs";
import { loadEntrypointCssCascade } from "./helpers/effective-css.js";

const mobileViewport = { width: 390, height: 844, reducedMotion: false };
const cssCascade = loadEntrypointCssCascade(
  new URL("../src/main.jsx", import.meta.url),
  mobileViewport,
);
const css = cssCascade.source;
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const status = fs.readFileSync(
  new URL("../src/CompanionStatus.jsx", import.meta.url),
  "utf8",
);
const androidManifest = fs.readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);

function sourceBetween(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return app.slice(start, end);
}

assert.deepEqual(
  cssCascade.stylesheets.map((stylesheet) => stylesheet.name),
  ["index.css", "cozy-theme.css"],
  "layout tests must use the same stylesheet order as the application entrypoint",
);

const rootLayout = cssCascade.declarations(":root");
const mainPanelLayout = cssCascade.declarations(".main-panel");
const mobileNavLayout = cssCascade.declarations(".mobile-nav");
const chatContentLayout = cssCascade.declarations(".view-chat .view-content");
const expandedChatContentLayout = cssCascade.declarations(
  ".main-panel.view-chat:has(.companion-status.expanded) .view-content",
);
const messageListLayout = cssCascade.declarations(".message-list");
const composerLayout = cssCascade.declarations(".composer-wrap");
const expandedStatusLayout = cssCascade.declarations(
  ".companion-status.expanded",
);
const statusPanelLayout = cssCascade.declarations(".status-panel");

assert.equal(
  rootLayout["--mobile-nav-reserved-height"]?.value,
  "calc(72px + env(safe-area-inset-bottom))",
  "mobile nav must expose one shared reserved height",
);
assert.equal(
  mainPanelLayout["padding-bottom"]?.value,
  "var(--mobile-nav-reserved-height)",
  "chat layout must reserve the full mobile nav height",
);
assert.equal(
  mobileNavLayout.height?.value,
  "var(--mobile-nav-reserved-height)",
  "mobile nav and chat reservation must use the same height",
);
assert.equal(mainPanelLayout.height?.value, "var(--app-height)");
assert.equal(mobileNavLayout.position?.value, "fixed");
assert.equal(mobileNavLayout.bottom?.value, "0");
assert.equal(mobileNavLayout.display?.value, "grid");
assert.equal(
  composerLayout.padding?.value,
  "9px 10px max(9px, env(safe-area-inset-bottom))",
  "the 390px composer must include the later cozy-theme mobile override",
);
assert.equal(
  chatContentLayout["grid-template-rows"]?.value,
  "minmax(0, 1fr) auto",
  "chat must reserve an independent row for the composer",
);
assert.equal(chatContentLayout["min-height"]?.value, "0");
assert.equal(chatContentLayout.flex?.value, "1 1 auto");
assert.equal(messageListLayout["min-height"]?.value, "0");
assert.equal(messageListLayout["overflow-y"]?.value, "auto");
assert.equal(
  messageListLayout.padding?.value,
  "18px 12px",
  "the 390px message scroller must include the later cozy-theme mobile override",
);
assert.equal(expandedStatusLayout.display?.value, "flex");
assert.equal(expandedStatusLayout["min-height"]?.value, "160px");
assert.equal(
  expandedStatusLayout["max-height"]?.value,
  "min(48vh, 460px)",
  "the expanded status must stay bounded at 390x844",
);
assert.equal(expandedStatusLayout["flex-direction"]?.value, "column");
assert.equal(statusPanelLayout["min-height"]?.value, "0");
assert.equal(statusPanelLayout.flex?.value, "1 1 auto");
assert.equal(statusPanelLayout["overflow-y"]?.value, "auto");
assert.equal(
  statusPanelLayout["max-height"]?.value,
  "min(50vh, 500px)",
  "expanded status content must scroll inside its mobile boundary",
);
assert.equal(expandedChatContentLayout["min-height"]?.value, "0");
assert.equal(expandedChatContentLayout.flex?.value, "1 1 auto");

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
  /event\.key === "Escape"[\s\S]*?setExpanded\(false\)/,
  "status panel must close from the keyboard without changing views",
);
assert.match(
  status,
  /closest\("\.composer-wrap, \.mobile-nav"\)/,
  "using the composer or mobile navigation must not collapse the status panel",
);
assert.match(
  status,
  /if \(!expanded\) return undefined;[\s\S]*?panelRef\.current\?\.scrollTo\(\{ top: 0 \}\)/,
  "opening the status panel must reset its independent scroll position",
);
assert.match(
  status,
  /aria-expanded=\{expanded\}[\s\S]*?onClick=\{\(\) =>\s*setExpanded\(\(current\) => !current\)\}/,
  "the status summary must explicitly toggle open and closed",
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
  status,
  /LIVE COMPANION SIGNAL/,
  "expanded status must expose the live companion signal heading",
);
assert.match(
  status,
  /className="status-reaction-preview">\{normalized\.note\}/,
  "collapsed status must expose the latest companion reaction",
);
assert.match(
  cssCascade.declarations(".status-reaction-preview")["text-overflow"]?.value ||
    "",
  /^ellipsis$/,
  "collapsed reaction must stay readable without resizing the mobile header",
);
assert.equal(
  cssCascade.declarations(".status-reaction-preview")["white-space"]?.value,
  "nowrap",
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
  cssCascade.declarations(".status-vitals-grid")["grid-template-columns"]
    ?.value || "",
  /^repeat\(3,/,
  "the live signal metrics must keep three stable columns",
);
assert.equal(
  cssCascade.declarations(".status-vital-tile")["min-height"]?.value,
  "96px",
  "mobile metric tiles must reserve a stable height",
);
assert.equal(
  cssCascade.declarations(".status-pulse-bg").opacity?.value,
  "1",
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
assert.match(
  app,
  /settingsSaveRunRef/,
  "callers must be able to await the active settings save queue",
);
assert.match(
  app,
  /while \(pendingSettingsSaveRef\.current\)/,
  "the settings queue must finish newer drafts before resolving",
);
const sendMessageSource = sourceBetween(
  "async function sendMessage()",
  "function scheduleSettingsAutosave",
);
assert.ok(
  sendMessageSource.indexOf("await flushLatestSettingsDraft()") >= 0 &&
    sendMessageSource.indexOf("await flushLatestSettingsDraft()") <
      sendMessageSource.indexOf('setMessage("")'),
  "text chat must save the latest role settings before consuming the draft",
);
const submitVoiceSource = sourceBetween(
  "async function submitVoiceBlob",
  "async function finishVoiceCapture",
);
assert.ok(
  submitVoiceSource.indexOf("await flushLatestSettingsDraft()") >= 0 &&
    submitVoiceSource.indexOf("await flushLatestSettingsDraft()") <
      submitVoiceSource.indexOf('apiRequest("/sessions"'),
  "voice chat must save the latest role settings before its first request",
);
const companionInteractionSource = sourceBetween(
  "async function processCompanionInteractionQueue()",
  "async function selectChatAttachments",
);
assert.ok(
  companionInteractionSource.indexOf("await flushLatestSettingsDraft()") >= 0 &&
    companionInteractionSource.indexOf("await flushLatestSettingsDraft()") <
      companionInteractionSource.indexOf(
        "companionInteractionQueueRef.current.shift()",
      ),
  "companion interactions must not consume an event before settings are saved",
);
assert.doesNotMatch(
  companionInteractionSource,
  /applyPromptReceipt/,
  "companion interactions must not overwrite the latest main-chat prompt receipt",
);
const changeViewSource = sourceBetween(
  "function changeView(view)",
  "function handleCompanionInteraction",
);
assert.match(
  changeViewSource,
  /activeView === "settings"[\s\S]*scheduleSettingsAutosave\(draftSettingsRef\.current,[\s\S]*immediate: true/,
  "leaving settings must start an immediate save",
);
assert.doesNotMatch(
  app,
  />保存设置</,
  "settings must not require the old bottom save button",
);
assert.match(
  app,
  /event\.type === "reasoning"[\s\S]*appendThinkingSummary/,
  "chat streaming must render only the backend's explicit public reasoning event",
);
assert.match(
  app,
  /event\.public === true[\s\S]*\["companion_progress", "provider_summary"\]\.includes\(event\.source\)/,
  "chat streaming must reject unmarked or unknown reasoning events",
);
assert.match(
  app,
  /event\.source === "provider_summary"[\s\S]*`\\n\\n\$\{event\.content \|\| ""\}`/,
  "provider summaries must be visually separated from companion progress",
);
assert.match(
  app,
  /data-setting-field="unified_system_prompt"/,
  "settings must expose one unified main system prompt editor",
);
assert.doesNotMatch(
  app,
  /data-setting-field="(?:system_prompt|additional_prompt|personality)"/,
  "legacy prompt fields must not remain as competing visible editors",
);
assert.match(
  app,
  /data-setting-field="turn_context"/,
  "settings must expose a temporary next-turn context editor",
);
assert.match(
  app,
  /"intimate_expression_enabled"/,
  "settings must expose the persistent intimate-expression toggle",
);
assert.match(
  app,
  /intimateExpressionEnabled=\{\s*settings\.intimate_expression_enabled === true\s*\}/,
  "status interactions must receive the intimate-expression setting",
);
assert.match(
  androidManifest,
  /android\.permission\.ACCESS_COARSE_LOCATION/,
  "Android must declare coarse location for user-enabled weather",
);
assert.match(
  androidManifest,
  /android\.permission\.ACCESS_FINE_LOCATION/,
  "Capacitor geolocation also requires fine location on Android 11 and older",
);

console.log("mobile layout regression tests passed");
