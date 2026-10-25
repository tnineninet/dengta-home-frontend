import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apkSource = path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const versionCode = Number(process.env.VERSION_CODE);
const versionName = String(process.env.VERSION_NAME || "").trim();
const commit = String(process.env.COMMIT_SHA || "").slice(0, 12);
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseKey = String(process.env.SUPABASE_SECRET_KEY || "");
if (!fs.existsSync(apkSource)) throw new Error("APK was not built");
if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error("VERSION_CODE is invalid");
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(versionName)) throw new Error("VERSION_NAME is invalid");
if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required; APK is intentionally not committed to the site deploy");
}

const bytes = fs.readFileSync(apkSource);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const objectPath = "apk/DengTa-latest.apk";
const upload = await fetch(`${supabaseUrl}/storage/v1/object/dengta-updates/${objectPath}`, {
  method: "POST",
  headers: {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/vnd.android.package-archive",
    "Cache-Control": "300",
    "x-upsert": "true",
  },
  body: bytes,
});
const uploadBody = await upload.json().catch(() => ({}));
if (!upload.ok) {
  throw new Error(`APK upload failed: HTTP ${upload.status} ${uploadBody?.message || ""}`.trim());
}

const release = {
  version_code: versionCode,
  version: versionName,
  apk_url: `${supabaseUrl}/storage/v1/object/public/dengta-updates/${objectPath}`,
  sha256,
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
  uploaded: `${supabaseUrl}/storage/v1/object/public/dengta-updates/${objectPath}`,
  version: versionName,
  versionCode,
  size: bytes.length,
  sha256,
}, null, 2));
