import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLivePerceptionEnvironmentPayload,
  computeTimeDomainRms,
  formatLivePerceptionTurnHint,
  mergeLivePerceptionContext,
  normalizeLivePerceptionPrefs,
  queryMediaPermissionState,
  readLivePerceptionPrefs,
  writeLivePerceptionPrefs,
} from "../src/live-perception.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("live-perception persists scoped preferences cleanly and normalizes fields", () => {
  const storage = createMemoryStorage();
  const saved = writeLivePerceptionPrefs(
    "acct-a:comp-1",
    {
      screenAlwaysOn: true,
      activityAlwaysOn: true,
      cameraAlwaysOn: true,
      cameraFacing: "environment",
      micAlwaysOn: true,
      micAutoSend: true,
    },
    storage,
  );
  assert.equal(saved.screenAlwaysOn, true);
  assert.equal(saved.cameraFacing, "environment");
  assert.equal(saved.micAutoSend, true);

  const loaded = readLivePerceptionPrefs("acct-a:comp-1", storage);
  assert.deepEqual(loaded, saved);
  const isolated = readLivePerceptionPrefs("acct-b:comp-2", storage);
  assert.equal(isolated.screenAlwaysOn, false);
  assert.equal(isolated.cameraFacing, "user");

  const normalized = normalizeLivePerceptionPrefs({ cameraFacing: "invalid" });
  assert.equal(normalized.cameraFacing, "user");
});

test("live-perception builds sanitized environment_context payload and natural turn hints", () => {
  assert.equal(buildLivePerceptionEnvironmentPayload({}), null);

  const payload = buildLivePerceptionEnvironmentPayload({
    screenActive: true,
    cameraActive: true,
    cameraFacing: "environment",
    micActive: true,
    activityActive: true,
    capturedSources: ["screen", "camera", "unknown"],
    platform: "android",
  });
  assert.deepEqual(payload, {
    screen_active: true,
    camera_active: true,
    camera_facing: "environment",
    mic_active: true,
    activity_active: true,
    captured_sources: ["screen", "camera"],
    platform: "android",
  });

  const merged = mergeLivePerceptionContext({ timeZone: "Asia/Shanghai" }, payload);
  assert.equal(merged.timeZone, "Asia/Shanghai");
  assert.deepEqual(merged.live_perception, payload);

  const cleared = mergeLivePerceptionContext(merged, null);
  assert.equal(cleared.live_perception, undefined);

  assert.match(formatLivePerceptionTurnHint(["screen", "camera"]), /屏幕画面与镜头画面/);
  assert.match(formatLivePerceptionTurnHint(["screen"]), /屏幕画面/);
  assert.match(formatLivePerceptionTurnHint(["camera"]), /摄像头画面/);
  assert.equal(formatLivePerceptionTurnHint([]), "");
});

test("SPEC-SIDEBAR-LAYOUT: sidebar uses compact single-row dock footer, hides download on native Android, and gives FeatureNavigation full flex height", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");
  const navCss = fs.readFileSync(path.join(ROOT, "src", "feature-navigation.css"), "utf8");
  const indexCss = fs.readFileSync(path.join(ROOT, "src", "index.css"), "utf8");

  assert.match(appSource, /className="sidebar-dock-footer"/, "Sidebar must render compact single-row dock footer");
  assert.match(appSource, /!Capacitor\.isNativePlatform\(\)[\s\S]{0,220}sidebar-dock-download/, "Native Android app must hide redundant Android APK download button in sidebar");
  assert.match(appSource, /session-heading-toggle/, "Recent conversations section must be collapsible to maximize feature list height");
  assert.match(navCss, /\.feature-navigation\s*\{[^}]*flex:\s*1 1 auto;[^}]*max-height:\s*none;/, "FeatureNavigation must grow freely instead of capping at 52vh");
  assert.match(navCss, /\.feature-navigation\s+\.primary-nav\s+\.feature-navigation-group-toggle/, "Feature group headers must override .primary-nav button so section headings stay compact");
  assert.match(navCss, /\.feature-navigation-search\s*\{[^}]*z-index:\s*12;[^}]*background:\s*rgb\(var\(--theme-card-rgb/, "Sticky feature search bar must have opaque solid backdrop without overlapping cards");
  assert.match(indexCss, /\.sidebar-dock-footer\s*\{/, "index.css must define .sidebar-dock-footer layout");
  assert.match(indexCss, /\.sidebar-dock-footer\s+\.account-menu-trigger-copy\s+small\s*\{\s*display:\s*none;/, "Compact dock footer must hide redundant second-line account subtitle for single-row alignment");
  assert.match(indexCss, /\.session-heading\s*>\s*button:last-child/, "Mobile 44px square rule must target only the + button and never squish .session-heading-toggle");
});

test("SPEC-MULTIMODAL-PERCEPTION: Android manifest declares CAMERA permission and ScreenGlancePlugin exposes captureSnapshotNow", () => {
  const manifest = fs.readFileSync(
    path.join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml"),
    "utf8",
  );
  const pluginJava = fs.readFileSync(
    path.join(
      ROOT,
      "android",
      "app",
      "src",
      "main",
      "java",
      "home",
      "dengta",
      "app",
      "ScreenGlancePlugin.java",
    ),
    "utf8",
  );
  const appSource = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");

  assert.match(manifest, /android\.permission\.CAMERA/, "AndroidManifest must declare CAMERA permission");
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/, "AndroidManifest must declare RECORD_AUDIO permission");
  assert.match(manifest, /android\.permission\.PACKAGE_USAGE_STATS/, "AndroidManifest must declare PACKAGE_USAGE_STATS permission");
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_MEDIA_PROJECTION/, "AndroidManifest must declare media projection service permission");
  assert.match(pluginJava, /public void captureSnapshotNow\(PluginCall call\)/, "ScreenGlancePlugin must expose captureSnapshotNow");
  assert.match(appSource, /<LivePerceptionBar/, "App.jsx must mount LivePerceptionBar persistently across views");
  assert.match(appSource, /onVoiceTurnBlob=/, "App.jsx must wire hands-free VAD voice blobs into submitVoiceBlob");
  assert.match(appSource, /<LivePerceptionSettingsCard/, "App.jsx must mount LivePerceptionSettingsCard in Settings -> devices");
  assert.match(appSource, /collectTurnVisuals/, "App.jsx sendMessage must auto-attach fresh live visuals when perception is active");
});

