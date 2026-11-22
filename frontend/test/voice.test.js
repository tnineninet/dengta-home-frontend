import assert from "node:assert/strict";
import fs from "node:fs";
import {
  VOICE_MAX_DURATION_MS,
  VOICE_MIN_DURATION_MS,
  VOICE_PLAYBACK_MODES,
  VOICE_STATES,
  VOICE_STATE_LABELS,
  VOICE_TURN_TIMEOUT_MS,
  buildVoiceTurnFormData,
  createVoiceTurnRequest,
  formatVoiceConfidence,
  hydrateStoredVoiceAnalysis,
  hydrateStoredVoiceMessages,
  localizeVoiceEmotion,
  normalizeVoiceAnalysis,
  normalizeVoicePlaybackMode,
  requestExpressiveSpeech,
  resolveVoiceCaptureAfterPermission,
  selectRecorderMimeType,
  speakVoiceText,
  stopVoiceSpeech,
  validateVoiceDuration,
  voiceCaptureErrorMessage,
  voiceBlocksComposer,
  voiceRecordingSupported,
} from "../src/voice.js";

class MockMediaRecorder {
  static isTypeSupported(value) {
    return value === "audio/webm";
  }
}

assert.equal(selectRecorderMimeType(MockMediaRecorder), "audio/webm");
assert.equal(selectRecorderMimeType(undefined), "");

assert.equal(validateVoiceDuration(VOICE_MIN_DURATION_MS - 1).ok, false);
assert.match(
  validateVoiceDuration(VOICE_MIN_DURATION_MS - 1).message,
  /太短/,
);
assert.equal(validateVoiceDuration(VOICE_MIN_DURATION_MS).ok, true);
assert.equal(validateVoiceDuration(VOICE_MAX_DURATION_MS).ok, true);
assert.equal(validateVoiceDuration(VOICE_MAX_DURATION_MS + 2_001).ok, false);

const normalized = normalizeVoiceAnalysis({
  text: "  今天\u0000有一点开心  ",
  emotion: "轻松",
  confidence: 82,
  hint: "语速平稳",
  features: { internal_debug: "不得显示" },
});
assert.deepEqual(normalized, {
  text: "今天有一点开心",
  emotion: "轻松",
  confidence: 0.82,
  hint: "语速平稳",
});
assert.equal("features" in normalized, false);
assert.equal(formatVoiceConfidence(0.826), "置信度 83%");
assert.equal(formatVoiceConfidence("unknown"), "置信度未知");

const storedVoiceMessage = hydrateStoredVoiceAnalysis({
  id: "voice-message",
  role: "user",
  content: "历史转写内容",
  tool_calls: {
    is_voice: true,
    voice_analysis: {
      emotion: "tired",
      confidence: 0.7,
      hint: "语速偏慢",
    },
  },
});
assert.deepEqual(storedVoiceMessage.voiceAnalysis, {
  text: "历史转写内容",
  emotion: "疲惫",
  confidence: 0.7,
  hint: "语速偏慢",
});
assert.equal(
  hydrateStoredVoiceMessages([storedVoiceMessage, { id: "plain" }]).length,
  2,
);
assert.equal(localizeVoiceEmotion("happy"), "开心");
assert.equal(localizeVoiceEmotion("sad"), "难过");
assert.equal(localizeVoiceEmotion("angry"), "生气");
assert.equal(localizeVoiceEmotion("tired"), "疲惫");
assert.equal(localizeVoiceEmotion("affectionate"), "温柔亲昵");
assert.equal(localizeVoiceEmotion("excited"), "兴奋");
assert.equal(localizeVoiceEmotion("anxious"), "焦虑紧张");
assert.equal(localizeVoiceEmotion("neutral"), "中性");
assert.equal(localizeVoiceEmotion("unexpected_internal_label"), "未确定");
assert.equal(localizeVoiceEmotion("平静"), "平静");

