import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apkSource = path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const apkTarget = path.join(root, "public", "downloads", "DengTa-latest.apk");
const versionCode = Number(process.env.VERSION_CODE);
const versionName = String(process.env.VERSION_NAME || "").trim();
const commit = String(process.env.COMMIT_SHA || "").slice(0, 12);
if (!fs.existsSync(apkSource)) throw new Error("APK was not built");
if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error("VERSION_CODE is invalid");
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(versionName)) throw new Error("VERSION_NAME is invalid");

const bytes = fs.readFileSync(apkSource);
fs.mkdirSync(path.dirname(apkTarget), { recursive: true });
fs.writeFileSync(apkTarget, bytes);

const release = {
  version_code: versionCode,
  version: versionName,
  apk_url: "https://www.dengtahome.com/downloads/DengTa-latest.apk",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size_bytes: bytes.length,
  published_at: new Date().toISOString(),
  notes: [
    `自动构建 ${versionName}（${versionCode}）${commit ? ` · ${commit}` : ""}`,
    "包含最新的聊天、界面和 Android 修复。",
  ],
};

const androidManifest = {
  schema_version: 1,
  package_id: "home.dengta.app",
  channel: "stable",
  latest: release,
};
fs.writeFileSync(
  path.join(root, "public", "updates", "android.json"),
  JSON.stringify(androidManifest, null, 2) + "\n"
);
fs.writeFileSync(
  path.join(root, "public", "updates", "download.json"),
  JSON.stringify({ schema_version: 1, latest: release }, null, 2) + "\n"
);
console.log(JSON.stringify({
  published: apkTarget,
  version: versionName,
  versionCode,
  size: bytes.length,
  sha256: release.sha256,
}, null, 2));
