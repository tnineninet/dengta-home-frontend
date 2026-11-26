import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import {
  Activity,
  Camera,
  Eye,
  EyeOff,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  Power,
  RefreshCw,
  Send,
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
  writeLivePerceptionPrefs,
} from "./live-perception.js";
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
  activeView = "chat",
  chatPortalTarget = null,
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
  onEnableNativeActivity,
  onOpenActivityPermission,
  onRefreshActivity,
  onSnapFile,
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
  const [micLive, setMicLive] = useState(false);
  const [micEngine, setMicEngine] = useState("");
  const [micCapturingSpeech, setMicCapturingSpeech] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micInterim, setMicInterim] = useState("");
  const [sensorBusy, setSensorBusy] = useState("");
  const [sensorError, setSensorError] = useState("");

  const prefsRef = useRef(prefs);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const recognitionRef = useRef(null);
  const micStreamRef = useRef(null);
  const vadMonitorRef = useRef(null);
  const micRestartTimerRef = useRef(null);
  const isAiSpeakingRef = useRef(isAiSpeaking);
  const isVoiceBusyRef = useRef(isVoiceBusy);
  const isSendingRef = useRef(isSending);
  const mountedRef = useRef(true);
  const autoResumedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking;
    isVoiceBusyRef.current = isVoiceBusy;
    isSendingRef.current = isSending;
  }, [isAiSpeaking, isSending, isVoiceBusy]);

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

  const attachCameraStream = useCallback((stream) => {
    const video = cameraVideoRef.current;
    if (!video) return;
    video.srcObject = stream || null;
    if (stream) {
      void video.play().catch(() => {});
    }
  }, []);

  const stopCamera = useCallback(() => {
    stopMediaStream(cameraStreamRef.current);
    cameraStreamRef.current = null;
    attachCameraStream(null);
    setCameraLive(false);
  }, [attachCameraStream]);

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
      setSensorBusy("camera");
      setSensorError("");
      try {
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
        const track = stream.getVideoTracks()[0];
        if (track) {
          track.addEventListener(
            "ended",
            () => {
              if (!mountedRef.current) return;
              cameraStreamRef.current = null;
              setCameraLive(false);
              updatePrefs({ cameraAlwaysOn: false });
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
        if (!silent) {
          const msg =
            name === "NotAllowedError" || name === "SecurityError"
              ? "摄像头权限未允许，请在系统弹窗或应用权限中开启相机。"
              : name === "NotFoundError"
                ? "未检测到可用摄像头。"
                : `无法打开摄像头：${error?.message || "请重试"}`;
          setSensorError(msg);
          onNotice?.(msg);
        }
        updatePrefs({ cameraAlwaysOn: false });
        return false;
      } finally {
        if (mountedRef.current) setSensorBusy("");
      }
    },
    [attachCameraStream, onNotice, updatePrefs],
  );

  const toggleCamera = useCallback(async () => {
    if (cameraLive) {
      stopCamera();
      updatePrefs({ cameraAlwaysOn: false });
      onNotice?.("已关闭实时摄像头感知。");
      return;
    }
    const ok = await startCamera(prefsRef.current.cameraFacing);
    if (ok) {
      onNotice?.("实时摄像头已开启：跨页面全程在线，发消息时伴侣会自动看到此刻画面。");
    }
  }, [cameraLive, onNotice, startCamera, stopCamera, updatePrefs]);

  const flipCamera = useCallback(async () => {
    const nextFacing = prefsRef.current.cameraFacing === "user" ? "environment" : "user";
    updatePrefs({ cameraFacing: nextFacing });
    if (cameraLive) {
      await startCamera(nextFacing);
    }
  }, [cameraLive, startCamera, updatePrefs]);

  const snapCameraNow = useCallback(async () => {
    const file = await captureVideoElementFrame(cameraVideoRef.current, {
      prefix: "dengta-camera-snap",
    });
    if (!file) {
      onNotice?.("摄像头画面尚未就绪，请稍候再拍。");
      return;
    }
    await onSnapFile?.(file);
  }, [onNotice, onSnapFile]);

  const stopWebScreen = useCallback(() => {
    stopMediaStream(screenStreamRef.current);
    screenStreamRef.current = null;
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
    setWebScreenLive(false);
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
            updatePrefs({ screenAlwaysOn: false });
          },
          { once: true },
        );
      }
      setWebScreenLive(true);
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

  const nativeScreenActive = Boolean(
    isNative && screenGlanceState?.active && !screenGlanceState?.paused,
  );
  const screenLive = isNative ? nativeScreenActive : webScreenLive;

  const toggleScreen = useCallback(async () => {
    if (isNative) {
      if (nativeScreenActive) {
        updatePrefs({ screenAlwaysOn: false });
        await onStopNativeScreen?.();
        return;
      }
      updatePrefs({ screenAlwaysOn: true });
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
      onNotice?.("实时屏幕感知已开启：跨页面全程保持，每次聊天自动看到此刻屏幕。");
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
        ? "已开启活动感知（Android App 安装后可跨应用感知当前与近期使用的 App）。"
        : "已关闭活动感知。",
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

  const stopMic = useCallback(() => {
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
    setMicCapturingSpeech(false);
    setMicLevel(0);
    setMicInterim("");
  }, []);

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
      if (isVadRecordingSupported() && typeof onVoiceTurnBlob === "function") {
        vadMonitorRef.current = createVoiceActivityMonitor(stream, {
          shouldIgnore: () =>
            isAiSpeakingRef.current || isSendingRef.current || isVoiceBusyRef.current,
          onLevel: (lvl) => {
            if (mountedRef.current) setMicLevel(lvl);
          },
          onSpeechStart: () => {
            if (mountedRef.current) setMicCapturingSpeech(true);
          },
          onSpeechEnd: (blob, durationMs) => {
            if (!mountedRef.current) return;
            setMicCapturingSpeech(false);
            void onVoiceTurnBlob(blob, durationMs);
          },
        });
        setMicEngine("vad");
        setMicLive(true);
        updatePrefs({ micAlwaysOn: true });
        if (!silent) {
          onNotice?.("免提声纹直听已开启：开口说话即可自动识别情绪并回复（无需按住说话）。");
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
      setSensorBusy("mic");
      setSensorError("");
      try {
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
            setMicInterim(interim);
            if (finals.length > 0) {
              const combined = finals.join(" ").trim();
              if (combined) {
                setMicInterim("");
                onTranscript?.(combined, {
                  autoSend: prefsRef.current.micAutoSend && !isSendingRef.current,
                });
              }
            }
          };
          recognition.onerror = (event) => {
            const code = String(event?.error || "");
            if (code === "not-allowed") {
              setSensorError("麦克风权限未允许，请在浏览器或手机应用权限中开启麦克风。");
              stopMic();
              updatePrefs({ micAlwaysOn: false });
              return;
            }
            if (
              code === "service-not-allowed" ||
              code === "network" ||
              code === "audio-capture"
            ) {
              // Seamless fallback on Android WebView / China ROMs without Google Speech Services.
              stopMic();
              void startVadMicStream({ silent: true }).catch(() => {
                if (mountedRef.current) {
                  setSensorError("语音识别服务不可用，请重试开启麦克风。");
                  updatePrefs({ micAlwaysOn: false });
                }
              });
            }
          };
          recognition.onend = () => {
            if (!mountedRef.current) return;
            if (prefsRef.current.micAlwaysOn && recognitionRef.current === recognition) {
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
          setMicEngine("speech");
          setMicLive(true);
          updatePrefs({ micAlwaysOn: true });
          if (!silent) {
            onNotice?.("持续语音聆听已开启：跨页面全程在线，随时开口说话。");
          }
          return true;
        }

        return await startVadMicStream({ silent });
      } catch (error) {
        if (!silent) {
          const msg =
            error?.name === "NotAllowedError"
              ? "麦克风权限未允许，请在系统设置中允许 DengTa 使用麦克风。"
              : `无法开启持续麦克风：${error?.message || "请重试"}`;
          setSensorError(msg);
          onNotice?.(msg);
        }
        updatePrefs({ micAlwaysOn: false });
        return false;
      } finally {
        if (mountedRef.current) setSensorBusy("");
      }
    },
    [onNotice, onTranscript, startVadMicStream, stopMic, updatePrefs],
  );

  const toggleMic = useCallback(async () => {
    if (micLive) {
      stopMic();
      updatePrefs({ micAlwaysOn: false });
      onNotice?.("已关闭持续麦克风监听。");
      return;
    }
    await startMic();
  }, [micLive, onNotice, startMic, stopMic, updatePrefs]);

  const stopAll = useCallback(async () => {
    stopCamera();
    stopWebScreen();
    stopMic();
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

  // Permission-aware auto-resume on launch: if user already granted permission and
  // opted into Always-On sensors before reload/reopen, resume seamlessly without prompting.
  useEffect(() => {
    if (autoResumedRef.current) return;
    autoResumedRef.current = true;
    const saved = prefsRef.current;
    let cancelled = false;
    void (async () => {
      if (saved.cameraAlwaysOn && isCameraSupported()) {
        const perm = await queryMediaPermissionState("camera");
        if (!cancelled && perm === "granted") {
          await startCamera(saved.cameraFacing, { silent: true });
        }
      }
      if (saved.micAlwaysOn && isMicSupported()) {
        const perm = await queryMediaPermissionState("microphone");
        if (!cancelled && perm === "granted") {
          await startMic({ silent: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startCamera, startMic]);

  // Keep camera video element synced whenever mini preview toggles open/close or view returns to chat.
  useEffect(() => {
    if (cameraLive && cameraPreviewOpen && activeView === "chat" && cameraStreamRef.current) {
      attachCameraStream(cameraStreamRef.current);
    }
  }, [activeView, attachCameraStream, cameraLive, cameraPreviewOpen]);

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
    const onVis = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
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
      async collectTurnVisuals({ maxExtra = 2 } = {}) {
        const files = [];
        const sources = [];
        let remaining = Math.max(0, maxExtra);

        if (remaining > 0 && screenLive) {
          let screenFile = null;
          if (isNative && nativeScreenActive) {
            screenFile = await captureNativeScreenGlanceFile({
              accountScope,
              companionScope,
            });
          } else if (screenVideoRef.current && screenStreamRef.current) {
            screenFile = await captureVideoElementFrame(screenVideoRef.current, {
              prefix: "dengta-live-screen",
              maxEdge: 960,
              quality: 0.78,
            });
          }
          if (screenFile) {
            files.push(screenFile);
            sources.push("screen");
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
            files.push(cameraFile);
            sources.push("camera");
          }
        }

        const livePerception = buildLivePerceptionEnvironmentPayload({
          screenActive: screenLive,
          cameraActive: cameraLive,
          cameraFacing: prefsRef.current.cameraFacing,
          micActive: micLive,
          activityActive: activityLive,
          capturedSources: sources,
          platform: isNative ? "android" : "web",
        });
        return { files, sources, livePerception };
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
    accountScope,
    activityLive,
    cameraLive,
    companionScope,
    isNative,
    micLive,
    nativeScreenActive,
    onRegisterController,
    screenLive,
    stopAll,
  ]);

  const anyLive = screenLive || cameraLive || micLive || activityLive;
  const activeSummaryLabels = [
    screenLive ? "屏幕" : "",
    activityLive ? (currentAppName ? `应用·${currentAppName}` : "应用") : "",
    cameraLive ? "镜头" : "",
    micLive ? (micCapturingSpeech ? "收音中" : "听我") : "",
  ].filter(Boolean);

  const chatBarUi = (
    <div className={`live-perception-bar is-composer-dock${anyLive ? " has-active" : ""}`} role="region" aria-label="实时多模态感知控制">
      {cameraLive && cameraPreviewOpen && (
        <div className="live-camera-pip">
          <video ref={cameraVideoRef} muted playsInline autoPlay />
          <div className="live-camera-pip-actions">
            <button type="button" onClick={() => void flipCamera()} title="切换前后镜头" aria-label="切换前后镜头">
              <SwitchCamera size={13} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => void snapCameraNow()} title="立刻拍一张放进附件" aria-label="拍一张给伴侣">
              <Camera size={13} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setCameraPreviewOpen(false)} title="收起小窗（仍保持实时感知）" aria-label="收起预览小窗">
              <EyeOff size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <div className="live-perception-pills">
        <button
          type="button"
          className={`live-pill${screenLive ? " is-active" : ""}`}
          disabled={sensorBusy === "screen" || !isDisplayCaptureSupported()}
          aria-pressed={screenLive}
          title={screenLive ? "实时屏幕感知已开启（每轮自动看到当前画面），点击停止" : "开启实时屏幕感知，让伴侣随时看到你在干什么"}
          onClick={() => void toggleScreen()}
        >
          <Monitor size={13} aria-hidden="true" />
          <span>{screenLive ? "屏幕感知中" : "看屏幕"}</span>
          {screenLive && <i className="live-dot" aria-hidden="true" />}
        </button>

        <button
          type="button"
          className={`live-pill${activityLive ? " is-active" : ""}`}
          aria-pressed={activityLive}
          title={activityLive ? "应用活动感知运行中" : "开启应用活动感知，察觉正在使用的 App"}
          onClick={() => void toggleActivity()}
        >
          <Activity size={13} aria-hidden="true" />
          <span>
            {activityLive
              ? currentAppName
                ? `在用 ${currentAppName}`
                : "活动感知中"
              : "应用感知"}
          </span>
          {activityLive && <i className="live-dot" aria-hidden="true" />}
        </button>

        <button
          type="button"
          className={`live-pill${cameraLive ? " is-active" : ""}`}
          disabled={sensorBusy === "camera" || !isCameraSupported()}
          aria-pressed={cameraLive}
          title={cameraLive ? "摄像头实时感知中，点击关闭" : "开启摄像头，让伴侣随时看到你"}
          onClick={() => void toggleCamera()}
        >
          <Camera size={13} aria-hidden="true" />
          <span>{cameraLive ? "镜头看我中" : "开镜头"}</span>
          {cameraLive && <i className="live-dot" aria-hidden="true" />}
        </button>

        {cameraLive && !cameraPreviewOpen && (
          <button
            type="button"
            className="live-pill live-pill-mini"
            onClick={() => setCameraPreviewOpen(true)}
            title="展开摄像头小窗"
            aria-label="展开摄像头小窗"
          >
            <Eye size={13} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          className={`live-pill${micLive ? " is-active" : ""}`}
          disabled={sensorBusy === "mic" || !isMicSupported()}
          aria-pressed={micLive}
          title={micLive ? "持续麦克风聆听中，点击关闭" : "开启全程麦克风聆听，随时开口说话"}
          onClick={() => void toggleMic()}
        >
          {micLive ? <Mic size={13} aria-hidden="true" /> : <MicOff size={13} aria-hidden="true" />}
          <span>
            {micLive
              ? micCapturingSpeech
                ? "正在听你说…"
                : micEngine === "vad"
                  ? "声纹直听中"
                  : "随时听我中"
              : "常开麦"}
          </span>
          {micLive && micEngine === "vad" && (
            <span className="live-mic-meter" aria-hidden="true">
              <i style={{ transform: `scaleY(${Math.max(0.25, micLevel).toFixed(2)})` }} />
            </span>
          )}
          {micLive && micEngine !== "vad" && <i className="live-dot is-mic" aria-hidden="true" />}
        </button>

        {micLive && micEngine === "speech" && isSpeechRecognitionSupported() && (
          <button
            type="button"
            className={`live-pill live-pill-mini${prefs.micAutoSend ? " is-active" : ""}`}
            aria-pressed={prefs.micAutoSend}
            title={prefs.micAutoSend ? "说完自动发送：已开启" : "说完自动发送：已关闭（只填入输入框）"}
            onClick={() => updatePrefs({ micAutoSend: !prefs.micAutoSend })}
          >
            <Send size={12} aria-hidden="true" />
            <span>{prefs.micAutoSend ? "自动发" : "填入"}</span>
          </button>
        )}

        {(screenLive || cameraLive || micLive) && (
          <button
            type="button"
            className="live-pill live-pill-stop"
            onClick={() => void stopAll()}
            title="一键停止画面与麦克风感知"
            aria-label="一键停止全部实时感知"
          >
            <Power size={12} aria-hidden="true" />
            <span>停</span>
          </button>
        )}
      </div>

      {micLive && micInterim && (
        <div className="live-mic-interim" role="status" aria-live="polite">
          <span className="live-dot is-mic" aria-hidden="true" />
          <span>正在听：{micInterim}</span>
        </div>
      )}

      {sensorError && (
        <p className="live-perception-error" role="status">
          {sensorError}
        </p>
      )}
    </div>
  );

  // Persistent 0px runtime root stays mounted across ALL views so live streams
  // never stop on tab switch; chat pills portal cleanly into .composer-wrap.
  return (
    <div className={`live-perception-hud-host${activeView !== "chat" && anyLive ? " is-visible" : ""}`}>
      <video ref={screenVideoRef} className="live-perception-hidden-video" muted playsInline aria-hidden="true" />
      {(!cameraLive || !cameraPreviewOpen || activeView !== "chat" || !chatPortalTarget) && (
        <video ref={cameraVideoRef} className="live-perception-hidden-video" muted playsInline autoPlay aria-hidden="true" />
      )}
      {activeView === "chat" && chatPortalTarget
        ? createPortal(chatBarUi, chatPortalTarget)
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
          ? "摄像头权限已就绪！回到聊天页点「开镜头」即可全程跨页实时看到你。"
          : "麦克风权限已就绪！回到聊天页点「常开麦」即可免提随时开口对话。",
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
          <strong>实时多模态感知中心（屏幕 · 应用 · 镜头 · 语音）</strong>
          <span>用户授权即跨页全程生效 · 重启自动恢复</span>
        </div>
      </div>
      <p>
        打开任意一项权限后，你可以在顶部感知条随时开关「看屏幕 / 应用感知 / 开镜头 / 常开麦」；切换页面也不会中断，下次打开 App 也会按已授权限自动续连，随时可一键暂停或关闭。
      </p>
      <div className="live-perception-status-grid">
        <div className="live-perception-status-item">
          <strong>屏幕捕获</strong>
          <small>
            {isNative
              ? screenGlanceState?.active
                ? "Android 系统共享运行中"
                : "未开启（点击下方或聊天顶部「看屏幕」授权）"
              : "支持桌面/网页持续共享屏幕"}
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
                ? "已授权 · 每 25 秒实时同步前台应用"
                : "需开启开关并授予系统使用情况访问权限"
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
          <strong>摄像头视觉</strong>
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
          <strong>麦克风常驻聆听</strong>
          <small>
            模式：{prefs.micMode === "vad-voice" ? "声纹直听（情绪感知）" : "自动（转写/声纹兜底）"} · 说完后：{prefs.micAutoSend ? "自动发" : "填入框"}
          </small>
          <div className="live-perception-inline-btns">
            <button type="button" onClick={() => void testMediaPermission("mic")}>
              检查/申请麦克风权限
            </button>
            <button
              type="button"
              onClick={() =>
                savePref({
                  micMode: prefs.micMode === "vad-voice" ? "auto" : "vad-voice",
                })
              }
            >
              {prefs.micMode === "vad-voice" ? "切回自动模式" : "改为声纹直听"}
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
