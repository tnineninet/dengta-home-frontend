import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import {
  Activity,
  Camera,
  Eye,
  EyeOff,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  Pause,
  Play,
  Power,
  RefreshCw,
  Sparkles,
  SwitchCamera,
} from "lucide-react";
import {
  ACTIVITY_LIVE_POLL_MS,
  buildLivePerceptionEnvironmentPayload,
  captureNativeScreenGlanceFile,
  captureVideoElementFrame,
  createVoiceActivityMonitor,
  getSpeechRecognitionCtor,
  isCameraSupported,
  isDisplayCaptureSupported,
  isMicSupported,
  isSpeechRecognitionSupported,
  isVadRecordingSupported,
  queryMediaPermissionState,
  readLivePerceptionPrefs,
  requestNativeMediaPermissions,
  writeLivePerceptionPrefs,
} from "./live-perception.js";
import {
  computeLumaChangePercent,
  createThumbnailDataUrlFromFile,
  extractLumaSignature,
  extractLumaSignatureFromFile,
  formatEvidenceTimeLabel,
  getRecentScreenEvidence,
  registerScreenEvidence,
  serializeEvidenceForPayload,
  shouldTriggerAutoScreenCapture,
  subscribeScreenEvidence,
} from "./screen-change-monitor.js";
import { parseWakeWordTranscript, playWakeChime } from "./voice-wake-word.js";
import "./live-perception.css";

function stopMediaStream(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Track may already be ended.
  }
}

