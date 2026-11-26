import { Capacitor } from "@capacitor/core";
import {
  ScreenGlance,
  screenCaptureMatchesIdentity,
  screenGlanceCaptureToFile,
  screenGlancePluginAvailable,
} from "./screen-glance.js";
import { selectRecorderMimeType } from "./voice.js";

export const LIVE_PERCEPTION_STORAGE_PREFIX = "dengta:live-perception:v1:";
export const ACTIVITY_LIVE_POLL_MS = 25_000;
export const VAD_SPEECH_RMS_THRESHOLD = 0.032;
export const VAD_SPEECH_START_HOLD_MS = 240;
export const VAD_SILENCE_STOP_MS = 1350;
export const VAD_MIN_CLIP_MS = 700;
export const VAD_MAX_CLIP_MS = 25_000;

export const DEFAULT_LIVE_PERCEPTION_PREFS = Object.freeze({
  screenAlwaysOn: false,
  activityAlwaysOn: false,
  cameraAlwaysOn: false,
  cameraFacing: "user",
  micAlwaysOn: false,
  micAutoSend: false,
  micMode: "auto",
});

export function normalizeLivePerceptionPrefs(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const micMode =
    source.micMode === "vad-voice" || source.micMode === "speech-text"
      ? source.micMode
      : "auto";
  return Object.freeze({
    screenAlwaysOn: source.screenAlwaysOn === true,
    activityAlwaysOn: source.activityAlwaysOn === true,
    cameraAlwaysOn: source.cameraAlwaysOn === true,
    cameraFacing: source.cameraFacing === "environment" ? "environment" : "user",
    micAlwaysOn: source.micAlwaysOn === true,
    micAutoSend: source.micAutoSend === true,
    micMode,
  });
}

export function livePerceptionStorageKey(scope = "default") {
  const safe = String(scope || "default").trim() || "default";
  return `${LIVE_PERCEPTION_STORAGE_PREFIX}${safe}`;
}

export function readLivePerceptionPrefs(
  scope = "default",
  storage = globalThis.localStorage,
) {
  if (!storage || typeof storage.getItem !== "function") {
    return DEFAULT_LIVE_PERCEPTION_PREFS;
  }
  try {
    const raw = storage.getItem(livePerceptionStorageKey(scope));
    if (!raw) return DEFAULT_LIVE_PERCEPTION_PREFS;
    return normalizeLivePerceptionPrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_LIVE_PERCEPTION_PREFS;
  }
}

export function writeLivePerceptionPrefs(
  scope = "default",
  prefs = {},
  storage = globalThis.localStorage,
) {
  const normalized = normalizeLivePerceptionPrefs(prefs);
  if (!storage || typeof storage.setItem !== "function") return normalized;
  try {
    storage.setItem(livePerceptionStorageKey(scope), JSON.stringify(normalized));
  } catch {
    // Storage quota or private mode; in-memory state remains authoritative.
  }
  return normalized;
}

