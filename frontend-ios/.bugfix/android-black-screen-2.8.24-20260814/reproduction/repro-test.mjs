import assert from "node:assert/strict";
import fs from "node:fs";

const apkPath = "E:\\chatgpt\\builds\\DengTa-Home-2.8.24-world-book-runtime-debug.apk";
const indexPath = "E:\\chatgpt\\dengta-home-frontend\\.bugfix\\android-black-screen-2.8.24-20260814\\reproduction\\apk\\assets\\public\\index.html";
const entryPath = "E:\\chatgpt\\dengta-home-frontend\\.bugfix\\android-black-screen-2.8.24-20260814\\reproduction\\apk\\assets\\public\\assets\\index-B6eo9gM1.js";

assert.ok(fs.statSync(apkPath).size > 0, "the reported APK must exist");
const html = fs.readFileSync(indexPath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");

const evidence = {
  apkBytes: fs.statSync(apkPath).size,
  rootPresent: html.includes('<div id="root"></div>'),
  appChunk: entry.match(/import\(`\.\/App-[^`]+\.js`\)/)?.[0] || "",
  nullSuspenseFallback: /Suspense,?\{fallback:null/.test(entry),
  recoverableRuntimeBoundary:
    /componentDidCatch|getDerivedStateFromError|addEventListener\(["'`]vite:preloadError/.test(entry),
};

console.log("[BUGFIX_REPRO_TRACE]", JSON.stringify(evidence));
assert.equal(evidence.rootPresent, true);
assert.notEqual(evidence.appChunk, "");
assert.equal(evidence.nullSuspenseFallback, true);
assert.equal(evidence.recoverableRuntimeBoundary, false);

console.error(
  "REPRODUCED: authenticated App chunk loading/rendering can leave the existing root visually empty with no loading or recoverable error UI.",
);
process.exitCode = 1;