assert.match(
  voiceCaptureErrorMessage({ name: "NotAllowedError" }),
  /麦克风权限/,
);
assert.match(
  voiceCaptureErrorMessage({ name: "NotFoundError" }),
  /没有找到可用麦克风/,
);
assert.match(
  voiceCaptureErrorMessage({ name: "NotReadableError" }),
  /其他应用占用/,
);

assert.equal(
  voiceRecordingSupported({
    navigator: { mediaDevices: { getUserMedia() {} } },
    MediaRecorder: MockMediaRecorder,
  }),
  true,
);
assert.equal(voiceRecordingSupported({ navigator: {} }), false);

assert.deepEqual(resolveVoiceCaptureAfterPermission(true, false), {
  startRecording: true,
  tapToSend: false,
});
assert.deepEqual(resolveVoiceCaptureAfterPermission(false, false), {
  startRecording: true,
  tapToSend: true,
});
assert.deepEqual(resolveVoiceCaptureAfterPermission(true, true), {
  startRecording: true,
  tapToSend: true,
});

const formData = buildVoiceTurnFormData({
  blob: new Blob(["voice"], { type: "audio/webm" }),
  sessionId: "session-id",
  clientTime: "2026/7/21 20:00:00",
  timezone: "Asia/Shanghai",
  model: "gpt-5.5",
  emotionUnderstandingEnabled: true,
  companionStatus: { mood: "安心" },
  environmentContext: {
    timeZone: "Asia/Shanghai",
    weather: { temperatureC: 25.5, description: "多云" },
  },
  turnContext: "本轮语音的临时背景",
  timestamp: 123,
});
assert.equal(formData.get("session_id"), "session-id");
assert.equal(formData.get("timezone"), "Asia/Shanghai");
assert.equal(formData.get("model"), "gpt-5.5");
assert.equal(formData.get("emotion_understanding_enabled"), "true");
assert.equal(formData.get("voice_analysis_retention_enabled"), "true");
const noRetentionForm = buildVoiceTurnFormData({
  blob: new Blob(["voice"], { type: "audio/webm" }),
  voiceAnalysisRetentionEnabled: false,
});
assert.equal(noRetentionForm.get("voice_analysis_retention_enabled"), "false");
assert.deepEqual(JSON.parse(formData.get("companion_status")), {
  mood: "安心",
});
assert.deepEqual(JSON.parse(formData.get("environment_context")), {
  timeZone: "Asia/Shanghai",
  weather: { temperatureC: 25.5, description: "多云" },
});
assert.equal(formData.get("turn_context"), "本轮语音的临时背景");
assert.equal(formData.get("file").name, "dengta-voice-123.webm");
assert.equal(formData.get("file").type, "audio/webm");

assert.equal(VOICE_STATES.recording, "recording");
assert.match(VOICE_STATE_LABELS.recording, /松开发送/);
assert.match(VOICE_STATE_LABELS.speaking, /播放/);
assert.ok(VOICE_TURN_TIMEOUT_MS <= 180_000);
assert.equal(voiceBlocksComposer(VOICE_STATES.requesting), true);
assert.equal(voiceBlocksComposer(VOICE_STATES.recording), true);
assert.equal(voiceBlocksComposer(VOICE_STATES.uploading), true);
assert.equal(
  voiceBlocksComposer(VOICE_STATES.thinking),
  false,
  "remote analysis must not lock text chat",
);
assert.equal(
  normalizeVoicePlaybackMode("expressive"),
  VOICE_PLAYBACK_MODES.expressive,
);
assert.equal(normalizeVoicePlaybackMode("system"), VOICE_PLAYBACK_MODES.off);
assert.equal(normalizeVoicePlaybackMode("unknown"), VOICE_PLAYBACK_MODES.off);

