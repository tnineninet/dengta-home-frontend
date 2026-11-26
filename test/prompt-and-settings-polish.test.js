import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatProviderLatency,
  inferProtocolFromBaseUrl,
  protocolCacheHint,
} from "../src/provider-form.js";
import {
  peekCachedHistory,
  seedInitialHistory,
  setChatHistoryCacheScope,
  writeCachedHistory,
} from "../src/chat-history-cache.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "..", "src");

test("inferProtocolFromBaseUrl detects Anthropic, Gemini, OpenAI Responses, DeepSeek, OpenRouter, SiliconFlow, and Moonshot", () => {
  assert.equal(inferProtocolFromBaseUrl("https://api.anthropic.com")?.protocol, "anthropic");
  assert.equal(inferProtocolFromBaseUrl("https://relay.example.com/v1/messages")?.protocol, "anthropic");
  assert.equal(
    inferProtocolFromBaseUrl("https://generativelanguage.googleapis.com/v1beta")?.protocol,
    "gemini",
  );
  assert.equal(inferProtocolFromBaseUrl("https://api.openai.com/v1")?.protocol, "openai-responses");
  assert.equal(inferProtocolFromBaseUrl("https://gateway.example.com/v1/responses")?.protocol, "openai-responses");
  assert.equal(inferProtocolFromBaseUrl("https://api.deepseek.com/v1")?.protocol, "openai-chat");
  assert.equal(inferProtocolFromBaseUrl("https://openrouter.ai/api/v1")?.protocol, "openai-chat");
  assert.equal(inferProtocolFromBaseUrl("https://api.siliconflow.cn/v1")?.protocol, "openai-chat");
  assert.equal(inferProtocolFromBaseUrl("https://api.moonshot.cn/v1")?.protocol, "openai-chat");
  assert.equal(inferProtocolFromBaseUrl("https://custom-relay.example.com/v1"), null);
  assert.equal(inferProtocolFromBaseUrl("not-a-url"), null);
});

test("protocolCacheHint and formatProviderLatency return crisp badges and readable timings", () => {
  assert.match(protocolCacheHint("anthropic").badge, /双断点/);
  assert.match(protocolCacheHint("openai-responses").badge, /Prefix Cache Key/);
  assert.match(protocolCacheHint("gemini").badge, /1M\+/);
  assert.match(protocolCacheHint("openai-chat").badge, /前缀/);
  assert.equal(formatProviderLatency(142), "142 ms");
  assert.equal(formatProviderLatency(1280), "1.28 s");
  assert.equal(formatProviderLatency(0), "");
  assert.equal(formatProviderLatency(null), "");
});

test("PromptPipelineInspector includes 5 structured templates and automated health checklist", () => {
  const inspector = fs.readFileSync(path.join(srcDir, "PromptPipelineInspector.jsx"), "utf8");
  assert.match(inspector, /实时感知与严格时间/);
  assert.match(inspector, /prompt-health-checklist/);
  assert.match(inspector, /Anthropic 双断点 Ephemeral 缓存已就绪/);
  assert.match(inspector, /CheckCircle2/);
});

test("AiProviderCenter exposes auto-protocol suggestion, KV-cache badges, and measured latency pills", () => {
  const center = fs.readFileSync(path.join(srcDir, "AiProviderCenter.jsx"), "utf8");
  assert.match(center, /inferProtocolFromBaseUrl/);
  assert.match(center, /一键切换协议/);
  assert.match(center, /provider-badge-cache/);
  assert.match(center, /provider-badge-latency/);
  assert.match(center, /profileLatencies/);
});

test("Settings CSS maintains crisp SVG rendering, sheet motion, Night Glass contrast, reduced-motion parity, and 18px checkbox lock", () => {
  const settingsHomeCss = fs.readFileSync(path.join(srcDir, "settings-home.css"), "utf8");
  const nightCss = fs.readFileSync(path.join(srcDir, "settings-night-contrast.css"), "utf8");
  const indexCss = fs.readFileSync(path.join(srcDir, "index.css"), "utf8");

  assert.match(settingsHomeCss, /shape-rendering:\s*geometricPrecision/);
  assert.match(settingsHomeCss, /stroke-linecap:\s*round/);
  assert.match(settingsHomeCss, /@keyframes settings-sheet-enter/);
  assert.match(settingsHomeCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(settingsHomeCss, /data-dengta-reduced-motion="true"/);

  assert.match(nightCss, /\.prompt-pipeline-studio/);
  assert.match(nightCss, /\.settings-home-group/);

  assert.match(indexCss, /\.provider-checkbox-row input\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*flex:\s*0 0 18px;/s);
  assert.match(indexCss, /\.voice-provider-toggle input\[type="checkbox"\]\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*flex:\s*0 0 18px;/s);
});

test("PromptPipelineInspector displays live upstream KV-cache telemetry and seedInitialHistory accelerates cold start without clobbering fuller caches", () => {
  const inspector = fs.readFileSync(path.join(srcDir, "PromptPipelineInspector.jsx"), "utf8");
  const app = fs.readFileSync(path.join(srcDir, "App.jsx"), "utf8");
  assert.match(inspector, /lastPromptReceipt/);
  assert.match(inspector, /最近一轮真实 KV 命中/);
  assert.match(app, /lastPromptReceipt=\{lastPromptReceipt\}/);
  assert.match(app, /真实 KV 缓存命中/);

  setChatHistoryCacheScope("acct-a::comp-1");
  const seeded = seedInitialHistory("sess-cold", [
    { id: "m1", role: "user", content: "早安" },
    { id: "m2", role: "assistant", content: "早安呀" },
  ]);
  assert.equal(seeded, true);
  assert.equal(peekCachedHistory("sess-cold")?.length, 2);

  writeCachedHistory("sess-cold", [
    { id: "m1", role: "user", content: "1" },
    { id: "m2", role: "assistant", content: "2" },
    { id: "m3", role: "user", content: "3" },
    { id: "m4", role: "assistant", content: "4" },
  ]);
  const overwritten = seedInitialHistory("sess-cold", [
    { id: "m3", role: "user", content: "3" },
    { id: "m4", role: "assistant", content: "4" },
  ]);
  assert.equal(overwritten, false, "smaller bootstrap prefetch must never overwrite a fuller cached history");
  assert.equal(peekCachedHistory("sess-cold")?.length, 4);
});
