import assert from "node:assert/strict";
import {
  buildServiceStatusCards,
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
assert.equal(cards.find((item) => item.id === "minimax").status, "pending");

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