const voiceSource = fs.readFileSync(
  new URL("../src/voice.js", import.meta.url),
  "utf8",
);
const appSource = fs.readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);
const packageSource = fs.readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  `${voiceSource}\n${appSource}\n${packageSource}`,
  /speechSynthesis|SpeechSynthesisUtterance|TextToSpeech|capacitor-community\/text-to-speech/,
  "device and browser system reading paths must stay removed",
);
assert.match(
  appSource,
  /取消语音处理/,
  "a pending voice request must always have a visible escape hatch",
);
assert.match(
  appSource,
  /\/voice\/warmup/,
  "voice service should be warmed in the background before recording",
);

let expressiveRequest;
const expressiveSpeech = await requestExpressiveSpeech("65", {
  sessionId: "11111111-1111-4111-8111-111111111111",
  speechToken: "v1.1784854800.test-speech-token",
  async fetchImpl(url, options) {
    expressiveRequest = { url, options };
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name === "X-DengTa-Voice-Provider") return "minimax";
          if (name === "X-DengTa-Voice-Emotion") return "happy";
          return null;
        },
      },
      async blob() {
        return new Blob(["audio"], { type: "audio/mpeg" });
      },
    };
  },
});
assert.match(expressiveRequest.url, /\/voice\/speech$/);
assert.deepEqual(JSON.parse(expressiveRequest.options.body), {
  message_id: "65",
  session_id: "11111111-1111-4111-8111-111111111111",
  speech_token: "v1.1784854800.test-speech-token",
});
assert.equal(expressiveSpeech.provider, "minimax");
assert.equal(expressiveSpeech.emotion, "happy");
assert.equal(expressiveSpeech.blob.type, "audio/mpeg");

let missingCredentialFetches = 0;
await assert.rejects(
  () =>
    requestExpressiveSpeech("65", {
      async fetchImpl() {
        missingCredentialFetches += 1;
      },
    }),
  /凭据已失效/,
);
assert.equal(missingCredentialFetches, 0);

console.log("voice helper tests passed");

{
    const { voiceShouldAbortAfterPermission } = await import("../src/voice.js");
    assert.equal(voiceShouldAbortAfterPermission(false), true);
    assert.equal(voiceShouldAbortAfterPermission(undefined), true);
    assert.equal(voiceShouldAbortAfterPermission(true), false);
}

