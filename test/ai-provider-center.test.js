import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const component = fs.readFileSync(
  path.join(here, "..", "src", "AiProviderCenter.jsx"),
  "utf8",
);
const app = fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(here, "..", "src", "index.css"), "utf8");

assert.match(component, /多供应商 API 控制台/);
assert.match(component, /OpenAI Responses \/ Sub2API \/ Codex 网关/);
assert.match(component, /Claude \/ Anthropic 原生接口/);
assert.match(component, /Gemini 原生接口/);
assert.match(component, /X-AI-Provider-Admin-Secret/);
assert.match(component, /测试但不保存/);
assert.match(component, /付款页 \/ 控制台地址/);
assert.match(component, /到期时间/);
assert.match(component, /auth\.json/);
assert.match(component, /OAuth/);
assert.match(component, /Cookie/);
assert.match(component, /卡密 JSON/);
assert.match(component, /不能填/);
assert.match(component, /127\.0\.0\.1/);
assert.match(component, /管理口令只保存在本次页面内存/);
assert.doesNotMatch(component, /localStorage/);
assert.doesNotMatch(component, /refresh[_ -]?token[^\n]*value=/i);
assert.doesNotMatch(component, /cookie[^\n]*value=/i);
assert.doesNotMatch(component, /auth\.json[^\n]*type="file"/i);
assert.match(app, /<AiProviderCenter \/>/);
assert.match(app, /旧版单接口（兼容保留）/);
assert.match(css, /\.ai-provider-center/);
assert.match(css, /\.provider-form-grid/);

console.log("AI provider center UI tests passed");
