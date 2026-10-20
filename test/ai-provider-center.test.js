import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beijingDateTimeInputValue,
  beijingDateTimePayload,
  formatBeijingDateTime,
  formatProviderCheckedAt,
  providerHealthView,
  providerIsRoutable,
} from "../src/ai-provider-health.js";
import {
  reasoningEffortForProvider,
  reasoningEffortOptions,
} from "../src/provider-reasoning-effort.js";
import {
  providerCredentialNeedsRecovery,
  settingsServiceErrorDetail,
  settingsServiceErrorMessage,
} from "../src/settings-service-errors.js";
import {
  AUTO_CATALOG_MIN_KEY_LENGTH,
  buildProviderCreateIntent,
  isProviderAutoCatalogReady,
  mergeCatalogSelection,
  providerActivationView,
  providerDraftSignature,
  suggestProviderName,
} from "../src/provider-form.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const component = fs.readFileSync(
  path.join(here, "..", "src", "AiProviderCenter.jsx"),
  "utf8",
);
const app = fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(here, "..", "src", "index.css"), "utf8");
const bridge = fs.readFileSync(
  path.join(here, "..", "src", "cc-switch-bridge.js"),
  "utf8",
);
const reasoning = fs.readFileSync(
  path.join(here, "..", "src", "provider-reasoning-effort.js"),
  "utf8",
);
const providerFormSource = fs.readFileSync(
  path.join(here, "..", "src", "provider-form.js"),
  "utf8",
);
const modelPickerSource = fs.readFileSync(
  path.join(here, "..", "src", "provider-model-picker.jsx"),
  "utf8",
);