// Stopping speech during the network fetch must prevent playback, not pause
// the previous (or a later) audio object.
{
  const originalFetch = globalThis.fetch;
  const originalAudio = globalThis.Audio;
  const originalURL = globalThis.URL;
  let played = 0;
  globalThis.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      ok: true,
      headers: { get: () => null },
      blob: async () => new Blob(["audio"]),
    };
  };
  globalThis.Audio = class {
    constructor() { this.paused = true; }
    play() { played += 1; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    set src(_value) {}
  };
  globalThis.URL.createObjectURL = () => "blob:fixture";
  globalThis.URL.revokeObjectURL = () => {};
  try {
    const pending = speakVoiceText("测试", {
      mode: VOICE_PLAYBACK_MODES.expressive,
      messageId: "m1",
      sessionId: "s1",
      speechToken: "t1",
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await stopVoiceSpeech();
    await pending;
    assert.equal(played, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Audio = originalAudio;
    globalThis.URL = originalURL;
  }
}

console.log("voice helper tests passed");

// The voice upload preflight must re-check the capture run after every await,
// otherwise cancelling during settings refresh still uploads the recording.
{
  const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(appSource, /const submitRun = voiceCaptureRunRef\.current;/);
  assert.match(appSource, /if \(cancelled\(\)\) return;/);
}

// Aborting while the audio body is downloading must surface the stable
// speech_cancelled code instead of a raw AbortError.
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    blob: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  try {
    await assert.rejects(
      requestExpressiveSpeech("m1", { sessionId: "s1", speechToken: "t1" }),
      (error) => error.code === "speech_cancelled",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}


// Aborting before authSession resolves must never open/send the request.
{
  class FakeXHR {
    constructor() {
      this.opened = false; this.sent = false; this.aborted = false;
      this.upload = { addEventListener() {} };
    }
    addEventListener() {}
    open() { this.opened = true; }
    setRequestHeader() {}
    send() { this.sent = true; }
    abort() { this.aborted = true; }
  }
  const fake = new FakeXHR();
  const request = createVoiceTurnRequest({}, {
    XMLHttpRequestImpl: class { constructor() { return fake; } },
    authSession: { getRequestContext: () => new Promise((resolve) => setTimeout(() => resolve({}), 40)) },
  });
  const caught = request.promise.catch((error) => error);
  request.abort();
  request.abort();
  const error = await caught;
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(error.name, "AbortError");
  assert.equal(fake.opened, false, "aborted request must not open XHR");
  assert.equal(fake.sent, false, "aborted request must not upload audio");
}
// HTTP failures must preserve status/code/retry metadata for the retry UI.
{
  class FakeXHR {
    constructor() {
      this.listeners = new Map();
      this.upload = { addEventListener() {} };
      this.status = 409;
      this.response = {
        message: "这条语音正在处理中，请稍后刷新。",
        code: "VOICE_TURN_IN_PROGRESS",
        retry_after_seconds: 7,
      };
      this.responseText = JSON.stringify(this.response);
    }
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() {}
    getResponseHeader(name) {
      return String(name).toLowerCase() === "retry-after" ? "7" : null;
    }
    dispatch(type) {
      this.listeners.get(type)?.();
    }
  }
  const fake = new FakeXHR();
  const request = createVoiceTurnRequest({}, {
    XMLHttpRequestImpl: class {
      constructor() {
        return fake;
      }
    },
    authSession: { getRequestContext: () => Promise.resolve({}) },
  });
  const caught = request.promise.catch((error) => error);
  await new Promise((resolve) => setTimeout(resolve, 10));
  fake.dispatch("load");
  const error = await caught;
  assert.equal(error.status, 409);
  assert.equal(error.code, "VOICE_TURN_IN_PROGRESS");
  assert.equal(error.retryAfterSeconds, 7);
  assert.match(error.message, /正在处理中/);
}
console.log("Voice upload cancellation tests passed");


const voiceAppSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
assert.match(
  voiceAppSource,
  /const \[voiceRetryAvailable, setVoiceRetryAvailable\] = useState\(false\)/,
);
assert.match(
  voiceAppSource,
  /const lastVoiceAttemptRef = useRef\(null\)/,
);
assert.match(voiceAppSource, /options\.sessionId/);
assert.match(
  voiceAppSource,
  /lastVoiceAttemptRef\.current = \{ blob, durationMs, clientMessageId \};/,
);
assert.match(
  voiceAppSource,
  /lastVoiceAttemptRef\.current\.sessionId = sessionId;/,
);
assert.match(voiceAppSource, /sessionId: attempt\.sessionId/);
assert.match(voiceAppSource, /voiceRetryWaitSeconds/);
assert.match(voiceAppSource, /voiceRetryInFlight/);
assert.match(voiceAppSource, /秒后可重试/);
assert.match(voiceAppSource, /retryAfterSeconds/);
assert.match(voiceAppSource, /lastVoiceAttemptRef/);
assert.match(voiceAppSource, /voiceRetryAvailable/);
assert.match(voiceAppSource, /retryVoiceTurn/);
assert.match(voiceAppSource, /function submitVoiceBlob\(blob, durationMs, options = \{\}\)/);
assert.match(voiceAppSource, /function cancelVoicePointer\(event\)/);
assert.match(voiceAppSource, /onPointerCancel=\{cancelVoicePointer\}/);
assert.match(voiceAppSource, /cancelVoiceCapture\(\{ message: "已取消这次录音。" \}\)/);
assert.doesNotMatch(voiceAppSource, /onPointerCancel=\{endVoiceCapture\}/);
console.log("Voice pointer-cancel semantics test passed");