export default function LivePerceptionBar({
  scope = "default",
  accountScope = "",
  companionScope = "",
  aiName = "灯塔",
  activeView = "chat",
  chatPortalTarget = null,
  starDrawerPortalTarget = null,
  keyboardOpen = false,
  screenGlanceState = {},
  deviceActivityState = {},
  currentAppName = "",
  isAiSpeaking = false,
  isVoiceBusy = false,
  isSending = false,
  onRegisterController = null,
  onBackToChat,
  onStartNativeScreen,
  onStopNativeScreen,
  onPauseNativeScreen,
  onEnableNativeActivity,
  onOpenActivityPermission,
  onRefreshActivity,
  onSnapFile,
  onCameraAskChat,
  onTranscript,
  onVoiceTurnBlob,
  onNotice,
  onSensorsChange,
}) {
  const isNative = Capacitor.isNativePlatform();
  const [prefs, setPrefs] = useState(() => readLivePerceptionPrefs(scope));
  const [cameraLive, setCameraLive] = useState(false);
  const [cameraPreviewOpen, setCameraPreviewOpen] = useState(true);
  const [webScreenLive, setWebScreenLive] = useState(false);
  const [webScreenPaused, setWebScreenPaused] = useState(false);
  const [micLive, setMicLive] = useState(false);
  const [micEngine, setMicEngine] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [micInterim, setMicInterim] = useState("");
  const [siriAwake, setSiriAwake] = useState(false);
  const [sensorBusy, setSensorBusy] = useState("");
  const [sensorError, setSensorError] = useState("");
  const [screenEvidenceList, setScreenEvidenceList] = useState(() =>
    getRecentScreenEvidence(),
  );

  const prefsRef = useRef(prefs);
  const aiNameRef = useRef(aiName);
  const currentAppNameRef = useRef(currentAppName);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const recognitionRef = useRef(null);
  const micStreamRef = useRef(null);
  const vadMonitorRef = useRef(null);
  const micRestartTimerRef = useRef(null);
  const siriWakeTimerRef = useRef(null);
  const siriAwakeRef = useRef(false);
  const manualStopCameraRef = useRef(false);
  const manualStopMicRef = useRef(false);
  const cameraSuspendedByBgRef = useRef(false);
  const micSuspendedByBgRef = useRef(false);
  const lastScreenLumaRef = useRef(null);
  const lastScreenAppRef = useRef("");
  const lastAutoCaptureAtRef = useRef(0);
  const lastSentEvidenceIdRef = useRef("");
  const latestPendingEvidenceRef = useRef(null);
  const isAiSpeakingRef = useRef(isAiSpeaking);
  const isVoiceBusyRef = useRef(isVoiceBusy);
  const isSendingRef = useRef(isSending);
  const mountedRef = useRef(true);
  const autoResumedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = subscribeScreenEvidence((list) => {
      if (mountedRef.current) setScreenEvidenceList(list);
    });
    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking;
    isVoiceBusyRef.current = isVoiceBusy;
    isSendingRef.current = isSending;
    aiNameRef.current = aiName || "灯塔";
    currentAppNameRef.current = currentAppName || "";
  }, [aiName, currentAppName, isAiSpeaking, isSending, isVoiceBusy]);

  const updatePrefs = useCallback(
    (patch) => {
      const next = writeLivePerceptionPrefs(scope, {
        ...prefsRef.current,
        ...patch,
      });
      prefsRef.current = next;
      setPrefs(next);
      return next;
    },
    [scope],
  );

  const armSiriWakeWindow = useCallback((durationMs = 10_000) => {
    if (siriWakeTimerRef.current) window.clearTimeout(siriWakeTimerRef.current);
    siriAwakeRef.current = true;
    setSiriAwake(true);
    siriWakeTimerRef.current = window.setTimeout(() => {
      siriAwakeRef.current = false;
      if (mountedRef.current) setSiriAwake(false);
    }, durationMs);
  }, []);

  const clearSiriWakeWindow = useCallback(() => {
    if (siriWakeTimerRef.current) {
      window.clearTimeout(siriWakeTimerRef.current);
      siriWakeTimerRef.current = null;
    }
    siriAwakeRef.current = false;
    if (mountedRef.current) setSiriAwake(false);
  }, []);

  const attachCameraStream = useCallback((stream) => {
    const video = cameraVideoRef.current;
    if (!video) return;
    video.srcObject = stream || null;
    if (stream) {
      void video.play().catch(() => {});
    }
  }, []);

  const stopCamera = useCallback(
    ({ manual = false } = {}) => {
      if (manual) manualStopCameraRef.current = true;
      stopMediaStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
      attachCameraStream(null);
      setCameraLive(false);
    },
    [attachCameraStream],
  );

  const startCamera = useCallback(
    async (facing = prefsRef.current.cameraFacing, { silent = false } = {}) => {
      if (!isCameraSupported()) {
        if (!silent) {
          const msg = "当前设备或浏览器不支持调用摄像头。";
          setSensorError(msg);
          onNotice?.(msg);
        }
        return false;
      }
      manualStopCameraRef.current = false;
      setSensorBusy("camera");
      setSensorError("");
      try {
        if (isNative && !silent) {
          const perm = await requestNativeMediaPermissions({ camera: true });
          if (perm && perm.cameraGranted === false) {
            const msg = "请在系统弹窗中允许「相机」权限，授权一次即可持久保持。";
            setSensorError(msg);
            onNotice?.(msg);
            return false;
          }
        }
        stopMediaStream(cameraStreamRef.current);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 960 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (!mountedRef.current) {
          stopMediaStream(stream);
          return false;
        }
        cameraStreamRef.current = stream;
        cameraSuspendedByBgRef.current = false;
        const track = stream.getVideoTracks()[0];
        if (track) {
          track.addEventListener(
            "ended",
            () => {
              if (!mountedRef.current) return;
              cameraStreamRef.current = null;
              setCameraLive(false);
              // Do NOT wipe cameraAlwaysOn when Android/OS suspends a background track!
              // Keep user's permanent preference so returning to DengTa auto-resumes.
              if (!manualStopCameraRef.current && prefsRef.current.cameraAlwaysOn) {
                cameraSuspendedByBgRef.current = true;
              }
            },
            { once: true },
          );
        }
        setCameraLive(true);
        setCameraPreviewOpen(true);
        window.requestAnimationFrame(() => attachCameraStream(stream));
        updatePrefs({ cameraAlwaysOn: true, cameraFacing: facing });
        return true;
      } catch (error) {
        const name = String(error?.name || "");
        const hiddenOrTransient =
          document.visibilityState === "hidden" || name === "AbortError" || name === "NotReadableError";
        if (hiddenOrTransient && prefsRef.current.cameraAlwaysOn) {
          cameraSuspendedByBgRef.current = true;
          return false;
        }
        if (!silent) {
          const msg =
            name === "NotAllowedError" || name === "SecurityError"
              ? "摄像头权限未允许，请在系统弹窗或手机设置里允许相机（只需授权一次）。"
              : name === "NotFoundError"
                ? "未检测到可用摄像头。"
                : `无法打开摄像头：${error?.message || "请重试"}`;
          setSensorError(msg);
          onNotice?.(msg);
        }
        if (name === "NotAllowedError" && !silent) {
          updatePrefs({ cameraAlwaysOn: false });
        }
        return false;
      } finally {
        if (mountedRef.current) setSensorBusy("");
      }
    },
    [attachCameraStream, isNative, onNotice, updatePrefs],
  );

  const toggleCamera = useCallback(async () => {
    if (cameraLive || prefsRef.current.cameraAlwaysOn) {
      stopCamera({ manual: true });
      cameraSuspendedByBgRef.current = false;
      updatePrefs({ cameraAlwaysOn: false });
      onNotice?.("已关闭实时摄像头感知。");
      return;
    }
    const ok = await startCamera(prefsRef.current.cameraFacing);
    if (ok) {
      onNotice?.(
        `摄像头已开启：${aiNameRef.current}现在能看到你和眼前画面，聊天时会主动提起看到的细节，切换应用回来也会自动保持开启。`,
      );
    }
  }, [cameraLive, onNotice, startCamera, stopCamera, updatePrefs]);

  const flipCamera = useCallback(async () => {
    const nextFacing = prefsRef.current.cameraFacing === "user" ? "environment" : "user";
    updatePrefs({ cameraFacing: nextFacing });
    if (cameraLive) {
      await startCamera(nextFacing);
    }
  }, [cameraLive, startCamera, updatePrefs]);

  const snapCameraNow = useCallback(
    async ({ askAiToComment = false } = {}) => {
      const file = await captureVideoElementFrame(cameraVideoRef.current, {
        prefix: "dengta-camera-snap",
      });
      if (!file) {
        onNotice?.("摄像头画面尚未就绪，请稍候再试。");
        return;
      }
      if (askAiToComment && typeof onCameraAskChat === "function") {
        const thumb = await createThumbnailDataUrlFromFile(file);
        const ev = registerScreenEvidence({
          id: `cam-${Date.now()}`,
          kind: "camera",
          captured_at: new Date().toISOString(),
          trigger_reason: "主动镜头分享",
          thumbnail_data_url: thumb,
          file,
        });
        await onCameraAskChat(file, ev);
        return;
      }
      await onSnapFile?.(file);
    },
    [onCameraAskChat, onNotice, onSnapFile],
  );

  const stopWebScreen = useCallback(() => {
    stopMediaStream(screenStreamRef.current);
    screenStreamRef.current = null;
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
    setWebScreenLive(false);
    setWebScreenPaused(false);
    lastScreenLumaRef.current = null;
  }, []);

  const startWebScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      onNotice?.("当前浏览器不支持网页屏幕共享。");
      return false;
    }
    setSensorBusy("screen");
    setSensorError("");
    try {
      stopWebScreen();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 6, max: 15 } },
        audio: false,
      });
      if (!mountedRef.current) {
        stopMediaStream(stream);
        return false;
      }
      screenStreamRef.current = stream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        void screenVideoRef.current.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.addEventListener(
          "ended",
          () => {
            if (!mountedRef.current) return;
            screenStreamRef.current = null;
            setWebScreenLive(false);
            setWebScreenPaused(false);
            updatePrefs({ screenAlwaysOn: false });
          },
          { once: true },
        );
      }
      setWebScreenLive(true);
      setWebScreenPaused(false);
      updatePrefs({ screenAlwaysOn: true });
      return true;
    } catch (error) {
      if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") {
        const msg = error?.message || "无法启动屏幕捕获。";
        setSensorError(msg);
        onNotice?.(msg);
      }
      updatePrefs({ screenAlwaysOn: false });
      return false;
    } finally {
      if (mountedRef.current) setSensorBusy("");
    }
  }, [onNotice, stopWebScreen, updatePrefs]);

  const nativeScreenActive = Boolean(isNative && screenGlanceState?.active);
  const nativeScreenPaused = Boolean(isNative && screenGlanceState?.active && screenGlanceState?.paused);
  const screenSessionRunning = isNative ? nativeScreenActive : webScreenLive;
  const screenPaused = isNative ? nativeScreenPaused : webScreenPaused;
  const screenLive = screenSessionRunning && !screenPaused;

  const toggleScreen = useCallback(async () => {
    if (isNative) {
      if (nativeScreenActive) {
        updatePrefs({ screenAlwaysOn: false });
        await onStopNativeScreen?.();
        return;
      }
      updatePrefs({ screenAlwaysOn: true, screenChangeWatch: true });
      await onStartNativeScreen?.();
      return;
    }
    if (webScreenLive) {
      stopWebScreen();
      updatePrefs({ screenAlwaysOn: false });
      onNotice?.("已停止实时屏幕共享。");
      return;
    }
    const ok = await startWebScreen();
    if (ok) {
      onNotice?.(
        "智能屏幕监测已开启：切屏或画面显著变化时自动截取理解，并在聊天中附带截屏时间与依据。",
      );
    }
  }, [
    isNative,
    nativeScreenActive,
    onNotice,
    onStartNativeScreen,
    onStopNativeScreen,
    startWebScreen,
    stopWebScreen,
    updatePrefs,
    webScreenLive,
  ]);

  const togglePauseScreen = useCallback(async () => {
    if (!screenSessionRunning) return;
    const nextPaused = !screenPaused;
    if (isNative) {
      await onPauseNativeScreen?.(nextPaused);
      onNotice?.(nextPaused ? "已暂停屏幕共享，随时可一键继续。" : "已恢复智能屏幕变化监测。");
      return;
    }
    setWebScreenPaused(nextPaused);
    onNotice?.(nextPaused ? "已暂停屏幕共享，随时可一键继续。" : "已恢复智能屏幕变化监测。");
  }, [isNative, onNotice, onPauseNativeScreen, screenPaused, screenSessionRunning]);

  const captureScreenEvidenceNow = useCallback(
    async ({ reason = "手动抓拍", changeScore = 100, appName = currentAppNameRef.current } = {}) => {
      if (!screenLive) return null;
      let file = null;
      if (isNative) {
        file = await captureNativeScreenGlanceFile({ accountScope, companionScope });
      } else if (screenVideoRef.current && screenStreamRef.current) {
        file = await captureVideoElementFrame(screenVideoRef.current, {
          prefix: "dengta-screen-evidence",
          maxEdge: 960,
          quality: 0.78,
        });
      }
      if (!file) return null;
      const thumb = await createThumbnailDataUrlFromFile(file);
      const nowIso = new Date().toISOString();
      const entry = registerScreenEvidence({
        id: `scr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "screen",
        captured_at: nowIso,
        time_label: formatEvidenceTimeLabel(nowIso),
        app_name: appName || "",
        trigger_reason: reason,
        change_score: changeScore,
        thumbnail_data_url: thumb,
        file,
      });
      latestPendingEvidenceRef.current = entry;
      lastAutoCaptureAtRef.current = Date.now();
      return entry;
    },
    [accountScope, companionScope, isNative, screenLive],
  );

  // Automatic Smart Screen Change Detection (App switch OR >= 18% visual delta with cooldown)
  useEffect(() => {
    if (!screenLive || !prefs.screenChangeWatch) return undefined;
    let busy = false;
    const checkScreenChange = async (forcedAppChanged = false) => {
      if (busy || !mountedRef.current || !screenLive) return;
      busy = true;
      try {
        const nowMs = Date.now();
        const elapsedMs = nowMs - lastAutoCaptureAtRef.current;
        const activeApp = currentAppNameRef.current || "";
        const appChanged =
          forcedAppChanged ||
          Boolean(activeApp && lastScreenAppRef.current && activeApp !== lastScreenAppRef.current);

        if (!isNative && screenVideoRef.current && screenStreamRef.current) {
          const luma = extractLumaSignature(screenVideoRef.current);
          if (!luma) return;
          const prev = lastScreenLumaRef.current;
          const changeScore = prev ? computeLumaChangePercent(prev, luma) : 100;
          if (
            shouldTriggerAutoScreenCapture({
              changeScore,
              appChanged,
              elapsedMs,
            })
          ) {
            lastScreenLumaRef.current = luma;
            if (activeApp) lastScreenAppRef.current = activeApp;
            await captureScreenEvidenceNow({
              reason: appChanged ? "切换应用画面" : prev ? "屏幕内容显著变化" : "开始屏幕监测",
              changeScore,
              appName: activeApp,
            });
          } else if (!prev) {
            lastScreenLumaRef.current = luma;
          }
        } else if (isNative) {
          // On native Android, only sample when app switched or cooldown passed while returning/active.
          if (!appChanged && elapsedMs < 15_000) return;
          const file = await captureNativeScreenGlanceFile({ accountScope, companionScope });
          if (!file || !mountedRef.current) return;
          const luma = await extractLumaSignatureFromFile(file);
          const prev = lastScreenLumaRef.current;
          const changeScore = luma && prev ? computeLumaChangePercent(prev, luma) : 100;
          if (
            shouldTriggerAutoScreenCapture({
              changeScore,
              appChanged,
              elapsedMs,
            })
          ) {
            if (luma) lastScreenLumaRef.current = luma;
            if (activeApp) lastScreenAppRef.current = activeApp;
            const thumb = await createThumbnailDataUrlFromFile(file);
            const nowIso = new Date().toISOString();
            const entry = registerScreenEvidence({
              id: `scr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: "screen",
              captured_at: nowIso,
              time_label: formatEvidenceTimeLabel(nowIso),
              app_name: activeApp,
              trigger_reason: appChanged ? "切换应用画面" : prev ? "屏幕内容显著变化" : "开始屏幕监测",
              change_score: changeScore,
              thumbnail_data_url: thumb,
              file,
            });
            latestPendingEvidenceRef.current = entry;
            lastAutoCaptureAtRef.current = Date.now();
          } else if (luma && !prev) {
            lastScreenLumaRef.current = luma;
          }
        }
      } finally {
        busy = false;
      }
    };

    const intervalMs = isNative ? 10_000 : 4_000;
    const timer = window.setInterval(() => {
      void checkScreenChange(false);
    }, intervalMs);
    if (currentAppName && currentAppName !== lastScreenAppRef.current) {
      void checkScreenChange(Boolean(lastScreenAppRef.current));
      lastScreenAppRef.current = currentAppName;
    }
    return () => {
      window.clearInterval(timer);
    };
  }, [
    accountScope,
    captureScreenEvidenceNow,
    companionScope,
    currentAppName,
    isNative,
    prefs.screenChangeWatch,
    screenLive,
  ]);

  const activityLive = isNative
    ? Boolean(
        deviceActivityState?.enabled &&
          deviceActivityState?.permissionGranted &&
          prefs.activityAlwaysOn !== false,
      )
    : prefs.activityAlwaysOn === true;

  const toggleActivity = useCallback(async () => {
    if (isNative) {
      if (!deviceActivityState?.permissionGranted) {
        updatePrefs({ activityAlwaysOn: true });
        await onEnableNativeActivity?.(true);
        await onOpenActivityPermission?.();
        return;
      }
      const nextOn = !deviceActivityState?.enabled;
      updatePrefs({ activityAlwaysOn: nextOn });
      await onEnableNativeActivity?.(nextOn);
      if (nextOn) {
        await onRefreshActivity?.({ force: true, silent: false });
      }
      return;
    }
    const nextOn = !prefsRef.current.activityAlwaysOn;
    updatePrefs({ activityAlwaysOn: nextOn });
    onNotice?.(
      nextOn
        ? "已开启应用感知（Android App 安装后一次授权永久有效，自动识别当前使用的 App）。"
        : "已关闭应用感知。",
    );
  }, [
    deviceActivityState?.enabled,
    deviceActivityState?.permissionGranted,
    isNative,
    onEnableNativeActivity,
    onNotice,
    onOpenActivityPermission,
    onRefreshActivity,
    updatePrefs,
  ]);

  const stopMic = useCallback(
    ({ manual = false } = {}) => {
      if (manual) manualStopMicRef.current = true;
      clearSiriWakeWindow();
      if (micRestartTimerRef.current) {
        window.clearTimeout(micRestartTimerRef.current);
        micRestartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.stop();
        } catch {
          // Ignore already-stopped recognition instance.
        }
        recognitionRef.current = null;
      }
      if (vadMonitorRef.current) {
        vadMonitorRef.current.stop();
        vadMonitorRef.current = null;
      }
      stopMediaStream(micStreamRef.current);
      micStreamRef.current = null;
      setMicLive(false);
      setMicEngine("");
      setMicLevel(0);
      setMicInterim("");
    },
    [clearSiriWakeWindow],
  );

  const startVadMicStream = useCallback(
    async ({ silent = false } = {}) => {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!mountedRef.current) {
        stopMediaStream(stream);
        return false;
      }
      micStreamRef.current = stream;
      micSuspendedByBgRef.current = false;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.addEventListener(
          "ended",
          () => {
            if (!mountedRef.current) return;
            micStreamRef.current = null;
            setMicLive(false);
            if (!manualStopMicRef.current && prefsRef.current.micAlwaysOn) {
              micSuspendedByBgRef.current = true;
            }
          },
          { once: true },
        );
      }
      if (isVadRecordingSupported() && typeof onVoiceTurnBlob === "function") {
        vadMonitorRef.current = createVoiceActivityMonitor(stream, {
          shouldIgnore: () =>
            isAiSpeakingRef.current || isSendingRef.current || isVoiceBusyRef.current,
          onLevel: (lvl) => {
            if (mountedRef.current) setMicLevel(lvl);
          },
          onSpeechStart: () => {
            if (mountedRef.current) setMicInterim("正在听你说话…");
          },
          onSpeechEnd: (blob, durationMs) => {
            if (!mountedRef.current) return;
            setMicInterim("");
            void onVoiceTurnBlob(blob, durationMs);
          },
        });
        setMicEngine("vad");
        setMicLive(true);
        updatePrefs({ micAlwaysOn: true });
        if (!silent) {
          onNotice?.(
            "语音直听已开启：像 Siri 一样直接喊“灯塔”或开口说话，说完自动识别并回复；切换应用回来自动恢复。",
          );
        }
        return true;
      }
      setMicEngine("warm");
      setMicLive(true);
      updatePrefs({ micAlwaysOn: true });
      if (!silent) {
        onNotice?.("麦克风已常驻就绪，随时轻按语音键即可说话。");
      }
      return true;
    },
    [onNotice, onVoiceTurnBlob, updatePrefs],
  );

  const startMic = useCallback(
    async ({ silent = false } = {}) => {
      if (!isMicSupported()) {
        if (!silent) {
          const msg = "当前环境不支持持续麦克风语音感知。";
          setSensorError(msg);
          onNotice?.(msg);
        }
        return false;
      }
      manualStopMicRef.current = false;
      setSensorBusy("mic");
      setSensorError("");
      try {
        if (isNative && !silent) {
          const perm = await requestNativeMediaPermissions({ microphone: true });
          if (perm && perm.microphoneGranted === false) {
            const msg = "请在系统弹窗中允许「麦克风」权限，授权一次即可持久保持。";
            setSensorError(msg);
            onNotice?.(msg);
            return false;
          }
        }
        stopMic();
        const preferVad = prefsRef.current.micMode === "vad-voice";
        const SpeechCtor = !preferVad ? getSpeechRecognitionCtor() : null;
        if (SpeechCtor) {
          const recognition = new SpeechCtor();
          recognition.lang = "zh-CN";
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.maxAlternatives = 1;
          recognition.onresult = (event) => {
            if (!mountedRef.current || isAiSpeakingRef.current) return;
            let interim = "";
            const finals = [];
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
              const res = event.results[i];
              const transcript = String(res?.[0]?.transcript || "").trim();
              if (!transcript) continue;
              if (res.isFinal) finals.push(transcript);
              else interim += transcript;
            }
            if (prefsRef.current.micWakeWord && !siriAwakeRef.current) {
              const interimHit = parseWakeWordTranscript(interim, {
                aiName: aiNameRef.current,
              });
              if (interimHit.matched) {
                playWakeChime();
                armSiriWakeWindow(10_000);
              }
              setMicInterim(siriAwakeRef.current ? interim : "");
            } else {
              setMicInterim(interim);
            }

            if (finals.length > 0) {
              const combined = finals.join(" ").trim();
              if (!combined) return;
              setMicInterim("");
              if (prefsRef.current.micWakeWord) {
                const parsed = parseWakeWordTranscript(combined, {
                  aiName: aiNameRef.current,
                });
                if (parsed.matched) {
                  playWakeChime();
                  if (parsed.command) {
                    clearSiriWakeWindow();
                    onTranscript?.(parsed.command, {
                      autoSend: prefsRef.current.micAutoSend && !isSendingRef.current,
                      wakeWordTriggered: true,
                    });
                  } else {
                    armSiriWakeWindow(10_000);
                    onNotice?.(`我在听，请直接说出想对${aiNameRef.current}说的话…`);
                  }
                  return;
                }
                if (siriAwakeRef.current) {
                  clearSiriWakeWindow();
                  onTranscript?.(combined, {
                    autoSend: prefsRef.current.micAutoSend && !isSendingRef.current,
                    wakeWordTriggered: true,
                  });
                }
                return;
              }
              onTranscript?.(combined, {
                autoSend: prefsRef.current.micAutoSend && !isSendingRef.current,
                wakeWordTriggered: false,
              });
            }
          };
          recognition.onerror = (event) => {
            const code = String(event?.error || "");
            if (code === "not-allowed") {
              if (document.visibilityState === "hidden" && prefsRef.current.micAlwaysOn) {
                micSuspendedByBgRef.current = true;
                stopMic();
                return;
              }
              setSensorError("麦克风权限未允许，请在手机应用权限中开启麦克风（只需授权一次）。");
              stopMic({ manual: true });
              updatePrefs({ micAlwaysOn: false });
              return;
            }
            if (
              code === "service-not-allowed" ||
              code === "network" ||
              code === "audio-capture"
            ) {
              stopMic();
              void startVadMicStream({ silent: true }).catch(() => {
                if (mountedRef.current) {
                  micSuspendedByBgRef.current = true;
                }
              });
            }
          };
          recognition.onend = () => {
            if (!mountedRef.current) return;
            if (
              !manualStopMicRef.current &&
              prefsRef.current.micAlwaysOn &&
              recognitionRef.current === recognition
            ) {
              if (document.visibilityState === "hidden") {
                micSuspendedByBgRef.current = true;
                setMicLive(false);
                return;
              }
              micRestartTimerRef.current = window.setTimeout(() => {
                if (!mountedRef.current || !prefsRef.current.micAlwaysOn) return;
                if (isAiSpeakingRef.current) return;
                try {
                  recognition.start();
                } catch {
                  // Already started or suspended by OS.
                }
              }, 350);
            }
          };
          recognitionRef.current = recognition;
          recognition.start();
          micSuspendedByBgRef.current = false;
          setMicEngine("speech");
          setMicLive(true);
          updatePrefs({ micAlwaysOn: true });
          if (!silent) {
            onNotice?.(
              prefsRef.current.micWakeWord
                ? `呼唤「灯塔」已开启：像 Siri 一样随时喊一声“嗨灯塔”或“${aiNameRef.current}”就能直接聊天！`
                : "免提自由语音已开启：随时开口说话即可与伴侣聊天。",
            );
          }
          return true;
        }

        return await startVadMicStream({ silent });
      } catch (error) {
        const hiddenOrTransient =
          document.visibilityState === "hidden" ||
          error?.name === "AbortError" ||
          error?.name === "NotReadableError";
        if (hiddenOrTransient && prefsRef.current.micAlwaysOn) {
          micSuspendedByBgRef.current = true;
          return false;
        }
        if (!silent) {
          const msg =
            error?.name === "NotAllowedError"
              ? "麦克风权限未允许，请在系统设置中允许 DengTa 使用麦克风（只需授权一次）。"
              : `无法开启语音呼唤：${error?.message || "请重试"}`;
          setSensorError(msg);
          onNotice?.(msg);
        }
        if (error?.name === "NotAllowedError" && !silent) {
          updatePrefs({ micAlwaysOn: false });
        }
        return false;
      } finally {
        if (mountedRef.current) setSensorBusy("");
      }
    },
    [
      armSiriWakeWindow,
      clearSiriWakeWindow,
      isNative,
      onNotice,
      onTranscript,
      startVadMicStream,
      stopMic,
      updatePrefs,
    ],
  );

  const toggleMic = useCallback(async () => {
    if (micLive || prefsRef.current.micAlwaysOn) {
      stopMic({ manual: true });
      micSuspendedByBgRef.current = false;
      updatePrefs({ micAlwaysOn: false });
      onNotice?.("已关闭语音呼唤监听。");
      return;
    }
    await startMic();
  }, [micLive, onNotice, startMic, stopMic, updatePrefs]);

  const stopAll = useCallback(async () => {
    stopCamera({ manual: true });
    stopWebScreen();
    stopMic({ manual: true });
    cameraSuspendedByBgRef.current = false;
    micSuspendedByBgRef.current = false;
    updatePrefs({
      screenAlwaysOn: false,
      cameraAlwaysOn: false,
      micAlwaysOn: false,
    });
    if (isNative && nativeScreenActive) {
      await onStopNativeScreen?.();
    }
    onNotice?.("已一键暂停全部实时画面与声音感知。");
  }, [
    isNative,
    nativeScreenActive,
    onNotice,
    onStopNativeScreen,
    stopCamera,
    stopMic,
    stopWebScreen,
    updatePrefs,
  ]);

  const resumeSavedSensors = useCallback(
    async ({ reason = "launch" } = {}) => {
      if (!mountedRef.current || document.visibilityState === "hidden") return;
      const saved = prefsRef.current;
      if (saved.cameraAlwaysOn && !cameraStreamRef.current && isCameraSupported()) {
        const perm = await queryMediaPermissionState("camera");
        if (mountedRef.current && (perm === "granted" || cameraSuspendedByBgRef.current)) {
          await startCamera(saved.cameraFacing, { silent: true });
        }
      }
      if (saved.micAlwaysOn && !micStreamRef.current && !recognitionRef.current && isMicSupported()) {
        const perm = await queryMediaPermissionState("microphone");
        if (mountedRef.current && (perm === "granted" || micSuspendedByBgRef.current)) {
          await startMic({ silent: true });
        }
      }
      if (isNative && deviceActivityState?.enabled && deviceActivityState?.permissionGranted && reason !== "launch") {
        void onRefreshActivity?.({ force: true, silent: true });
      }
    },
    [
      deviceActivityState?.enabled,
      deviceActivityState?.permissionGranted,
      isNative,
      onRefreshActivity,
      startCamera,
      startMic,
    ],
  );

  // Auto-resume permanently authorized sensors on app launch AND whenever returning from another app!
  useEffect(() => {
    if (!autoResumedRef.current) {
      autoResumedRef.current = true;
      void resumeSavedSensors({ reason: "launch" });
    }
    let resumeTimer = null;
    const scheduleResume = (reason) => {
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        void resumeSavedSensors({ reason });
      }, 240);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        scheduleResume("visibility");
      }
    };
    const onFocus = () => scheduleResume("focus");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);

    let appStateHandle = null;
    if (isNative) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          scheduleResume("capacitor-resume");
        }
      })
        .then((handle) => {
          appStateHandle = handle;
        })
        .catch(() => {});
    }

    return () => {
      if (resumeTimer) window.clearTimeout(resumeTimer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      void appStateHandle?.remove?.();
    };
  }, [isNative, resumeSavedSensors]);

  // Keep camera video element synced whenever mini preview toggles open/close or view returns to chat.
  useEffect(() => {
    if (cameraLive && cameraPreviewOpen && !keyboardOpen && activeView === "chat" && cameraStreamRef.current) {
      attachCameraStream(cameraStreamRef.current);
    }
  }, [activeView, attachCameraStream, cameraLive, cameraPreviewOpen, keyboardOpen]);

  // Continuous Activity Awareness polling when enabled on native Android.
  useEffect(() => {
    if (!isNative || !deviceActivityState?.enabled || !deviceActivityState?.permissionGranted) {
      return undefined;
    }
    const poll = () => {
      if (document.visibilityState === "hidden") return;
      void onRefreshActivity?.({ force: true, silent: true });
    };
    const timer = window.setInterval(poll, ACTIVITY_LIVE_POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    deviceActivityState?.enabled,
    deviceActivityState?.permissionGranted,
    isNative,
    onRefreshActivity,
  ]);

  // Pause speech recognition while AI TTS speaks to prevent echo loop, then resume.
  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !prefsRef.current.micAlwaysOn) return;
    if (isAiSpeaking) {
      try {
        recognition.stop();
      } catch {
        // Ignore.
      }
    } else {
      const t = window.setTimeout(() => {
        if (!mountedRef.current || !prefsRef.current.micAlwaysOn || isAiSpeakingRef.current) {
          return;
        }
        try {
          recognition.start();
        } catch {
          // Already active.
        }
      }, 300);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [isAiSpeaking]);

  // Notify parent of active sensor status.
  useEffect(() => {
    const snapshot = buildLivePerceptionEnvironmentPayload({
      screenActive: screenLive,
      cameraActive: cameraLive,
      cameraFacing: prefs.cameraFacing,
      micActive: micLive,
      activityActive: activityLive,
      platform: isNative ? "android" : "web",
    });
    onSensorsChange?.(snapshot);
  }, [activityLive, cameraLive, isNative, micLive, onSensorsChange, prefs.cameraFacing, screenLive]);

  // Cleanup all streams strictly on full app unmount.
  useEffect(() => {
    return () => {
      stopMediaStream(cameraStreamRef.current);
      stopMediaStream(screenStreamRef.current);
      stopMediaStream(micStreamRef.current);
      vadMonitorRef.current?.stop();
      if (micRestartTimerRef.current) window.clearTimeout(micRestartTimerRef.current);
      if (siriWakeTimerRef.current) window.clearTimeout(siriWakeTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch {
          // Ignore.
        }
      }
    };
  }, []);

  // Expose imperative capture bridge to App.jsx sendMessage()
  useEffect(() => {
    if (typeof onRegisterController !== "function") return undefined;
    const api = {
      async collectTurnVisuals({ maxExtra = 2, wakeWordTriggered = false } = {}) {
        const files = [];
        const sources = [];
        const evidence = [];
        let remaining = Math.max(0, maxExtra);

        if (remaining > 0 && screenLive) {
          // Prefer a recent significant auto-captured screen change if not yet attached!
          const pending = latestPendingEvidenceRef.current;
          const pendingFresh =
            pending &&
            pending.file &&
            pending.id !== lastSentEvidenceIdRef.current &&
            Date.now() - Date.parse(pending.captured_at) < 5 * 60 * 1000;
          let chosenEntry = pendingFresh ? pending : null;
          if (!chosenEntry) {
            chosenEntry = await captureScreenEvidenceNow({
              reason: "本轮实时看屏",
              changeScore: 0,
              appName: currentAppNameRef.current,
            });
          }
          if (chosenEntry?.file) {
            lastSentEvidenceIdRef.current = chosenEntry.id;
            files.push(chosenEntry.file);
            sources.push("screen");
            evidence.push(serializeEvidenceForPayload(chosenEntry));
            remaining -= 1;
          }
        }

        if (remaining > 0 && cameraLive && cameraVideoRef.current && cameraStreamRef.current) {
          const cameraFile = await captureVideoElementFrame(cameraVideoRef.current, {
            prefix: "dengta-live-camera",
            maxEdge: 800,
            quality: 0.8,
          });
          if (cameraFile) {
            const camThumb = await createThumbnailDataUrlFromFile(cameraFile);
            const nowIso = new Date().toISOString();
            const camEntry = registerScreenEvidence({
              id: `cam-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: "camera",
              captured_at: nowIso,
              time_label: formatEvidenceTimeLabel(nowIso),
              trigger_reason:
                prefsRef.current.cameraFacing === "environment"
                  ? "后置镜头实时画面"
                  : "前置镜头实时画面",
              change_score: 0,
              thumbnail_data_url: camThumb,
              file: cameraFile,
            });
            files.push(cameraFile);
            sources.push("camera");
            if (camEntry) evidence.push(serializeEvidenceForPayload(camEntry));
          }
        }

        const livePerception = buildLivePerceptionEnvironmentPayload({
          screenActive: screenLive,
          cameraActive: cameraLive,
          cameraFacing: prefsRef.current.cameraFacing,
          micActive: micLive,
          activityActive: activityLive,
          capturedSources: sources,
          screenEvidence: evidence,
          wakeWordTriggered,
          platform: isNative ? "android" : "web",
        });
        return { files, sources, evidence, livePerception };
      },
      stopAll,
      getSnapshot() {
        return buildLivePerceptionEnvironmentPayload({
          screenActive: screenLive,
          cameraActive: cameraLive,
          cameraFacing: prefsRef.current.cameraFacing,
          micActive: micLive,
          activityActive: activityLive,
          platform: isNative ? "android" : "web",
        });
      },
    };
    onRegisterController(api);
    return () => {
      onRegisterController(null);
    };
  }, [
    activityLive,
    cameraLive,
    captureScreenEvidenceNow,
    isNative,
    micLive,
    onRegisterController,
    screenLive,
    stopAll,
  ]);

  const anyLive = screenLive || cameraLive || micLive || activityLive;
  const activeSummaryLabels = [
    screenLive ? "智能看屏" : "",
    activityLive ? (currentAppName ? `应用·${currentAppName}` : "应用") : "",
    cameraLive ? "镜头" : "",
    micLive ? (siriAwake ? "灯塔在听" : prefs.micWakeWord ? "呼唤灯塔" : "直听中") : "",
  ].filter(Boolean);

  // Minimal non-cluttering overlay above composer: ONLY shows properly-proportioned Camera PiP
  // (auto-hidden when keyboard is open!) or active Siri listening ribbon. Zero pill bar clutter!
  const chatMinimalOverlay = (
    <div className="live-perception-minimal-overlay">
      {cameraLive && cameraPreviewOpen && !keyboardOpen && (
        <div className="live-camera-pip">
          <video ref={cameraVideoRef} muted playsInline autoPlay />
          <div className="live-camera-pip-badge">
            <span className="live-dot" aria-hidden="true" />
            <span>{aiName}可见</span>
          </div>
          <div className="live-camera-pip-actions">
            <button
              type="button"
              onClick={() => void flipCamera()}
              title="切换前后镜头"
              aria-label="切换前后镜头"
            >
              <SwitchCamera size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void snapCameraNow({ askAiToComment: true })}
              title={`让${aiName}立刻看一眼并主动聊起眼前画面`}
              aria-label="让伴侣看一眼并开聊"
            >
              <Sparkles size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setCameraPreviewOpen(false)}
              title="隐藏小窗（仍保持实时视觉）"
              aria-label="隐藏预览小窗"
            >
              <EyeOff size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {(siriAwake || (micLive && micInterim)) && (
        <div className="live-siri-banner" role="status" aria-live="polite">
          <span className="live-dot is-mic" aria-hidden="true" />
          <strong>{siriAwake ? `🎙️ ${aiName}在听，请说…` : "正在听你说…"}</strong>
          {micInterim && <span className="live-siri-interim">{micInterim}</span>}
          {siriAwake && (
            <button type="button" onClick={clearSiriWakeWindow}>
              取消
            </button>
          )}
        </div>
      )}
    </div>
  );

  // Full spacious 4-Sense Perception Center rendered INSIDE the Left Star Button drawer!
  const starDrawerPanel = (
    <section className="star-perception-center" aria-label="实时感知与语音呼唤中心">
      <div className="star-perception-head">
        <div>
          <strong>实时感知与呼唤（一次授权 · 切应用自动保持）</strong>
          <small>
            开镜头后{aiName}会主动聊起眼前看到的画面；开呼唤灯塔后像 Siri 一样喊“嗨灯塔”即可聊天。
          </small>
        </div>
        {(screenSessionRunning || cameraLive || micLive) && (
          <button
            type="button"
            className="star-perception-stop-all"
            onClick={() => void stopAll()}
          >
            <Power size={13} aria-hidden="true" />
            <span>全部暂停</span>
          </button>
        )}
      </div>

      <div className="star-perception-grid">
        {/* 1. Smart Screen Watch */}
        <div className={`star-sense-card${screenLive ? " is-live" : screenPaused ? " is-paused" : ""}`}>
          <div className="star-sense-card-top">
            <span className="star-sense-icon">
              <Monitor size={16} aria-hidden="true" />
            </span>
            <div className="star-sense-copy">
              <strong>智能看屏幕</strong>
              <small>切应用或画面大变化自动抓拍，并在聊天里附截屏依据</small>
            </div>
          </div>
          <div className="star-sense-actions">
            <button
              type="button"
              className={`star-sense-toggle${screenSessionRunning ? " is-active" : ""}`}
              disabled={sensorBusy === "screen" || !isDisplayCaptureSupported()}
              aria-pressed={screenSessionRunning}
              onClick={() => void toggleScreen()}
            >
              {screenSessionRunning ? "关闭共享" : "开启看屏"}
            </button>
            {screenSessionRunning && (
              <button
                type="button"
                className="star-sense-subbtn"
                onClick={() => void togglePauseScreen()}
              >
                {screenPaused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
                <span>{screenPaused ? "继续共享" : "暂停屏幕共享"}</span>
              </button>
            )}
          </div>
          {screenLive && (
            <div className="star-sense-extra-row">
              <label className="star-sense-checkbox">
                <input
                  type="checkbox"
                  checked={prefs.screenChangeWatch}
                  onChange={(event) => updatePrefs({ screenChangeWatch: event.target.checked })}
                />
                <span>画面大变化时自动抓拍</span>
              </label>
              <button
                type="button"
                className="star-sense-link"
                onClick={() => {
                  void captureScreenEvidenceNow({ reason: "手动抓拍理解", changeScore: 100 }).then(
                    (ev) => {
                      if (ev) onNotice?.(`已截取 ${ev.time_label} 屏幕画面，发消息时将作为截屏依据引用。`);
                    },
                  );
                }}
              >
                立刻抓一帧
              </button>
            </div>
          )}
        </div>

        {/* 2. App Activity Awareness */}
        <div className={`star-sense-card${activityLive ? " is-live" : ""}`}>
          <div className="star-sense-card-top">
            <span className="star-sense-icon">
              <Activity size={16} aria-hidden="true" />
            </span>
            <div className="star-sense-copy">
              <strong>应用感知</strong>
              <small>
                {activityLive
                  ? currentAppName
                    ? `正在感知：${currentAppName}`
                    : "运行中 · 自动识别切换的 App"
                  : "察觉你刚在看什么 App，切回聊天自然接梗"}
              </small>
            </div>
          </div>
          <div className="star-sense-actions">
            <button
              type="button"
              className={`star-sense-toggle${activityLive ? " is-active" : ""}`}
              aria-pressed={activityLive}
              onClick={() => void toggleActivity()}
            >
              {activityLive ? "已开启 · 关闭" : "开启应用感知"}
            </button>
          </div>
        </div>

        {/* 3. Camera Live Vision */}
        <div className={`star-sense-card${cameraLive ? " is-live" : ""}`}>
          <div className="star-sense-card-top">
            <span className="star-sense-icon">
              <Camera size={16} aria-hidden="true" />
            </span>
            <div className="star-sense-copy">
              <strong>视觉摄像头</strong>
              <small>打开后{aiName}能看见你和周边环境，聊天时主动聊眼前画面</small>
            </div>
          </div>
          <div className="star-sense-actions">
            <button
              type="button"
              className={`star-sense-toggle${cameraLive ? " is-active" : ""}`}
              disabled={sensorBusy === "camera" || !isCameraSupported()}
              aria-pressed={cameraLive}
              onClick={() => void toggleCamera()}
            >
              {sensorBusy === "camera" ? "开启中…" : cameraLive ? "关闭镜头" : "开启摄像头"}
            </button>
            {cameraLive && (
              <button
                type="button"
                className="star-sense-subbtn"
                onClick={() => void snapCameraNow({ askAiToComment: true })}
              >
                <Sparkles size={13} aria-hidden="true" />
                <span>让TA看一眼聊</span>
              </button>
            )}
          </div>
          {cameraLive && (
            <div className="star-sense-extra-row">
              <button type="button" className="star-sense-link" onClick={() => void flipCamera()}>
                <SwitchCamera size={12} aria-hidden="true" /> 切到
                {prefs.cameraFacing === "user" ? "后置" : "前置"}
              </button>
              <button
                type="button"
                className="star-sense-link"
                onClick={() => setCameraPreviewOpen((open) => !open)}
              >
                {cameraPreviewOpen ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
                <span>{cameraPreviewOpen ? "隐藏小窗" : "显示小窗"}</span>
              </button>
            </div>
          )}
        </div>

        {/* 4. Siri-like Voice Wake ("呼唤灯塔") */}
        <div className={`star-sense-card${micLive ? " is-live" : ""}`}>
          <div className="star-sense-card-top">
            <span className="star-sense-icon">
              {micLive ? <Mic size={16} aria-hidden="true" /> : <MicOff size={16} aria-hidden="true" />}
            </span>
            <div className="star-sense-copy">
              <strong>呼唤「灯塔」</strong>
              <small>
                {micLive
                  ? prefs.micWakeWord
                    ? `待命中 · 喊“嗨灯塔”或“${aiName}”即刻唤醒`
                    : micEngine === "vad"
                      ? "声纹直听中 · 开口即聊"
                      : "自由聆听中 · 说完自动聊"
                  : "像 Siri 一样喊一声“嗨灯塔”唤醒直接对话"}
              </small>
            </div>
          </div>
          <div className="star-sense-actions">
            <button
              type="button"
              className={`star-sense-toggle${micLive ? " is-active" : ""}`}
              disabled={sensorBusy === "mic" || !isMicSupported()}
              aria-pressed={micLive}
              onClick={() => void toggleMic()}
            >
              {sensorBusy === "mic" ? "开启中…" : micLive ? "关闭呼唤" : "开启呼唤"}
            </button>
            {micLive && micEngine === "speech" && (
              <button
                type="button"
                className="star-sense-subbtn"
                onClick={() => {
                  const nextWake = !prefs.micWakeWord;
                  updatePrefs({ micWakeWord: nextWake });
                  onNotice?.(
                    nextWake
                      ? "已切换为 Siri 唤醒模式：喊“嗨灯塔”后再说内容。"
                      : "已切换为免提自由直聊：无需唤醒词，开口直接聊。",
                  );
                }}
              >
                {prefs.micWakeWord ? "Siri唤醒" : "自由直聊"}
              </button>
            )}
          </div>
          {micLive && micEngine === "speech" && isSpeechRecognitionSupported() && (
            <div className="star-sense-extra-row">
              <label className="star-sense-checkbox">
                <input
                  type="checkbox"
                  checked={prefs.micAutoSend}
                  onChange={(event) => updatePrefs({ micAutoSend: event.target.checked })}
                />
                <span>说完自动发送</span>
              </label>
              {micEngine === "vad" && (
                <span className="live-mic-meter" aria-hidden="true">
                  <i style={{ transform: `scaleY(${Math.max(0.25, micLevel).toFixed(2)})` }} />
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {screenEvidenceList.length > 0 && (
        <div className="star-screen-evidence-strip">
          <div className="star-screen-evidence-head">
            <span>最近自动捕捉的截屏依据（发消息自动引用）</span>
            <small>{screenEvidenceList.length} 帧</small>
          </div>
          <div className="star-screen-evidence-list">
            {screenEvidenceList.slice(0, 4).map((ev) => (
              <button
                key={ev.id}
                type="button"
                className="star-evidence-chip"
                onClick={() => {
                  latestPendingEvidenceRef.current = ev;
                  lastSentEvidenceIdRef.current = "";
                  onNotice?.(`已选中 ${ev.time_label}（${ev.app_name || ev.trigger_reason}）作为下条消息的截屏依据。`);
                }}
                title={`${ev.time_label} · ${ev.trigger_reason}${ev.change_score ? ` (${ev.change_score}%)` : ""}`}
              >
                {ev.thumbnail_data_url ? (
                  <img src={ev.thumbnail_data_url} alt={`${ev.time_label} 截屏`} />
                ) : (
                  <Monitor size={14} aria-hidden="true" />
                )}
                <span>
                  <b>{ev.time_label}</b>
                  <em>{ev.app_name || ev.trigger_reason}</em>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {sensorError && (
        <p className="live-perception-error" role="status">
          {sensorError}
        </p>
      )}
    </section>
  );

  // Persistent 0px runtime root stays mounted across ALL views so live streams
  // never stop on tab switch; full controls portal cleanly into the Left Star Drawer.
  return (
    <div className={`live-perception-hud-host${activeView !== "chat" && anyLive ? " is-visible" : ""}`}>
      <video ref={screenVideoRef} className="live-perception-hidden-video" muted playsInline aria-hidden="true" />
      {(!cameraLive || !cameraPreviewOpen || keyboardOpen || activeView !== "chat" || !chatPortalTarget) && (
        <video ref={cameraVideoRef} className="live-perception-hidden-video" muted playsInline autoPlay aria-hidden="true" />
      )}
      {activeView === "chat" && chatPortalTarget
        ? createPortal(chatMinimalOverlay, chatPortalTarget)
        : null}
      {activeView === "chat" && starDrawerPortalTarget
        ? createPortal(starDrawerPanel, starDrawerPortalTarget)
        : null}
      {activeView !== "chat" && anyLive && (
        <div className="live-perception-floating-hud" role="status" aria-label="实时感知跨页运行中">
          <span className="live-dot" aria-hidden="true" />
          <span className="live-hud-label">感知在线：{activeSummaryLabels.join(" · ")}</span>
          {onBackToChat && (
            <button
              type="button"
              className="live-hud-btn"
              onClick={onBackToChat}
              title="切回聊天"
            >
              <MessageCircle size={12} aria-hidden="true" />
              <span>回聊天</span>
            </button>
          )}
          {(screenLive || cameraLive || micLive) && (
            <button
              type="button"
              className="live-hud-btn is-stop"
              onClick={() => void stopAll()}
              aria-label="停止全部实时感知"
              title="一键停止全部实时感知"
            >
              <Power size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LivePerceptionSettingsCard({
  scope = "default",
  screenGlanceState = {},
  deviceActivityState = {},
  onStartScreen,
  onStopScreen,
  onToggleActivity,
  onOpenActivityPermission,
  onRefreshActivity,
}) {
  const isNative = Capacitor.isNativePlatform();
  const [prefs, setPrefs] = useState(() => readLivePerceptionPrefs(scope));
  const [testFeedback, setTestFeedback] = useState("");

  const savePref = (patch) => {
    const next = writeLivePerceptionPrefs(scope, { ...prefs, ...patch });
    setPrefs(next);
  };

  async function testMediaPermission(kind) {
    setTestFeedback("");
    if (isNative) {
      const perm = await requestNativeMediaPermissions(
        kind === "camera" ? { camera: true } : { microphone: true },
      );
      if (perm && (kind === "camera" ? perm.cameraGranted : perm.microphoneGranted)) {
        setTestFeedback(
          kind === "camera"
            ? "相机已获得永久授权！点聊天输入框左侧「星星按钮 → 视觉摄像头」开启后，切应用回来会自动保持。"
            : "麦克风已获得永久授权！点聊天输入框左侧「星星按钮 → 呼唤灯塔」开启后，像 Siri 一样喊“嗨灯塔”即可聊天。",
        );
        return;
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setTestFeedback("当前设备不支持浏览器/WebView 媒体授权。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "camera" ? { video: true, audio: false } : { audio: true, video: false },
      );
      stream.getTracks().forEach((track) => track.stop());
      setTestFeedback(
        kind === "camera"
          ? "摄像头权限已就绪！点输入框左侧星星按钮打开「视觉摄像头」即可全程保持。"
          : "麦克风权限已就绪！点输入框左侧星星按钮打开「呼唤灯塔」即可随时语音对话。",
      );
    } catch (error) {
      setTestFeedback(
        `${kind === "camera" ? "摄像头" : "麦克风"}授权未通过：${error?.message || "请在系统应用权限中开启"}`,
      );
    }
  }

  return (
    <div className="notification-feature-panel live-perception-settings-card">
      <div className="device-activity-heading">
        <div>
          <strong>实时多模态感知中心（智能看屏 · 应用 · 视觉镜头 · 呼唤灯塔）</strong>
          <span>收纳在输入框左侧星星按钮内 · 一次授权持久保持</span>
        </div>
      </div>
      <p>
        打开任意权限后，在聊天输入框左侧的「星星按钮」里可随时开关四项感知；相机、麦克风与应用权限在 Android 系统授权一次后永久记住，切应用回来自动恢复。
      </p>
      <div className="live-perception-status-grid">
        <div className="live-perception-status-item">
          <strong>智能看屏幕（变化自动抓拍）</strong>
          <small>
            {isNative
              ? screenGlanceState?.active
                ? "Android 前台共享运行中 · 切屏或画面大变化自动记录截屏依据"
                : "未开启（点击下方或聊天星星按钮「智能看屏幕」授权）"
              : "支持桌面/网页持续共享并检测画面显著变化"}
          </small>
          {isNative && (
            <button
              type="button"
              onClick={() =>
                void (screenGlanceState?.active ? onStopScreen?.() : onStartScreen?.())
              }
            >
              {screenGlanceState?.active ? "停止屏幕共享" : "开启屏幕共享"}
            </button>
          )}
        </div>

        <div className="live-perception-status-item">
          <strong>应用活动感知</strong>
          <small>
            {isNative
              ? deviceActivityState?.enabled && deviceActivityState?.permissionGranted
                ? "已永久授权 · 实时同步前台应用切换"
                : "需开启开关并授予一次系统使用情况访问权限"
              : "网页端记录当前活跃视图"}
          </small>
          {isNative && (
            <div className="live-perception-inline-btns">
              <button
                type="button"
                onClick={() => void onToggleActivity?.(!deviceActivityState?.enabled)}
              >
                {deviceActivityState?.enabled ? "关闭感知" : "开启感知"}
              </button>
              {!deviceActivityState?.permissionGranted ? (
                <button type="button" onClick={() => void onOpenActivityPermission?.()}>
                  去系统授权
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onRefreshActivity?.({ force: true })}
                >
                  <RefreshCw size={12} aria-hidden="true" /> 刷新
                </button>
              )}
            </div>
          )}
        </div>

        <div className="live-perception-status-item">
          <strong>视觉摄像头（主动观察开聊）</strong>
          <small>
            默认镜头：{prefs.cameraFacing === "environment" ? "后置摄像头" : "前置摄像头"}
          </small>
          <div className="live-perception-inline-btns">
            <button type="button" onClick={() => void testMediaPermission("camera")}>
              检查/申请相机权限
            </button>
            <button
              type="button"
              onClick={() =>
                savePref({
                  cameraFacing: prefs.cameraFacing === "user" ? "environment" : "user",
                })
              }
            >
              切到{prefs.cameraFacing === "user" ? "后置" : "前置"}
            </button>
          </div>
        </div>

        <div className="live-perception-status-item">
          <strong>呼唤「灯塔」（Siri 语音唤醒）</strong>
          <small>
            唤醒词：{prefs.micWakeWord ? "已开启（喊“嗨灯塔”）" : "已关闭（免提直聊）"} · 说完后：
            {prefs.micAutoSend ? "自动发送" : "只填入框"}
          </small>
          <div className="live-perception-inline-btns">
            <button type="button" onClick={() => void testMediaPermission("mic")}>
              检查/申请麦克风权限
            </button>
            <button
              type="button"
              onClick={() => savePref({ micWakeWord: !prefs.micWakeWord })}
            >
              {prefs.micWakeWord ? "改为免提直聊" : "开启“嗨灯塔”唤醒"}
            </button>
            <button
              type="button"
              onClick={() => savePref({ micAutoSend: !prefs.micAutoSend })}
            >
              {prefs.micAutoSend ? "改为只填入" : "开启说完自动发"}
            </button>
          </div>
        </div>
      </div>

      {testFeedback && (
        <p className="notification-feature-feedback success" role="status">
          {testFeedback}
        </p>
      )}
    </div>
  );
}