function sourceSection(start, end) {
  const startIndex = component.indexOf(start);
  const endIndex = component.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source section: ${start}`);
  assert.notEqual(endIndex, -1, `missing source section end: ${end}`);
  return component.slice(startIndex, endIndex);
}

const refreshProfilesSource = sourceSection(
  "async function refreshProfiles()",
  "async function refreshProfilesAfterProbeFailure()",
);
const failedProbeRefreshSource = sourceSection(
  "async function refreshProfilesAfterProbeFailure()",
  "useEffect(() =>",
);
const initialLoadSource = sourceSection(
  "useEffect(() =>",
  "const routableCount = useMemo(",
);
const editProfileSource = sourceSection(
  "function editProfile(",
  "function openCcSwitchBridge(",
);
const createProfileSource = sourceSection(
  "async function createProfile(",
  "async function saveProfile(",
);
const saveProfileSource = sourceSection(
  "async function saveProfile(",
  "async function testProfile(",
);
const testProfileSource = sourceSection(
  "async function testProfile(",
  "async function makeDefault(",
);
const makeDefaultSource = sourceSection(
  "async function makeDefault(",
  "async function removeProfile(",
);
const removeProfileSource = sourceSection(
  "async function removeProfile(",
  "return (",
);

assert.match(component, /多供应商 API 控制台/);
assert.match(component, /OpenAI Responses \/ Sub2API \/ Codex 网关/);
assert.match(component, /Claude \/ Anthropic 原生接口/);
assert.match(component, /Gemini 原生接口/);
assert.match(component, /推理强度/);
assert.match(component, /reasoning_effort/);
assert.match(component, /reasoning\.effort/);
assert.match(reasoning, /xhigh · 极高/);
assert.match(component, /Chat 兼容接口只能显式使用 none/);
assert.match(component, /实际请求会写入安全回执/);
assert.match(component, /重试读取/);
assert.match(component, /付款页 \/ 控制台地址/);
assert.match(component, /到期时间/);
assert.match(component, /auth\.json/);
assert.match(component, /OAuth/);
assert.match(component, /Cookie/);
assert.match(component, /卡密 JSON/);
assert.match(component, /不能填/);
assert.match(component, /交给 CC Switch/);
assert.match(component, /下载无密钥离线桥接文件/);
assert.match(component, /ccswitch:\/\/v1\/import/);
assert.match(component, /不会读取 CC Switch 数据库/);
assert.match(component, /127\.0\.0\.1/);
assert.doesNotMatch(component, /X-AI-Provider-Admin-Secret/);
assert.doesNotMatch(component, /管理口令|adminSecret|unlocked|provider-unlock/);
assert.match(component, /<ProviderHealthSummary profile=\{profile\} \/>/);
assert.match(component, /重试读取/);
assert.match(component, /已到期，不可设为首选/);
assert.match(component, /下次聊天首选/);
assert.match(component, /当前可路由/);
assert.match(component, /到期（北京时间）：/);
assert.doesNotMatch(component, /连接成功|测试连接|当前运行接口|正在使用/);
assert.doesNotMatch(component, /localStorage/);
assert.doesNotMatch(component, /profile\.last_error/);
assert.doesNotMatch(component, /refresh[_ -]?token[^\n]*value=/i);
assert.doesNotMatch(component, /cookie[^\n]*value=/i);
assert.doesNotMatch(component, /auth\.json[^\n]*type="file"/i);
assert.match(refreshProfilesSource, /\/api\/ai-providers\/manage/);
assert.match(refreshProfilesSource, /Array\.isArray\(data\.profiles\)/);
assert.match(refreshProfilesSource, /setProfiles\(nextProfiles\)/);
assert.match(initialLoadSource, /aiProviderRequest\("\/api\/ai-providers\/manage"\)/);
assert.match(initialLoadSource, /Promise\.allSettled/);
assert.match(initialLoadSource, /profilesResult\.status === "fulfilled"/);
assert.match(initialLoadSource, /setProfiles\(/);
assert.doesNotMatch(initialLoadSource, /X-AI-Provider-Admin-Secret|adminSecret/);
assert.match(failedProbeRefreshSource, /await refreshProfiles\(\)/);
assert.match(
  editProfileSource,
  /field === "is_default" && value === true[\s\S]*?is_default: false/,
);
for (const mutationSource of [
  createProfileSource,
  saveProfileSource,
  testProfileSource,
  makeDefaultSource,
  removeProfileSource,
]) {
  assert.match(mutationSource, /await refreshProfiles\(\)/);
}
assert.doesNotMatch(createProfileSource, /setProfiles\(/);
assert.doesNotMatch(saveProfileSource, /setProfiles\(/);
assert.doesNotMatch(makeDefaultSource, /setProfiles\(/);
assert.match(
  testProfileSource,
  /catch \(error\) \{[\s\S]*?await refreshProfilesAfterProbeFailure\(\);[\s\S]*?settingsServiceErrorDetail\(error/,
);
assert.match(bridge, /ccswitch:\/\/v1\/import/);
assert.match(bridge, /enabled: "false"/);
assert.match(bridge, /API Key/);
assert.doesNotMatch(bridge, /localStorage/);
assert.doesNotMatch(bridge, /cc-switch\.db/);
assert.match(app, /<AiProviderCenter(?:\s+onStatusChange=\{setProviderStatus\})? \/>/);
assert.match(app, /function openProviderRecovery\(\)/);
assert.match(app, /setSettingsCategory\("services"\)/);
assert.match(app, /onClick=\{retryStartupConnection\}/);
assert.doesNotMatch(app, /旧版单接口（兼容保留）/);
assert.doesNotMatch(app, /draftSettings\.api_url/);
assert.doesNotMatch(app, /draftSettings\.model/);
assert.doesNotMatch(app, /API Key 永远只放在后端环境变量中/);
assert.match(component, /API Key 只发送到后端加密保存/);
assert.match(component, /onStatusChange\?\.\(failed\)/);
assert.match(component, /迁移后无法聊天？重新保存活动 GPT 密钥/);
assert.match(component, /providerCredentialNeedsRecovery\(profile\)/);
assert.match(
  settingsServiceErrorMessage({ code: "AI_PROVIDER_CREDENTIAL_INVALID" }),
  /saved provider key cannot be decrypted/i,
);
assert.match(
  settingsServiceErrorMessage({ code: "MCP_CREDENTIAL_INVALID" }),
  /saved device credential cannot be decrypted/i,
);
assert.match(
  settingsServiceErrorDetail(
    {
      code: "AI_PROVIDER_UPSTREAM_AUTH_FAILED",
      status: 502,
      upstream_status: 403,
    },
    "fallback",
  ),
  /AI_PROVIDER_UPSTREAM_AUTH_FAILED · 后端 HTTP 502 · 上游 HTTP 403/,
);
assert.match(component, /data\.error \|\| data\.code/);
assert.match(component, /data\.upstream_status/);
assert.match(component, /settingsServiceErrorDetail\(error/);
assert.equal(
  providerCredentialNeedsRecovery({
    health: { detail: "接口凭据无法解密，请重新填写 API Key。" },
  }),
  true,
);
assert.equal(reasoningEffortForProvider("openai-responses", "xhigh"), "xhigh");
assert.equal(reasoningEffortForProvider("openai-chat", "xhigh"), "");
assert.equal(reasoningEffortOptions("openai-chat").length, 2);
assert.match(app, /本轮推理强度请求/);
assert.match(css, /\.ai-provider-center/);
assert.match(css, /\.provider-form-grid/);
assert.match(css, /\.provider-health-catalog_ok/);
assert.match(css, /\.provider-health-catalog_error/);
assert.match(css, /\.provider-health-expired/);
assert.match(css, /\.provider-card-actions button \{[\s\S]*?min-height: 44px/);
assert.match(css, /\.ai-provider-center button,[\s\S]*?min-height: 44px/);
assert.match(css, /\.ai-provider-center \.provider-billing-link \{[\s\S]*?display: inline-flex/);
assert.match(css, /white-space: normal/);
assert.match(css, /\.cc-switch-bridge/);

const serverHealth = providerHealthView({
  last_status: "error",
  last_error: "raw-upstream-secret",
  health: {
    state: "catalog_ok",
    summary: "模型目录可读取",
    detail: "已安全检查模型目录。",
    checked_at: "2026-07-24T01:06:04.000Z",
  },
});
assert.equal(serverHealth.state, "catalog_ok");
assert.equal(serverHealth.label, "模型目录可读取");
assert.equal(serverHealth.summary, "模型目录可读取");
assert.equal(serverHealth.detail, "已安全检查模型目录。");
assert.match(serverHealth.checkedAtLabel, /^上次检查（北京时间）：/);
assert.equal(JSON.stringify(serverHealth).includes("raw-upstream-secret"), false);
const healthMetadataSecret = ["gsk_", "TEST_", "Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8"].join("");
const redactedServerHealth = providerHealthView({
  health: {
    state: "catalog_error",
    summary: "检查失败",
    detail: `Bearer ${healthMetadataSecret}`,
  },
});
assert.equal(
  JSON.stringify(redactedServerHealth).includes(healthMetadataSecret),
  false,
);

const legacyFailure = providerHealthView({
  last_status: "error",
  last_error: "legacy-raw-upstream-secret",
  last_checked_at: "2026-07-24T01:06:04.000Z",
});
assert.equal(legacyFailure.state, "catalog_error");
assert.equal(legacyFailure.label, "检查失败");
assert.match(legacyFailure.detail, /接口配置、权限或额度/);
assert.equal(JSON.stringify(legacyFailure).includes("legacy-raw-upstream-secret"), false);

const legacyExpired = providerHealthView(
  {
    expires_at: "2026-07-23T00:00:00.000Z",
    last_status: "connected",
  },
  Date.parse("2026-07-24T00:00:00.000Z"),
);
assert.equal(legacyExpired.state, "expired");
assert.equal(legacyExpired.label, "已到期");
assert.equal(legacyExpired.summary, "已到期，不参与路由");
assert.equal(providerIsRoutable({
  enabled: true,
  expires_at: "2026-07-23T00:00:00.000Z",
}, Date.parse("2026-07-24T00:00:00.000Z")), false);

const staleConnectedHealth = providerHealthView(
  {
    enabled: true,
    expires_at: "2026-07-23T00:00:00.000Z",
    health: {
      state: "catalog_ok",
      summary: "模型目录可读取",
      detail: "旧的正常状态。",
    },
  },
  Date.parse("2026-07-24T00:00:00.000Z"),
);
assert.equal(staleConnectedHealth.state, "expired");
assert.equal(staleConnectedHealth.summary, "已到期，不参与路由");
assert.equal(staleConnectedHealth.detail.includes("旧的正常状态"), false);

const renewedExpiredHealth = providerHealthView(
  {
    enabled: true,
    expires_at: "2026-07-25T00:00:00.000Z",
    last_status: "connected",
    health: {
      state: "expired",
      summary: "接口已到期",
      detail: "保存前的旧状态。",
    },
  },
  Date.parse("2026-07-24T00:00:00.000Z"),
);
assert.equal(renewedExpiredHealth.state, "catalog_ok");
assert.equal(renewedExpiredHealth.summary, "模型目录可读取");
assert.equal(renewedExpiredHealth.detail.includes("保存前的旧状态"), false);
assert.equal(providerIsRoutable({
  enabled: true,
  expires_at: "2026-07-25T00:00:00.000Z",
  health: { state: "expired" },
}, Date.parse("2026-07-24T00:00:00.000Z")), true);
assert.equal(providerIsRoutable({
  enabled: true,
  health: { state: "expired" },
}, Date.parse("2026-07-24T00:00:00.000Z")), false);
assert.equal(providerIsRoutable({
  enabled: true,
  expires_at: "2026-07-24T09:00",
}, Date.parse("2026-07-24T01:01:00.000Z")), false);

const legacyUntested = providerHealthView({});
assert.equal(legacyUntested.state, "untested");
assert.equal(legacyUntested.label, "尚未检查");
assert.equal(
  formatProviderCheckedAt("not-a-date"),
  "上次检查（北京时间）：尚无记录",
);
assert.equal(
  formatProviderCheckedAt("2026-07-24T01:06:04.000Z"),
  "上次检查（北京时间）：2026-07-24 09:06",
);
assert.equal(
  formatBeijingDateTime("2026-07-24T01:06:04.000Z"),
  "2026-07-24 09:06",
);
assert.equal(
  beijingDateTimeInputValue("2026-07-24T01:06:04.000Z"),
  "2026-07-24T09:06",
);
assert.equal(
  beijingDateTimePayload("2026-07-24T09:06"),
  "2026-07-24T01:06:00.000Z",
);
assert.equal(
  beijingDateTimePayload("2024-02-29T09:06"),
  "2024-02-29T01:06:00.000Z",
);
assert.equal(beijingDateTimePayload("2025-02-29T09:06"), null);
assert.equal(beijingDateTimePayload("2026-02-31T09:06"), null);
assert.equal(formatBeijingDateTime("2026-02-31T09:06"), "");
assert.equal(beijingDateTimeInputValue("2026-02-31T09:06"), "");
assert.equal(formatBeijingDateTime("not-a-date"), "");
assert.equal(beijingDateTimeInputValue("not-a-date"), "");
assert.equal(component.includes("Invalid Date"), false);

// ---- 本轮「极简 / 不闪 / 可读 / 自动读目录并真正启用」回归 ----

// 1) 默认只保留必要字段，其余收进默认收起的「高级设置」。
assert.match(component, /<ProviderModelPicker/);
assert.match(component, /<details className="provider-advanced">/);
assert.match(component, /默认只要下面 5 项/);
assert.doesNotMatch(component, /<datalist/);
assert.doesNotMatch(component, /data-compact/);
assert.doesNotMatch(component, /<details[^>]*\bopen\b/);
assert.match(component, /重试读取/);
assert.match(component, /保存并启用/);
assert.doesNotMatch(component, /保存并启用中/);
assert.doesNotMatch(component, /hidden disabled=/);

// 2) 自动读目录：https + Key 就绪后防抖触发，成功后选中首个模型并准备启用。
assert.match(component, /isProviderAutoCatalogReady\(/);
assert.match(component, /providerDraftSignature\(/);
assert.match(component, /latestDraftRef/);
assert.match(component, /\/api\/ai-providers\/manage\/test/);
assert.match(component, /autoCatalogDelayMs/);
assert.match(component, /mergeCatalogSelection\(/);
assert.match(component, /已自动读取/);
assert.match(component, /自动读取模型目录失败/);

// 3) 保存必须显式发送启用/首选，并用后端返回 profile 校验后才敢提示成功。
assert.match(component, /buildProviderCreateIntent\(submitted\)/);
assert.match(component, /providerActivationView\(returnedProfile\)/);
assert.match(component, /enableSavedProvider/);
assert.match(providerFormSource, /enabled: true,\s*\n\s*is_default: true/);
assert.match(providerFormSource, /AUTO_CATALOG_DEBOUNCE_MS = 900/);
assert.match(providerFormSource, /enabled && isDefault/);
assert.equal(isProviderAutoCatalogReady({
  base_url: "https://gw.example.test/v1",
  credential: "synthetic-placeholder-key",
}), true);
assert.equal(isProviderAutoCatalogReady({
  base_url: "http://gw.example.test/v1",
  credential: "synthetic-placeholder-key",
}), false);
assert.equal(isProviderAutoCatalogReady({
  base_url: "https://gw.example.test/v1",
  credential: "short",
}), false);
assert.equal(isProviderAutoCatalogReady({
  base_url: "https://gw.example.test/v1",
  auth_type: "none",
}), true);
assert.equal(isProviderAutoCatalogReady({
  base_url: "https://gw.example.test/v1",
  credential: "x".repeat(AUTO_CATALOG_MIN_KEY_LENGTH),
}), true);
assert.equal(
  providerDraftSignature({
    protocol: "openai-chat",
    base_url: " https://a.example.test/v1 ",
    auth_type: "bearer",
    credential: " synthetic-key ",
  }),
  "openai-chat|https://a.example.test/v1|bearer|synthetic-key",
);
const createIntent = buildProviderCreateIntent({
  name: "   ",
  base_url: "https://gw.example.test/v1",
  default_model: "  model-a  ",
  protocol: "openai-chat",
});
assert.equal(createIntent.name, "gw.example.test");
assert.equal(createIntent.default_model, "model-a");
assert.equal(createIntent.enabled, true);
assert.equal(createIntent.is_default, true);
assert.equal(
  buildProviderCreateIntent({ name: "  我的接口 ", base_url: "https://x.test" }).name,
  "我的接口",
);
assert.equal(suggestProviderName({ base_url: "not-a-url" }), "我的模型接口");
const autoSelection = mergeCatalogSelection({ default_model: "  " }, ["model-a", "model-b"]);
assert.equal(autoSelection.default_model, "model-a");
assert.equal(autoSelection.auto_selected_model, "model-a");
assert.equal(autoSelection.enabled, true);
assert.equal(autoSelection.is_default, true);
const keptSelection = mergeCatalogSelection({ default_model: "manual-model" }, ["model-a"]);
assert.equal(keptSelection.default_model, "manual-model");
assert.equal(keptSelection.auto_selected_model, "");
assert.equal(providerActivationView({ enabled: true, is_default: true }).state, "active");
assert.match(
  providerActivationView({ enabled: true, is_default: true }).message,
  /已加密保存并启用/,
);
assert.equal(providerActivationView({ enabled: true, is_default: false }).state, "enabled");
assert.match(
  providerActivationView({ enabled: true, is_default: false }).message,
  /还不是下次聊天首选/,
);
assert.equal(providerActivationView({ enabled: false, is_default: false }).state, "disabled");
assert.match(
  providerActivationView({ enabled: false, is_default: false }).message,
  /未启用/,
);
assert.equal(providerActivationView(null).state, "unknown");
assert.match(providerActivationView(null).message, /状态回执/);

// 4) 闪烁修复：状态条常驻、按钮文字稳定、状态通知去重、无整页骨架切换。
assert.doesNotMatch(component, /\{feedback &&/);
assert.match(component, /className="provider-feedback" role="status" aria-live="polite"/);
assert.match(component, /aria-busy=\{busy === "create"\}/);
assert.match(component, /function applyStatus\(next\) \{[\s\S]*?serialized === statusSnapshotRef\.current/);
assert.match(component, /setFeedback\(operationMessage\(name\)\)/);
assert.doesNotMatch(component, /setFeedback\(""\)/);

// 5) 模型按钮必须弹出真正的 listbox（不用 datalist），键盘与点选都要支持。
assert.match(modelPickerSource, /role="listbox"/);
assert.match(modelPickerSource, /role="option"/);
assert.match(modelPickerSource, /aria-expanded=\{open\}/);
assert.match(modelPickerSource, /aria-activedescendant/);
assert.match(modelPickerSource, /ArrowDown/);
assert.match(modelPickerSource, /ArrowUp/);
assert.match(modelPickerSource, /Escape/);
assert.match(modelPickerSource, /scrollIntoView/);
assert.match(modelPickerSource, /onClick=\{\(\) => choose\(model\)\}/);
assert.match(modelPickerSource, /provider-model-empty/);
assert.doesNotMatch(component, /datalist/i);

// 6) 本页样式：无动画/过渡，弹层可滚动，颜色集中在 --provider-* 变量。
const providerCssStart = css.indexOf("模型接入 / 多供应商 API 控制台：本页专用样式");
assert.notEqual(providerCssStart, -1, "missing provider page css block");
const providerCss = css.slice(providerCssStart);
assert.doesNotMatch(providerCss, /@keyframes/);
assert.match(providerCss, /animation: none !important/);
assert.match(providerCss, /transition: none !important/);
assert.match(providerCss, /backdrop-filter: none !important/);
assert.match(providerCss, /\.provider-model-popover \{[\s\S]*?position: absolute/);
assert.match(providerCss, /max-height: min\(42vh, 320px\)/);
assert.match(providerCss, /\.provider-model-option \{[\s\S]*?min-height: 44px/);
assert.match(providerCss, /\.provider-advanced summary \{[\s\S]*?min-height: 44px/);
assert.match(providerCss, /\.provider-help > summary \{[\s\S]*?min-height: 44px/);
assert.match(providerCss, /\.provider-status-row \{[\s\S]*?min-height: 64px/);
assert.match(providerCss, /\.provider-catalog-row \{[\s\S]*?min-height: 64px/);
assert.match(
  providerCss,
  /\.ai-provider-center details:not\(\[open\]\) > \*:not\(summary\) \{\s*\n\s*display: none !important;/,
);
assert.match(
  providerCss,
  /\.ai-provider-center \.provider-form-grid label,[\s\S]*?color: var\(--provider-ink\)/,
);
assert.match(
  providerCss,
  /\.ai-provider-center \.primary-button \{[\s\S]*?color: var\(--provider-accent-ink\)/,
);
assert.match(providerCss, /background: var\(--provider-accent\);/);

// 7) 对比度：逐对计算 WCAG 比值，浅色与夜间都必须 ≥ 4.5:1。
const ruleBlocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim(), body: match[2] }));
function providerColors(selectorMatcher) {
  const block = ruleBlocks.find((rule) => selectorMatcher(rule) && rule.body.includes("--provider-surface"));
  assert.ok(block, "missing provider color block");
  const colors = {};
  for (const match of block.body.matchAll(/--provider-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    colors[match[1]] = match[2];
  }
  return colors;
}
const dayProviderColors = providerColors((rule) => rule.selector.endsWith(".ai-provider-center"));
const nightProviderColors = providerColors(
  (rule) => rule.selector === ':root[data-dengta-appearance="night"] .ai-provider-center',
);
function channelLuminance(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance(hex) {
  const normalized = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16));
  return 0.2126 * channelLuminance(channels[0])
    + 0.7152 * channelLuminance(channels[1])
    + 0.0722 * channelLuminance(channels[2]);
}
function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
const contrastPairs = [
  ["ink", "surface"],
  ["muted", "surface"],
  ["ink", "surface-2"],
  ["muted", "surface-2"],
  ["input-ink", "input-bg"],
  ["accent-ink", "accent"],
  ["accent-text", "surface"],
  ["ok-ink", "ok-bg"],
  ["warn-ink", "warn-bg"],
  ["error-ink", "error-bg"],
];
for (const [theme, colors] of [
  ["day", dayProviderColors],
  ["night", nightProviderColors],
]) {
  for (const [foreground, background] of contrastPairs) {
    assert.ok(colors[foreground] && colors[background], `missing ${theme} provider color ${foreground}/${background}`);
    const ratio = contrastRatio(colors[foreground], colors[background]);
    assert.ok(
      ratio >= 4.5,
      `${theme} theme contrast ${colors[foreground]} on ${colors[background]} is ${ratio.toFixed(2)} (< 4.5)`,
    );
  }
}
assert.deepEqual(
  Object.keys(dayProviderColors).sort(),
  Object.keys(nightProviderColors).sort(),
  "day/night provider palettes must define the same tokens",
);
assert.ok(Object.keys(dayProviderColors).length >= 19, "provider palette is missing tokens");

console.log("AI provider center UI tests passed");
