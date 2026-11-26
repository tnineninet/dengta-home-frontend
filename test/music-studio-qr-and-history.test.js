import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  areRawMessageListsEquivalent,
  clearInstantChatSnapshot,
  mergeIncrementalMessages,
  readInstantChatSnapshot,
  writeInstantChatSnapshot,
} from "../src/chat-history-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const musicStudio = fs.readFileSync(path.join(root, "src", "MusicStudio.jsx"), "utf8");
const neteaseQr = fs.readFileSync(path.join(root, "src", "NeteaseQrLogin.jsx"), "utf8");
const historyCache = fs.readFileSync(path.join(root, "src", "chat-history-cache.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const transcript = fs.readFileSync(path.join(root, "src", "ChatTranscript.jsx"), "utf8");
const mainActivity = fs.readFileSync(
  path.join(root, "android", "app", "src", "main", "java", "home", "dengta", "app", "MainActivity.java"),
  "utf8",
);
const fileBridge = fs.readFileSync(
  path.join(root, "android", "app", "src", "main", "java", "home", "dengta", "app", "DengTaFileBridge.java"),
  "utf8",
);
const cottonPet = fs.readFileSync(path.join(root, "src", "CottonPet.jsx"), "utf8");
const cottonCss = fs.readFileSync(path.join(root, "src", "cotton-pet.css"), "utf8");
const petRuntime = fs.readFileSync(path.join(root, "src", "cotton", "pet-runtime.js"), "utf8");

// 1. Music Studio defaults to direct QR mode (zero white-screen iframe)
assert.match(musicStudio, /useState\("direct"\)/);
assert.match(musicStudio, /<NeteaseQrLogin[\s\S]*inline[\s\S]*autoStart/);
assert.match(musicStudio, /openNeteaseCookieLogin/);

// 2. NeteaseQrLogin captures foreground return & does NOT silently auto-rotate QR at 120s
assert.match(neteaseQr, /visibilitychange/);
assert.match(neteaseQr, /pageshow/);
assert.match(neteaseQr, /appStateChange/);
assert.match(neteaseQr, /saveImageToGallery/);
assert.match(neteaseQr, /openNeteaseApp/);
assert.match(neteaseQr, /我已扫码，立即检测/);
assert.doesNotMatch(neteaseQr, /120_000/);

// 3. Android WebView third-party cookie + Gallery save + NetEase launcher
assert.match(mainActivity, /setAcceptThirdPartyCookies\(webView,\s*true\)/);
assert.match(fileBridge, /saveImageToGallery/);
assert.match(fileBridge, /openNeteaseApp/);

// 4. Chat history L0 instant boot snapshot + Stale-While-Revalidate + ?after= incremental sync + sidebar prefetch + 80-row window
assert.match(historyCache, /indexedDB/);
assert.match(historyCache, /peekCachedHistory/);
assert.match(historyCache, /readInstantChatSnapshot/);
assert.match(historyCache, /mergeIncrementalMessages/);
assert.match(appSource, /peekCachedHistory\(activeSessionId\)/);
assert.match(appSource, /HISTORY_FIRST_PAGE_SIZE/);
assert.match(appSource, /messages\?after=/);
assert.match(appSource, /prefetchSessionHistory/);
assert.match(appSource, /<ChatTranscript\s+key=\{activeSessionId \|\| "none"\}/);
assert.match(transcript, /useState\(80\)/);

// Functional verification of L0 instant snapshot & incremental merge
const memStore = new Map();
const mockStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};
assert.equal(
  writeInstantChatSnapshot(
    "u1::c1",
    {
      sessions: [{ id: "s1", title: "深夜聊" }],
      activeSessionId: "s1",
      messages: [
        { id: "m1", role: "user", content: "晚安", created_at: "2026-11-26T15:00:00.000Z" },
        { id: "m2", role: "assistant", content: "好梦", isStreaming: true },
      ],
    },
    mockStorage,
  ),
  true,
);
const restored = readInstantChatSnapshot("u1::c1", mockStorage);
assert.equal(restored.activeSessionId, "s1");
assert.equal(restored.messages.length, 1, "streaming draft messages must not be persisted into L0 instant snapshot");
clearInstantChatSnapshot("u1::c1", mockStorage);
assert.equal(readInstantChatSnapshot("u1::c1", mockStorage), null);

const merged = mergeIncrementalMessages(
  [{ id: "m1", role: "user", content: "a", created_at: "2026-11-26T15:00:00.000Z" }],
  [
    { id: "m1", role: "user", content: "a", created_at: "2026-11-26T15:00:00.000Z" },
    { id: "m2", role: "assistant", content: "b", created_at: "2026-11-26T15:01:00.000Z" },
  ],
);
assert.equal(merged.length, 2, "mergeIncrementalMessages must deduplicate overlapping ids");
assert.equal(areRawMessageListsEquivalent(merged, [...merged]), true);
assert.equal(areRawMessageListsEquivalent(merged, [merged[0]]), false);

// 5. CottonPet white-on-light visibility fixes
assert.match(cottonPet, /outline:\s*true/);
assert.match(cottonCss, /#bccbc8/);
assert.match(petRuntime, /createContactShadow/);
assert.match(petRuntime, /toneMappingExposure\s*=\s*0\.9/);

console.log("SDD verification passed: Music Studio QR, Chat History Speed, and CottonPet visibility");
