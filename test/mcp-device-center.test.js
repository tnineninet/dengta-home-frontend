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
assert.match(component, /Home Assistant/);
assert.match(component, /\/api\/mcp/);
assert.match(component, /stdio MCP/);
assert.match(component, /MCP_ENCRYPTION_KEY/);
assert.match(component, /添加 MCP 时不需要再输入管理口令/);
assert.match(component, /mcpRequest\("\/api\/mcp\/connections\/manage"\)/);
assert.doesNotMatch(component, /X-MCP-Admin-Secret/);
assert.doesNotMatch(component, /isValidAdminSecret/);
assert.doesNotMatch(component, /设备管理口令/);
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
