import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Usage:
//   node scripts/publish-app-update.mjs \
//     --apk path/to/DengTa.apk \
//     --url https://github.com/DengTaHome/dengta-home/releases/download/vX/DengTa-X.apk \
//     --notes path/to/notes.json
//
// This validates the APK with prepare-app-update.mjs (package id, version,
// signer, sha256, GitHub release URL), then atomically replaces
// public/updates/android.json so /download and the in-app updater both see the
// new release immediately after the next web deploy.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function value(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : "";
}
const apk = value("apk");
const url = value("url");
const notes = value("notes");
if (!apk || !url || !notes) {
  throw new Error("Usage: --apk <file> --url <GitHub APK URL> --notes <JSON notes file> [--sdk <Android SDK>]");
}
const target = path.join(root, "public", "updates", "android.json");
const temp = path.join(os.tmpdir(), `dengta-android-${process.pid}-${Date.now()}.json`);
fs.mkdirSync(path.dirname(target), { recursive: true });
try {
  const command = [
    path.join(root, "scripts", "prepare-app-update.mjs"),
    "--apk", path.resolve(apk),
    "--url", url,
    "--notes", path.resolve(notes),
    "--output", temp,
  ];
  const sdk = value("sdk");
  if (sdk) command.push("--sdk", sdk);
  execFileSync(process.execPath, command, { stdio: "inherit", cwd: root });
  const manifest = JSON.parse(fs.readFileSync(temp, "utf8"));
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
  const downloadTarget = path.join(root, "public", "updates", "download.json");
  fs.writeFileSync(downloadTarget, JSON.stringify({
    schema_version: 1,
    latest: manifest.latest,
  }, null, 2) + "\n");
  console.log(JSON.stringify({
    updated: target,
    downloadManifest: downloadTarget,
    version: manifest.latest?.version,
    versionCode: manifest.latest?.version_code,
    apkUrl: manifest.latest?.apk_url,
    next: "commit public/updates/android.json and public/updates/download.json, then deploy the website",
  }, null, 2));
} finally {
  fs.rmSync(temp, { force: true });
}
