import assert from "node:assert/strict";
import {
  buildServiceStatusCards,
  describeExpressiveTts,
  describeGroqExpiry,
  readGroqExpiryDate,
  storeGroqExpiryDate,
} from "../src/service-status.js";

const cards = buildServiceStatusCards({
  health: {
    ok: true,
    version: "0.11.1",
    configuration: { provider_pins_valid: true },
    features: {
      hervoice_proxy_configured: true,
      expressive_tts_configured: false,
      expressive_tts_provider: "none",
      ombre_mcp_client: true,
      ombre_mcp_configured: false,
    },
  },
  settings: {
    provider: "openai-compatible",
    api_url: "https://example.test/v1",
    model: "test-model",
  },
  hasLoadedSettings: true,
  isOnline: true,
  error: "",
});

assert.equal(cards.find((item) => item.id === "backend").status, "online");
assert.equal(cards.find((item) => item.id === "database").status, "online");
assert.equal(cards.find((item) => item.id === "provider").status, "online");
assert.equal(cards.find((item) => item.id === "groq").status, "online");
assert.equal(cards.find((item) => item.id === "voice-output").status, "pending");
assert.equal(
  cards.find((item) => item.id === "voice-output").summary,
  "尚未配置自然语音",
);
assert.equal(cards.find((item) => item.id === "ombre-mcp").status, "pending");

const awaitingVoice = describeExpressiveTts({
  expressive_tts_configured: false,
  expressive_tts_api_key_configured: true,
  expressive_tts_voice_configured: false,
  expressive_tts_provider: "minimax",
});
assert.equal(awaitingVoice.stage, "awaiting_voice");
assert.equal(awaitingVoice.status, "pending");
assert.equal(awaitingVoice.summary, "密钥已就绪，等待生成音色");
assert.match(awaitingVoice.settingsText, /Voice Design/);

const readyVoice = describeExpressiveTts({
  expressive_tts_configured: true,
  expressive_tts_api_key_configured: true,
  expressive_tts_voice_configured: true,
  expressive_tts_provider: "minimax",
});
assert.equal(readyVoice.stage, "ready");
assert.equal(readyVoice.status, "online");
assert.equal(readyVoice.summary, "已连接 MiniMax");

const readyDeepgram = describeExpressiveTts({
  expressive_tts_configured: true,
  expressive_tts_api_key_configured: true,
  expressive_tts_voice_configured: true,
  expressive_tts_provider: "deepgram",
});
assert.equal(readyDeepgram.providerName, "Deepgram");
assert.match(readyDeepgram.settingsText, /中文回退尚未配置/);
assert.equal(readyDeepgram.summary, "Deepgram 已连接 · 中文暂不可用");

const readyDeepgramWithFallback = describeExpressiveTts({
  expressive_tts_configured: true,
  expressive_tts_api_key_configured: true,
  expressive_tts_voice_configured: true,
  expressive_tts_provider: "deepgram",
  expressive_tts_chinese_fallback_available: true,
});
assert.match(readyDeepgramWithFallback.settingsText, /自动使用服务器 MiniMax/);

const deepgramCards = buildServiceStatusCards({
  health: {
    ok: true,
    configuration: { provider_pins_valid: true },
    features: {},
  },
  settings: { api_url: "https://example.test/v1", model: "test-model" },
  hasLoadedSettings: true,
  isOnline: true,
  error: "",
  voiceOutput: {
    provider: "deepgram",
    enabled: true,
    model: "aura-2-helena-en",
    credential_configured: true,
    configured: true,
    chinese_fallback_available: false,
  },
});
const deepgramCard = deepgramCards.find((item) => item.id === "voice-output");
assert.equal(deepgramCard.name, "Deepgram 自然语音");
assert.equal(deepgramCard.status, "online");
assert.equal(deepgramCard.summary, "Deepgram 已连接 · 中文暂不可用");
assert.equal(deepgramCard.link, "https://console.deepgram.com/");

const missingKey = describeExpressiveTts({
  expressive_tts_configured: false,
  expressive_tts_api_key_configured: false,
  expressive_tts_voice_configured: false,
});
assert.equal(missingKey.stage, "incomplete");
assert.match(missingKey.settingsText, /配置还不完整/);

const legacyVoice = describeExpressiveTts({
  expressive_tts_configured: false,
});
assert.equal(legacyVoice.stage, "legacy_pending");
assert.equal(legacyVoice.summary, "尚未配置自然语音");
assert.doesNotMatch(
  JSON.stringify([
    describeExpressiveTts({
      expressive_tts_configured: true,
      expressive_tts_api_key_configured: true,
      expressive_tts_voice_configured: true,
    }),
    awaitingVoice,
    missingKey,
    legacyVoice,
  ]),
  /手机系统朗读|手机朗读备用/,
);

const fixedNow = new Date("2026-07-23T00:00:00Z");
assert.equal(describeGroqExpiry("", fixedNow).status, "unknown");
assert.equal(describeGroqExpiry("2026-07-30", fixedNow).status, "warning");
assert.equal(describeGroqExpiry("2026-10-21", fixedNow).status, "ok");
assert.equal(describeGroqExpiry("2026-07-01", fixedNow).status, "expired");

const values = new Map();
const storage = {
  getItem(key) {
    return values.get(key) || null;
  },
  setItem(key, value) {
    values.set(key, value);
  },
  removeItem(key) {
    values.delete(key);
  },
};

storeGroqExpiryDate("2026-10-21", storage);
assert.equal(readGroqExpiryDate(storage), "2026-10-21");
storeGroqExpiryDate("", storage);
assert.equal(readGroqExpiryDate(storage), "");

console.log("frontend service status tests passed");
