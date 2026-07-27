import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const diary = await readFile(
  new URL("../src/CompanionDiary.jsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../src/index.css", import.meta.url),
  "utf8",
);
const serviceWorker = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

assert.match(app, /<CompanionDiary/);
assert.doesNotMatch(app, /secret-crush-diary\.html|className="diary-frame"/);
assert.match(diary, /apiRequest\("\/api\/v2\/diary"\)/);
assert.match(diary, /source_message_count/);
assert.match(diary, /source_window_start/);
assert.match(diary, /发生过的事情不能虚构/);
assert.match(css, /\.companion-diary-page/);
assert.match(css, /\.diary-entry-list/);
assert.doesNotMatch(serviceWorker, /secret-crush-diary\.html/);
assert.match(serviceWorker, /dengta-home-v10/);

for (const asset of [
  "../public/assets/moments-paper-banner.webp",
  "../public/assets/xiaodeng-handdrawn-avatar.webp",
]) {
  const info = await stat(new URL(asset, import.meta.url));
  assert.ok(info.size > 1000, `${asset} should contain a real generated asset`);
  assert.ok(info.size < 500_000, `${asset} should be optimized for mobile`);
}

console.log("real companion diary UI regression tests passed");
