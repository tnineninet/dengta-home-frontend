import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// 4. Chat history Stale-While-Revalidate cache + fast first page + 80-row window
assert.match(historyCache, /indexedDB/);
assert.match(historyCache, /peekCachedHistory/);
assert.match(appSource, /peekCachedHistory\(activeSessionId\)/);
assert.match(appSource, /HISTORY_FIRST_PAGE_SIZE/);
assert.match(transcript, /useState\(80\)/);

// 5. CottonPet white-on-light visibility fixes
assert.match(cottonPet, /outline:\s*true/);
assert.match(cottonCss, /#bccbc8/);
assert.match(petRuntime, /createContactShadow/);
assert.match(petRuntime, /toneMappingExposure\s*=\s*0\.9/);

console.log("SDD verification passed: Music Studio QR, Chat History Speed, and CottonPet visibility");
