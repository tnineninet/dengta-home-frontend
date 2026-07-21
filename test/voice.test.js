import assert from "node:assert/strict";
import {
  VOICE_MAX_DURATION_MS,
  VOICE_MIN_DURATION_MS,
  VOICE_STATES,
  VOICE_STATE_LABELS,
  buildVoiceTurnFormData,
  formatVoiceConfidence,
  localizeVoiceEmotion,
  normalizeVoiceAnalysis,
  selectRecorderMimeType,
  validateVoiceDuration,
  voiceCaptureErrorMessage,
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

const formData = buildVoiceTurnFormData({
  blob: new Blob(["voice"], { type: "audio/webm" }),
  sessionId: "session-id",
  clientTime: "2026/7/21 20:00:00",
  timezone: "Asia/Shanghai",
  model: "gpt-5.5",
  emotionUnderstandingEnabled: true,
  companionStatus: { mood: "安心" },
  timestamp: 123,
});
assert.equal(formData.get("session_id"), "session-id");
assert.equal(formData.get("timezone"), "Asia/Shanghai");
assert.equal(formData.get("model"), "gpt-5.5");
assert.equal(formData.get("emotion_understanding_enabled"), "true");
assert.deepEqual(JSON.parse(formData.get("companion_status")), {
  mood: "安心",
});
assert.equal(formData.get("file").name, "dengta-voice-123.webm");
assert.equal(formData.get("file").type, "audio/webm");

assert.equal(VOICE_STATES.recording, "recording");
assert.match(VOICE_STATE_LABELS.recording, /松开发送/);
assert.match(VOICE_STATE_LABELS.speaking, /朗读/);

console.log("voice helper tests passed");
