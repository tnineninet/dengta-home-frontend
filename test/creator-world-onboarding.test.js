import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8");
const studio = fs.readFileSync(path.join(here, "..", "src", "CreatorWorldStudio.jsx"), "utf8");
const studioCss = fs.readFileSync(path.join(here, "..", "src", "creator-world-studio.css"), "utf8");
const mcpCenter = fs.readFileSync(path.join(here, "..", "src", "McpDeviceCenter.jsx"), "utf8");
const nav = fs.readFileSync(path.join(here, "..", "src", "feature-navigation.js"), "utf8");

// 1. App.jsx must route MCP Device Center jumps to settingsCategory "devices", never "services"
assert.match(
  app,
  /function openMcpDeviceCenter\(\)\s*\{[\s\S]*?setSettingsCategory\("devices"\);[\s\S]*?setSettingsFocusTarget\("mcp-device-center"\);/,
  "openMcpDeviceCenter must open settingsCategory 'devices' and focus mcp-device-center",
);
assert.doesNotMatch(
  app,
  /openProviderRecovery\(\);\s*setSettingsFocusTarget\("mcp-device-center"\)/,
  "no remaining broken openProviderRecovery() + mcp-device-center jumps",
);
assert.match(
  app,
  /function openXhsSettings\(\)\s*\{[\s\S]*?setSettingsCategory\("fun"\);[\s\S]*?setSettingsFocusTarget\("xhs-login-section"\);/,
  "openXhsSettings must open settingsCategory 'fun' and focus xhs-login-section",
);
assert.match(app, /id="xhs-login-section"/, "XhsLoginPanel wrapper id must exist");
assert.match(app, /onOpenXhsSettings=\{openXhsSettings\}/);
assert.match(app, /onOpenBilibiliLogin=\{/);
assert.match(app, /onOpenAgentStudio=\{/);

// 2. CreatorWorldStudio must include guided onboarding tab, shared local gateway storage, and all 4 platforms
assert.match(studio, /id:\s*"connect",\s*label:\s*"接入向导 · 平台入口"/);
assert.match(studio, /怎么接入？/);
assert.match(studio, /getSavedBridgeBaseUrl/);
assert.match(studio, /setSavedBridgeBaseUrl/);
assert.match(studio, /测试并连接本机网关/);
assert.match(studio, /去「一起看」登录 B 站/);
assert.match(studio, /打开小红书登录与发布/);
assert.match(studio, /去 MCP 中心绑抖音/);
assert.match(studio, /打开「AI 工作台·剪映」/);
assert.match(studio, /cloudflared tunnel --url http:\/\/127\.0\.0\.1:18088/);
assert.match(studio, /id:\s*"xiaohongshu"/);
assert.doesNotMatch(studio, /可直接粘贴到 MoneyPrinterTurbo 或 DengTa MCP 设备中心/);

// 3. Checkbox lock + Night Glass contrast in creator-world-studio.css
assert.match(studioCss, /\.cws-check input\[type="checkbox"\][\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;/);
assert.match(studioCss, /:root\[data-dengta-appearance="night"\] \.cws-cmd-strip/);

// 4. McpDeviceCenter presets default to bearer for creator MCPs and scroll form into view
assert.match(mcpCenter, /bilibili-creator-mcp/);
assert.match(mcpCenter, /douyin-creator-mcp/);
assert.match(mcpCenter, /formRef\.current\?\.scrollIntoView/);

// 5. Sidebar search keywords include 小红书 / 接入 / 接口 for AI 视界
assert.match(nav, /"creator-world":[\s\S]*小红书[\s\S]*接口/);

console.log("Creator world onboarding & MCP navigation tests passed");
