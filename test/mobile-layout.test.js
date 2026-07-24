import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
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
  /className="status-reaction-preview">\{normalized\.note\}/,
  "collapsed status must expose the latest companion reaction",
);
assert.match(
  css,
  /\.status-reaction-preview\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
  "collapsed reaction must stay readable without resizing the mobile header",
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
