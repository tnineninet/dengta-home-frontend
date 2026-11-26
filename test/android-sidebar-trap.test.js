import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

test("mobile sidebar always exposes a direct close control", () => {
  assert.match(
    app,
    /className="sidebar-close"[\s\S]*?aria-label="关闭菜单"[\s\S]*?onClick=\{\(\) => setIsSidebarOpen\(false\)\}/,
    "the sidebar must not rely only on a scrim that a transient banner can cover",
  );
  assert.match(css, /\.sidebar-close \{[\s\S]*?display: none;/, "desktop sidebar close control stays hidden");
  const mobile = css.slice(css.indexOf(".sidebar-close {"));
  assert.match(mobile, /display: grid;[\s\S]*?width: 44px;[\s\S]*?height: 44px;/, "mobile close hit target must be usable");
  assert.match(
    css,
    /\.is-sidebar-open \.main-panel \.connection-recovery[\s\S]*?visibility: hidden/,
    "a waking/connection banner must not sit above the open menu",
  );
  assert.match(app, /isSidebarOpen \? " is-sidebar-open"/, "the shell must expose the open-menu state to CSS");
});

test("connection recovery stays below the mobile scrim and sidebar", () => {
  const recovery = css.slice(css.indexOf(".main-panel.view-chat .connection-recovery"));
  const recoveryZ = Number(recovery.match(/z-index:\s*(\d+)/)?.[1] || 0);
  const mobileStart = css.indexOf("@media (max-width: 820px), (max-height: 560px) and (max-width: 960px)");
  assert.ok(mobileStart >= 0, "mobile layout media query must exist");
  const mobile = css.slice(mobileStart, mobileStart + 3000);
  const sidebarZ = Number(mobile.match(/\.sidebar \{[\s\S]*?z-index:\s*(\d+)/)?.[1] || 0);
  const scrimZ = Number(mobile.match(/\.sidebar-scrim \{[\s\S]*?z-index:\s*(\d+)/)?.[1] || 0);
  assert.ok(recoveryZ > 0 && recoveryZ < scrimZ, `recovery ${recoveryZ} must stay below scrim ${scrimZ}`);
  assert.ok(scrimZ < sidebarZ, `scrim ${scrimZ} must stay below sidebar ${sidebarZ}`);
  assert.match(mobile, /\.sidebar\.open \{[\s\S]*?transform: translateX\(0\)/, "sidebar opens above the scrim");
});
