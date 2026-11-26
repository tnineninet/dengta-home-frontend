import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const clientSource = fs.readFileSync(path.join(root, "src", "chronos-client.js"), "utf8");
const componentSource = fs.readFileSync(path.join(root, "src", "ChronosWakeCenter.jsx"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "src", "chronos-wake-center.css"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const workerJava = fs.readFileSync(
  path.join(root, "android", "app", "src", "main", "java", "home", "dengta", "app", "PushNotificationWorker.java"),
  "utf8",
);

// 1. Chronos client exports & API paths
assert.match(clientSource, /\/api\/v2\/chronos\/state/);
assert.match(clientSource, /\/api\/v2\/chronos\/policy/);
assert.match(clientSource, /\/api\/v2\/chronos\/schedules/);
assert.match(clientSource, /\/api\/v2\/chronos\/heartbeat/);
assert.match(clientSource, /syncNativeLocalWakeNotifications/);

// 2. Chronos UI component & dual Day/Night Glass CSS
assert.match(componentSource, /Chronos 严格时间与自动唤醒/);
assert.match(componentSource, /chronos-live-clock/);
assert.match(componentSource, /立即执行唤醒心跳/);
assert.match(componentSource, /buildPreviewChronosState/);
assert.match(cssSource, /:root\[data-dengta-appearance="night"\]/);
assert.match(cssSource, /width:\s*18px\s*!important/);

// 3. App.jsx lazy integration, dynamic timezone, client_time_iso, and heartbeat loop
assert.match(appSource, /const ChronosWakeCenter = lazy\(\(\) => import\("\.\/ChronosWakeCenter\.jsx"\)\)/);
assert.match(appSource, /<ChronosWakeCenter/);
assert.match(appSource, /triggerChronosHeartbeat/);
assert.match(appSource, /client_time_iso:\s*new Date\(\)\.toISOString\(\)/);
assert.match(appSource, /timezone:\s*settings\.timezone \|\| detectBrowserTimeZone\(\)/);

// 4. Android native PushNotificationWorker triggers Chronos heartbeat before push poll
assert.match(workerJava, /\/api\/v2\/chronos\/heartbeat/);
assert.match(workerJava, /private static JSONObject postJson/);

console.log("frontend Chronos wake center & Android bridge verification passed");