test("live-perception VAD RMS calculator and permission query behave deterministically", async () => {
  const silence = new Uint8Array(256).fill(128);
  assert.equal(computeTimeDomainRms(silence), 0);

  const loud = new Uint8Array(256);
  for (let i = 0; i < loud.length; i += 1) {
    loud[i] = i % 2 === 0 ? 180 : 76;
  }
  assert.ok(computeTimeDomainRms(loud) > 0.35);

  const granted = await queryMediaPermissionState("camera", {
    navigator: { permissions: { query: async () => ({ state: "granted" }) } },
  });
  assert.equal(granted, "granted");
  assert.equal(await queryMediaPermissionState("camera", {}), "unknown");
});

test("SPEC-PERCEPTION-UX-AND-DANZI: Siri wake-word parser, screen diff detector, Star Drawer consolidation, and Dynamic Island CD cover", async () => {
  const { parseWakeWordTranscript } = await import("../src/voice-wake-word.js");
  const {
    computeLumaChangePercent,
    shouldTriggerAutoScreenCapture,
    registerScreenEvidence,
    getScreenEvidenceById,
    serializeEvidenceForPayload,
  } = await import("../src/screen-change-monitor.js");
  const { normalizeNowPlayingCoverUrl } = await import("../src/built-in-now-playing.js");

  // Siri wake word matching (one-breath, wake-only, custom aiName, non-wake)
  const cmd = parseWakeWordTranscript("嗨灯塔 帮我看看今天穿什么", { aiName: "小小灯" });
  assert.equal(cmd.matched, true);
  assert.equal(cmd.command, "帮我看看今天穿什么");

  const wakeOnly = parseWakeWordTranscript("Hey DengTa", { aiName: "小小灯" });
  assert.equal(wakeOnly.matched, true);
  assert.equal(wakeOnly.command, "");

  const customName = parseWakeWordTranscript("小小灯，几点啦", { aiName: "小小灯" });
  assert.equal(customName.matched, true);
  assert.equal(customName.command, "几点啦");

  const ignored = parseWakeWordTranscript("今天天气真不错", { aiName: "小小灯" });
  assert.equal(ignored.matched, false);

  // Smart screen change detection + cooldown + evidence registry
  const sigA = new Uint8Array(64).fill(30);
  const sigB = new Uint8Array(64).fill(210);
  const delta = computeLumaChangePercent(sigA, sigB);
  assert.ok(delta > 60, `Expected significant visual change, got ${delta}`);

  assert.equal(
    shouldTriggerAutoScreenCapture({ appChanged: true, changeScore: 4, elapsedMs: 5000 }),
    true,
  );
  assert.equal(
    shouldTriggerAutoScreenCapture({ appChanged: false, changeScore: 50, elapsedMs: 2000 }),
    false,
  );
  assert.equal(
    shouldTriggerAutoScreenCapture({ appChanged: false, changeScore: 30, elapsedMs: 15000 }),
    true,
  );

  const ev = registerScreenEvidence({
    id: "ev-screen-test-1",
    kind: "screen",
    app_name: "哔哩哔哩",
    trigger_reason: "屏幕显著变化",
    change_score: 34,
    thumbnail_data_url: "data:image/jpeg;base64,/9j/4AAQ",
  });
  assert.equal(getScreenEvidenceById(ev.id)?.app_name, "哔哩哔哩");
  assert.equal(getScreenEvidenceById(ev.id)?.thumbnail_data_url, "data:image/jpeg;base64,/9j/4AAQ");
  const serialized = serializeEvidenceForPayload(ev);
  assert.equal(serialized.app_name, "哔哩哔哩");
  assert.equal(serialized.change_score, 34);
  assert.equal("thumbnail_data_url" in serialized, false, "Thumbnails must stay local-only and never bloat backend payload");

  // Native persistent media permission plugin + Star Drawer wiring + Dynamic Island cover HTTPS
  const mainActivity = fs.readFileSync(
    path.join(ROOT, "android", "app", "src", "main", "java", "home", "dengta", "app", "MainActivity.java"),
    "utf8",
  );
  assert.match(mainActivity, /registerPlugin\(MediaPermissionsPlugin\.class\)/);

  const appSource = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");
  assert.match(appSource, /starDrawerPortalTarget=\{composerStarPerceptionSlot\}/);
  assert.match(appSource, /hideBarWhenIdle/);
  assert.match(appSource, /hideLauncher=\{activeView === "chat"\}/);

  const chatMsgSource = fs.readFileSync(path.join(ROOT, "src", "ChatMessage.jsx"), "utf8");
  assert.match(chatMsgSource, /message-perception-evidence/);
  assert.match(chatMsgSource, /is-jumpable/);

  assert.equal(
    normalizeNowPlayingCoverUrl("http://p1.music.126.net/abc/123.jpg"),
    "https://p1.music.126.net/abc/123.jpg",
  );
  assert.equal(normalizeNowPlayingCoverUrl("javascript:alert(1)"), "");
});