export async function queryMediaPermissionState(name, env = globalThis) {
  if (!env?.navigator?.permissions?.query) return "unknown";
  try {
    const result = await env.navigator.permissions.query({ name });
    const state = String(result?.state || "");
    if (["granted", "prompt", "denied"].includes(state)) return state;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function isCameraSupported(env = globalThis) {
  return Boolean(env?.navigator?.mediaDevices?.getUserMedia);
}

export function isDisplayCaptureSupported(env = globalThis, capacitor = Capacitor) {
  if (screenGlancePluginAvailable(capacitor)) return true;
  return Boolean(env?.navigator?.mediaDevices?.getDisplayMedia);
}

export function getSpeechRecognitionCtor(env = globalThis) {
  return env?.SpeechRecognition || env?.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(env = globalThis) {
  return Boolean(getSpeechRecognitionCtor(env));
}

export function isVadRecordingSupported(env = globalThis) {
  return Boolean(
    env?.navigator?.mediaDevices?.getUserMedia &&
      env?.MediaRecorder &&
      (env?.AudioContext || env?.webkitAudioContext),
  );
}

export function isMicSupported(env = globalThis) {
  return Boolean(
    getSpeechRecognitionCtor(env) || env?.navigator?.mediaDevices?.getUserMedia,
  );
}

export function computeTimeDomainRms(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const centered = (samples[i] - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Client-side Voice Activity Detector (Web Audio AnalyserNode + MediaRecorder).
 * Works on China-ROM Android WebViews without Google Speech Services as well
 * as desktop browsers, streaming hands-free utterances directly into HerVoice.
 */
export function createVoiceActivityMonitor(
  stream,
  {
    onSpeechStart,
    onSpeechEnd,
    onLevel,
    shouldIgnore = () => false,
    threshold = VAD_SPEECH_RMS_THRESHOLD,
    startHoldMs = VAD_SPEECH_START_HOLD_MS,
    silenceStopMs = VAD_SILENCE_STOP_MS,
    minClipMs = VAD_MIN_CLIP_MS,
    maxClipMs = VAD_MAX_CLIP_MS,
  } = {},
) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx || !globalThis.MediaRecorder || !stream) {
    return { stop() {} };
  }

  let closed = false;
  let audioCtx = null;
  let analyser = null;
  let source = null;
  let recorder = null;
  let chunks = [];
  let speechDetectedSince = 0;
  let recordingStartedAt = 0;
  let lastVoiceAt = 0;
  let timer = null;

  try {
    audioCtx = new AudioCtx();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
  } catch {
    return { stop() {} };
  }

  const samples = new Uint8Array(analyser.fftSize);
  const mimeType = selectRecorderMimeType();

  function finishRecording(deliver) {
    const active = recorder;
    recorder = null;
    const started = recordingStartedAt;
    recordingStartedAt = 0;
    speechDetectedSince = 0;
    lastVoiceAt = 0;
    if (!active) return;
    if (!deliver) {
      active.ondataavailable = null;
      active.onstop = null;
      try {
        if (active.state !== "inactive") active.stop();
      } catch {
        // Ignore.
      }
      chunks = [];
      return;
    }
    active.onstop = () => {
      const durationMs = Math.max(0, Date.now() - started);
      const recordedChunks = chunks;
      chunks = [];
      if (closed || durationMs < minClipMs || recordedChunks.length === 0) return;
      const blob = new Blob(recordedChunks, {
        type: active.mimeType || mimeType || "audio/webm",
      });
      if (blob.size > 0) {
        onSpeechEnd?.(blob, durationMs);
      }
    };
    try {
      if (active.state !== "inactive") active.stop();
    } catch {
      chunks = [];
    }
  }

  function startRecording(now) {
    if (recorder || closed) return;
    chunks = [];
    try {
      recorder = mimeType
        ? new globalThis.MediaRecorder(stream, { mimeType })
        : new globalThis.MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recordingStartedAt = now;
      lastVoiceAt = now;
      recorder.start(200);
      onSpeechStart?.();
    } catch {
      recorder = null;
      recordingStartedAt = 0;
    }
  }

  timer = globalThis.setInterval(() => {
    if (closed || !analyser) return;
    if (audioCtx?.state === "suspended") {
      void audioCtx.resume().catch(() => {});
    }
    if (shouldIgnore()) {
      speechDetectedSince = 0;
      if (recorder) finishRecording(false);
      onLevel?.(0);
      return;
    }
    analyser.getByteTimeDomainData(samples);
    const rms = computeTimeDomainRms(samples);
    onLevel?.(Math.min(1, rms / 0.14));
    const now = Date.now();
    const isLoud = rms >= threshold;

    if (!recorder) {
      if (isLoud) {
        if (!speechDetectedSince) speechDetectedSince = now;
        if (now - speechDetectedSince >= startHoldMs) {
          startRecording(now);
        }
      } else {
        speechDetectedSince = 0;
      }
    } else {
      if (isLoud) {
        lastVoiceAt = now;
      }
      const elapsed = now - recordingStartedAt;
      const silentFor = now - lastVoiceAt;
      if (silentFor >= silenceStopMs || elapsed >= maxClipMs) {
        finishRecording(true);
      }
    }
  }, 80);

  return {
    stop() {
      if (closed) return;
      closed = true;
      if (timer) {
        globalThis.clearInterval(timer);
        timer = null;
      }
      finishRecording(false);
      try {
        source?.disconnect();
      } catch {
        // Ignore.
      }
      try {
        void audioCtx?.close?.();
      } catch {
        // Ignore.
      }
      onLevel?.(0);
    },
  };
}

export async function captureVideoElementFrame(
  video,
  { prefix = "dengta-live-frame", maxEdge = 800, quality = 0.8 } = {},
) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob || blob.size === 0) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return new File([blob], `${prefix}-${stamp}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export async function captureNativeScreenGlanceFile({
  capacitor = Capacitor,
  plugin = ScreenGlance,
  accountScope = "",
  companionScope = "",
} = {}) {
  if (!screenGlancePluginAvailable(capacitor)) return null;
  try {
    let capture = null;
    if (typeof plugin.captureSnapshotNow === "function") {
      capture = await plugin.captureSnapshotNow();
    } else if (
      typeof plugin.captureNow === "function" &&
      typeof plugin.consumeLatestCapture === "function"
    ) {
      await plugin.captureNow();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 130));
        const polled = await plugin.consumeLatestCapture();
        if (polled?.available === true && polled.base64) {
          capture = polled;
          break;
        }
      }
    }
    if (!capture || capture.available !== true || !capture.base64) return null;
    if (
      (accountScope || companionScope) &&
      capture.scopeKey &&
      !screenCaptureMatchesIdentity(capture, { accountScope, companionScope })
    ) {
      return null;
    }
    return screenGlanceCaptureToFile(capture);
  } catch {
    return null;
  }
}

export function buildLivePerceptionEnvironmentPayload({
  screenActive = false,
  cameraActive = false,
  cameraFacing = "user",
  micActive = false,
  activityActive = false,
  capturedSources = [],
  platform = Capacitor.isNativePlatform() ? "android" : "web",
} = {}) {
  const safeSources = Array.isArray(capturedSources)
    ? capturedSources
        .map((item) => String(item || "").trim())
        .filter((item) => ["screen", "camera"].includes(item))
    : [];
  const anyActive = Boolean(
    screenActive || cameraActive || micActive || activityActive || safeSources.length,
  );
  if (!anyActive) return null;
  return {
    screen_active: screenActive === true,
    camera_active: cameraActive === true,
    camera_facing: cameraFacing === "environment" ? "environment" : "user",
    mic_active: micActive === true,
    activity_active: activityActive === true,
    captured_sources: safeSources,
    platform: platform === "android" ? "android" : "web",
  };
}

export function mergeLivePerceptionContext(environmentContext, livePerception) {
  const source =
    environmentContext &&
    typeof environmentContext === "object" &&
    !Array.isArray(environmentContext)
      ? environmentContext
      : {};
  const next = { ...source };
  delete next.live_perception;
  delete next.livePerception;
  return livePerception ? { ...next, live_perception: livePerception } : next;
}

export function formatLivePerceptionTurnHint(capturedSources = []) {
  const hasScreen = capturedSources.includes("screen");
  const hasCamera = capturedSources.includes("camera");
  if (!hasScreen && !hasCamera) return "";
  if (hasScreen && hasCamera) {
    return "【实时视觉现场】用户开启了全程屏幕感知与实时摄像头，本轮附带了此刻的屏幕画面与镜头画面；请像就在身边一样自然观察并回应，不要机械复述系统提示。";
  }
  if (hasScreen) {
    return "【实时屏幕现场】用户开启了全程屏幕感知，本轮附带了此刻的屏幕画面；请结合用户正在看/做的内容自然陪伴回应，不要机械复述系统提示。";
  }
  return "【实时镜头现场】用户开启了全程摄像头感知，本轮附带了此刻的摄像头画面；请自然关注用户当下的状态与环境，不要机械复述系统提示。";
}
