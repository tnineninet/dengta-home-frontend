import assert from "node:assert/strict";
import fs from "node:fs";

// Guard the per-user NetEase entry in Together Music. The QR component existed
// for months but was never mounted, so users could not bind their own account.
const source = fs.readFileSync(new URL("../src/MusicSettings.jsx", import.meta.url), "utf8");
assert.match(source, /import NeteaseQrLogin from "\.\/NeteaseQrLogin\.jsx";/, "NeteaseQrLogin must be imported");
assert.match(source, /<NeteaseQrLogin\b/, "NeteaseQrLogin must be rendered");
assert.match(source, /网易云账号 · 扫码登录/, "the section must be discoverable");
assert.match(source, /每用户独立/, "the section must explain account isolation");
assert.doesNotMatch(source, /Together 音频不可用/, "the stale claim must not return");
