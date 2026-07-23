import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const component = fs.readFileSync(path.join(here, "..", "src", "McpDeviceCenter.jsx"), "utf8");
const app = fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(here, "..", "src", "index.css"), "utf8");

assert.match(component, /MCP 设备中心/);
assert.match(component, /禁止自动执行（默认）/);
assert.match(component, /允许 AI 自动执行/);
assert.match(component, /X-MCP-Admin-Secret/);
assert.match(component, /Home Assistant/);
assert.match(component, /\/api\/mcp/);
assert.match(component, /stdio MCP/);
assert.match(component, /口令不会保存到手机本地/);
assert.match(component, /isValidAdminSecret/);
assert.match(component, /管理口令格式不正确/);
assert.match(component, /不要输入中文说明/);
assert.doesNotMatch(component, /localStorage/);
assert.match(app, /DeviceActionReceipts/);
assert.doesNotMatch(
  app,
  /key=\{`companion-status-\$\{companionStatusCollapseToken\}`\}/,
  "companion status must not be remounted after an interaction",
);
assert.match(css, /\.view-content\s*\{[^}]*margin-bottom:\s*18px/s);
assert.match(css, /\.mcp-tool-list/);

console.log("MCP device center UI tests passed");
