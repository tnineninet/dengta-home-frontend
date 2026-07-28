import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { API_BASE_URL, apiRequest, streamChat } from "./api";
import OmbreMemories from "./OmbreMemories";
import CompanionStatus from "./CompanionStatus";
import AmbientContextBadge from "./AmbientContextBadge";
import ChatMessage from "./ChatMessage";
import McpDeviceCenter from "./McpDeviceCenter";
import AiProviderCenter from "./AiProviderCenter";
import CompanionDiary from "./CompanionDiary";
import CompanionProfile from "./CompanionProfile";
import CelestialBackdrop from "./CelestialBackdrop";
import ThemeStudio from "./ThemeStudio";
import { AuthenticatedImage } from "./PrivateMedia";
import { SelectedAttachmentStrip } from "./ChatMessageExtras";
import {
  attachmentKind,
  createAttachmentDraft,
  draftsForLocalMessage,
  normalizeAttachmentFile,
  revokeAttachmentDraft,
  restoreAttachmentDrafts,
  shouldRestoreAttachmentDrafts,
  validateAttachmentFiles,
} from "./chat-attachments";
import {
  chooseChatModel,
  migrateLegacyChatModelToSession,
  readServerSessionChatModel,
  readStoredSessionChatModel,
  reconcileModelCatalog,
  storeSessionChatModel,
} from "./chat-models";
import {
  shouldSubmitComposerKeyDown,
  transitionComposerOverlays,
} from "./composer-interactions";
import {
  pendingAutosaveAfterFailure,
  shouldFlushSettingsForLifecycle,
  shouldScheduleSettingsOnViewChange,
} from "./settings-autosave";
import {
  canRetryChatClientMessage,
  clearChatClientMessage,
  isChatGenerationInProgress,
  resolveChatClientMessage,
  restoreChatRetryText,
  updateChatClientMessage,
} from "./chat-idempotency";
import {
  applyStoredMessageReferences,
  attachMessageReference,
  clearStoredMessageReferencesForSession,
  createMessageReference,
  normalizeMessageReference,
  storeMessageReferenceForMessage,
} from "./message-reference";
import {
  attachThinkingTrace,
  appendThinkingSummary,
  appendThinkingStatus,
  mergeStreamedAssistantMessage,
} from "./chat-thinking";
import { hydrateChatHistory } from "./chat-history";
import {
  captureChatScrollState,
  restoreChatScrollState,
} from "./chat-scroll-state";
import {
  COMPANION_INTERACTION_TYPES,
  enqueueCompanionInteraction,
} from "./companion-interaction";
import {
  companionStatusForRequest,
  mergeCompanionStatus,
  readCompanionInteractionStats,
  readCompanionStatus,
  recordCompanionInteraction,
  saveCompanionInteractionStats,
  saveCompanionStatus,
} from "./companion-status";
import {
  PROMPT_FIELD_LIMITS,
  createSettingsPayload,
  emptySettings,
  formatPromptReceiptProvider,
  normalizePromptReceipt,
  normalizeSettingsDraft,
  settingsNeedsUnifiedPromptMigration,
  settingsPayloadFingerprint,
} from "./settings";
import { readReplySuggestions } from "./chat-reply-suggestions";
import {
  readCachedCoordinates,
  SHANGHAI_TIME_ZONE,
} from "./ambient-context";
import { installInnerHeightViewportFallback } from "./mobile-viewport";
import { toggleMomentLikeOptimistically } from "./moment-like";
import {
  STARTUP_REQUEST_OPTIONS,
  createStartupReconnectController,
  mergeRecoveredStartupData,
} from "./startup-reconnect";
import {
  VOICE_MAX_DURATION_MS,
  VOICE_PLAYBACK_MODES,
  VOICE_STATES,
  VOICE_STATE_LABELS,
  buildVoiceTurnFormData,
  createVoiceTurnRequest,
  formatVoiceConfidence,
  normalizeVoiceAnalysis,
  normalizeVoicePlaybackMode,
  resolveVoiceCaptureAfterPermission,
  selectRecorderMimeType,
  speakVoiceText,
  stopVoiceSpeech,
  validateVoiceDuration,
  voiceCaptureErrorMessage,
  voiceRecordingSupported,
} from "./voice";
import {
  SERVICE_LINKS,
  buildServiceStatusCards,
  describeExpressiveTts,
  describeGroqExpiry,
  readGroqExpiryDate,
  storeGroqExpiryDate,
} from "./service-status";
import { useDengTaTheme } from "./dengta-theme";

const PUSH_CURSOR_KEY = "dengta_push_cursor";
const PUSH_SEEN_IDS_KEY = "dengta_push_seen_ids";
const PUSH_POLL_INTERVAL_MS = 2 * 60 * 1000;
const MOMENTS_POLL_INTERVAL_MS = 15 * 1000;
const EMOTION_UNDERSTANDING_KEY = "dengta_emotion_understanding_enabled";
const COMPANION_INTERACTION_DEBOUNCE_MS = 220;
const COMPANION_INTERACTION_RATE_LIMIT = 6;
const COMPANION_INTERACTION_RATE_WINDOW_MS = 60 * 1000;
const LOCAL_NOTIFICATION_CHANNEL_ID = "dengta-home-reminders-v1";
const PROMPT_RECEIPT_STORAGE_KEY = "dengta_prompt_receipt_v1";
const VOICE_PLAYBACK_MODE_KEY = "dengta_voice_playback_mode";
const SETTINGS_SAVE_RETRY_DELAYS_MS = [1200, 3500, 8000];

function shanghaiClientTime(value = new Date()) {
  return value.toLocaleString("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    hour12: false,
  });
}

const initialNotificationPermissionState = {
  status: "idle",
  message: "开启主动消息后，Android App 会自动准备通知权限和后台检查。",
};

async function prepareLocalNotificationPermission() {
  if (!Capacitor.isNativePlatform()) {
    return {
      status: "web",
      message:
        "网页会同步主动消息；锁屏通知由安装在手机上的 Android App 接收。",
    };
  }

  if (!Capacitor.isPluginAvailable("LocalNotifications")) {
    return {
      status: "error",
      message: "当前安装包缺少通知插件，请安装最新 Android 版本。",
    };
  }

  try {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") {
      permission = await LocalNotifications.requestPermissions();
    }
    if (permission.display !== "granted") {
      return {
        status: "error",
        message:
          "通知权限没有开启。请到“手机设置 → 应用 → DengTa home → 通知”中允许通知。",
      };
    }

    const enabled = await LocalNotifications.areEnabled();
    if (!enabled.value) {
      return {
        status: "error",
        message:
          "手机系统仍在拦截通知。请到 DengTa home 的系统通知设置中打开总开关。",
      };
    }

    if (Capacitor.getPlatform() === "android") {
      await LocalNotifications.createChannel({
        id: LOCAL_NOTIFICATION_CHANNEL_ID,
        name: "DengTa home 主动消息",
        description: "AI 伙伴在合适时间主动想说的话",
        importance: 4,
        visibility: 1,
      });
    }

    return {
      status: "success",
      message:
        "主动通知已准备好。App 退到后台后会由手机系统定期检查，不需要再点测试按钮。",
    };
  } catch (error) {
    return {
      status: "error",
      message: `通知准备失败：${error?.message || "手机通知插件返回了未知错误"}`,
    };
  }
}

function readPromptReceipt() {
  try {
    const stored = localStorage.getItem(PROMPT_RECEIPT_STORAGE_KEY);
    return stored ? normalizePromptReceipt(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

function storePromptReceipt(receipt) {
  try {
    localStorage.setItem(PROMPT_RECEIPT_STORAGE_KEY, JSON.stringify(receipt));
  } catch {
    // 本地存储不可用时，只影响重启后的回执显示。
  }
}

const navItems = [
  { id: "chat", icon: "⌁", label: "Chat" },
  { id: "moments", icon: "◌", label: "Moments" },
  { id: "diary", icon: "▱", label: "Diary" },
  { id: "memories", icon: "◇", label: "Memory" },
];

function formatDateTime(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function readSeenPushIds() {
  try {
    const value = JSON.parse(localStorage.getItem(PUSH_SEEN_IDS_KEY) || "[]");
    return Array.isArray(value) ? value.filter(Boolean).slice(-200) : [];
  } catch {
    return [];
  }
}

function readEmotionUnderstandingSetting() {
  try {
    const stored = localStorage.getItem(EMOTION_UNDERSTANDING_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function readVoicePlaybackMode() {
  try {
    const stored = localStorage.getItem(VOICE_PLAYBACK_MODE_KEY);
    return normalizeVoicePlaybackMode(stored);
  } catch {
    return VOICE_PLAYBACK_MODES.off;
  }
}

function voiceInputBusy(state) {
  return [
    VOICE_STATES.requesting,
    VOICE_STATES.recording,
    VOICE_STATES.uploading,
    VOICE_STATES.thinking,
  ].includes(state);
}

function createCompanionInteractionEventId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  );
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片压缩失败，请换一张图片重试。"));
      },
      type,
      quality,
    );
  });
}

async function prepareImageUpload(file) {
  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];

  if (!supportedTypes.includes(file.type)) {
    throw new Error("图片只支持 JPG、PNG、WebP 或 GIF。");
  }

  if (file.type === "image/gif") {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("GIF 图片必须小于 5MB。");
    }
    return {
      name: file.name,
      type: file.type,
      blob: file,
      warning: `${file.name} 是 GIF，为保留动画不会重新编码，文件内可能仍含拍摄设备等元数据。`,
    };
  }

  if (file.size > 15 * 1024 * 1024) {
    throw new Error("相机原图不能超过 15MB。");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("这张图片无法安全重新编码。为避免保留照片元数据，请换一张图片。");
  }

  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1800 / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    throw new Error("浏览器无法处理这张图片，请换一张重试。");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const compressed = await canvasToBlob(canvas, "image/jpeg", 0.82);
  if (compressed.size > 5 * 1024 * 1024) {
    throw new Error("图片压缩后仍超过 5MB，请换一张较小的图片。");
  }

  return {
    name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
    type: "image/jpeg",
    blob: compressed,
    warning: "",
  };
}

async function prepareMomentImage(file) {
  const prepared = await prepareImageUpload(file);
  const dataUrl = await readFileAsDataUrl(prepared.blob);
  return {
    name: prepared.name,
    type: prepared.type,
    data: dataUrl.split(",")[1] || "",
    preview: dataUrl,
    warning: prepared.warning || "",
  };
}

async function prepareChatAttachmentFile(file) {
  const normalizedFile = normalizeAttachmentFile(file);
  if (attachmentKind(normalizedFile) !== "image") {
    return { file: normalizedFile, warning: "" };
  }
  const prepared = await prepareImageUpload(normalizedFile);
  return {
    file:
      prepared.blob === normalizedFile
        ? normalizedFile
        : new File([prepared.blob], prepared.name, {
            type: prepared.type,
            lastModified: Date.now(),
          }),
    warning: prepared.warning || "",
  };
}

function releaseChatRequestAttachments(request) {
  if (!request || request.attachmentsReleased) return;
  request.attachments.forEach((item) => revokeAttachmentDraft(item));
  request.attachmentsReleased = true;
}

function abortChatRequest(requestRef, reason = "cancelled") {
  const request = requestRef.current;
  if (!request || request.controller.signal.aborted) return;
  request.cancelReason = reason;
  request.controller.abort(reason);
  if (reason !== "view-change") {
    releaseChatRequestAttachments(request);
  }
}

function hydrateSessionChatHistory(messages, sessionId) {
  return applyStoredMessageReferences(hydrateChatHistory(messages), sessionId);
}

function App({ accountControl = null }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [messageReference, setMessageReference] = useState(null);
  const [turnContext, setTurnContext] = useState("");
  const [chatAttachments, setChatAttachments] = useState([]);
  const [attachmentSafetyEnabled, setAttachmentSafetyEnabled] = useState(true);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedChatModel, setSelectedChatModel] = useState("");
  const [modelsLoadMessage, setModelsLoadMessage] = useState("");
  const [settings, setSettings] = useState(emptySettings);
  const [draftSettings, setDraftSettings] = useState(emptySettings);
  const [activeView, setActiveView] = useState("chat");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [celestialCoordinates, setCelestialCoordinates] = useState(
    () => readCachedCoordinates().coordinates,
  );
  const {
    preferences: themePreferences,
    snapshot: celestialSnapshot,
    updateTheme,
  } = useDengTaTheme(celestialCoordinates);
  const [memories, setMemories] = useState([]);
  const [moments, setMoments] = useState([]);
  const [momentsAvailable, setMomentsAvailable] = useState(null);
  const [momentDraft, setMomentDraft] = useState("");
  const [momentImages, setMomentImages] = useState([]);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isCompanionResponding, setIsCompanionResponding] = useState(false);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [settingsAutosaveState, setSettingsAutosaveState] = useState("idle");
  const [settingsSaveError, setSettingsSaveError] = useState("");
  const [settingsSaveReceipt, setSettingsSaveReceipt] = useState(null);
  const [lastPromptReceipt, setLastPromptReceipt] = useState(readPromptReceipt);
  const [notificationPermissionState, setNotificationPermissionState] = useState(
    initialNotificationPermissionState,
  );
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isPostingMoment, setIsPostingMoment] = useState(false);
  const [pendingMomentLikes, setPendingMomentLikes] = useState({});
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [startupConnection, setStartupConnection] = useState({
    status: "connecting",
    failureCount: 0,
    nextRetryDelayMs: null,
    lastError: null,
  });
  const [emotionUnderstandingEnabled, setEmotionUnderstandingEnabled] =
    useState(readEmotionUnderstandingSetting);
  const [voiceState, setVoiceState] = useState(VOICE_STATES.idle);
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const [voiceError, setVoiceError] = useState("");
  const [voiceTapToSend, setVoiceTapToSend] = useState(false);
  const [lastVoiceAnalysis, setLastVoiceAnalysis] = useState(null);
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isStatusPanelExpanded, setIsStatusPanelExpanded] = useState(false);
  const [statusPanelCloseRequest, setStatusPanelCloseRequest] = useState(0);
  const [voicePlaybackMode, setVoicePlaybackMode] = useState(
    readVoicePlaybackMode,
  );
  const [voiceService, setVoiceService] = useState({
    checked: false,
    available: false,
    message: "正在检查服务器语音能力…",
    expressiveAvailable: false,
    expressiveApiKeyConfigured: null,
    expressiveVoiceConfigured: null,
    expressiveProvider: "none",
  });
  const [serviceHealth, setServiceHealth] = useState({
    checking: true,
    data: null,
    error: "",
    checkedAt: "",
  });
  const [groqExpiryDate, setGroqExpiryDate] = useState(readGroqExpiryDate);
  const [companionStatus, setCompanionStatus] = useState(readCompanionStatus);
  const [companionInteractionStats, setCompanionInteractionStats] = useState(
    readCompanionInteractionStats,
  );
  const messageListRef = useRef(null);
  const messageScrollIdleTimerRef = useRef(null);
  const chatScrollStatesRef = useRef(new Map());
  const pendingChatScrollRestoreRef = useRef(null);
  const messageEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const composerMenuTriggerRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const chatFileInputRef = useRef(null);
  const chatImageInputRef = useRef(null);
  const chatVideoInputRef = useRef(null);
  const chatAttachmentsRef = useRef([]);
  const streamThinkingRef = useRef({
    statuses: [],
    summary: "",
    lastReasoningSource: "",
  });
  const activeSessionIdRef = useRef(null);
  const messagesSessionIdRef = useRef(null);
  const messageLoadTokenRef = useRef(0);
  const streamingSessionIdRef = useRef(null);
  const companionStatusRef = useRef(companionStatus);
  const environmentContextRef = useRef({});
  const turnContextRef = useRef("");
  const companionInteractionStatsRef = useRef(companionInteractionStats);
  const companionInteractionHandlerRef = useRef(null);
  const companionInteractionQueueRef = useRef([]);
  const companionInteractionTimerRef = useRef(null);
  const companionInteractionInFlightRef = useRef(false);
  const companionReplyTimesRef = useRef([]);
  const isSendingRef = useRef(false);
  const voiceStateRef = useRef(VOICE_STATES.idle);
  const voicePointerHeldRef = useRef(false);
  const voicePointerIdRef = useRef(null);
  const voiceTapToSendRef = useRef(false);
  const voiceCaptureRunRef = useRef(0);
  const voicePermissionReadyRef = useRef(false);
  const voiceStreamRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStartedAtRef = useRef(0);
  const voiceElapsedTimerRef = useRef(null);
  const voiceMaxTimerRef = useRef(null);
  const voiceRequestRef = useRef(null);
  const chatRequestRef = useRef(null);
  const pendingChatClientMessageRef = useRef(null);
  const createSessionPendingRef = useRef(false);
  const pendingMomentLikesRef = useRef({});
  const draftSettingsRef = useRef(draftSettings);
  const hasLoadedSettingsRef = useRef(false);
  const confirmedSettingsRef = useRef(settings);
  const latestDraftFingerprintRef = useRef("");
  const lastSavedSettingsFingerprintRef = useRef("");
  const settingsAutosaveTimerRef = useRef(null);
  const pendingSettingsSaveRef = useRef(null);
  const settingsSaveInFlightRef = useRef(false);
  const settingsSaveRunRef = useRef(null);
  const settingsSaveRetryTimerRef = useRef(null);
  const settingsSaveRetryCountRef = useRef(0);
  const settingsSaveFailureRef = useRef(false);
  const settingsLifecycleFlushPendingRef = useRef(false);
  const flushLatestSettingsDraftRef = useRef(() => Promise.resolve(true));
  const settingsMigrationPendingRef = useRef(false);
  const componentMountedRef = useRef(true);
  const startupReconnectRef = useRef(null);
  const sessionModelSaveQueueRef = useRef(Promise.resolve());
  const speechRunRef = useRef(0);
  const voiceLifecycleRef = useRef({ cancel() {}, stopPlayback() {} });

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const isVoiceInputBusy = voiceInputBusy(voiceState);
  const voiceServiceAvailable = voiceService.available;
  const voiceAutoSpeakEnabled =
    voicePlaybackMode === VOICE_PLAYBACK_MODES.expressive &&
    voiceService.expressiveAvailable;
  const activeChatModel = selectedChatModel || settings.model;
  const chatRetryReady = canRetryChatClientMessage(
    pendingChatClientMessageRef.current,
    {
      sessionId: activeSessionId,
      message: message.trim(),
      turnContext: turnContext.trim(),
      messageReference,
      attachments: chatAttachments,
      attachmentInstructionMode: attachmentSafetyEnabled
        ? "untrusted"
        : "system",
    },
  );
  const chatRetryIsProcessing =
    chatRetryReady &&
    pendingChatClientMessageRef.current?.generationInProgress === true;

  const loadAmbientWeather = useCallback(async ({ latitude, longitude }) => {
    const data = await apiRequest("/api/weather/current", {
      method: "POST",
      body: JSON.stringify({ latitude, longitude }),
      timeoutMs: 8_000,
    });
    return data?.weather || data;
  }, []);

  const handleAmbientContextChange = useCallback((context) => {
    environmentContextRef.current =
      context && typeof context === "object" ? context : {};
  }, []);

  const handleImagePreview = useCallback((url, alt) => {
    setImageViewer({ url, alt });
  }, []);

  const handleCompanionInteraction = useCallback(
    (zoneId) => companionInteractionHandlerRef.current?.(zoneId),
    [],
  );

  const requestStatusPanelClose = useCallback(() => {
    setIsStatusPanelExpanded(false);
    setStatusPanelCloseRequest((current) => current + 1);
  }, []);

  const handleStatusPanelExpandedChange = useCallback((expanded) => {
    const next = transitionComposerOverlays(
      {
        statusExpanded: expanded,
        composerMenuOpen: false,
      },
      expanded ? "open-status" : "close-status",
    );
    setIsStatusPanelExpanded(next.statusExpanded);
    if (next.statusExpanded) setIsComposerMenuOpen(next.composerMenuOpen);
  }, []);

  const closeComposerMenu = useCallback((restoreFocus = false) => {
    setIsComposerMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => composerMenuTriggerRef.current?.focus());
    }
  }, []);

  const toggleComposerMenu = useCallback(() => {
    setIsComposerMenuOpen((current) => {
      const action = current ? "close-composer-menu" : "open-composer-menu";
      const next = transitionComposerOverlays(
        {
          statusExpanded: isStatusPanelExpanded,
          composerMenuOpen: current,
        },
        action,
      );
      if (!current && !next.statusExpanded) {
        setStatusPanelCloseRequest((request) => request + 1);
        setIsStatusPanelExpanded(false);
      }
      return next.composerMenuOpen;
    });
  }, [isStatusPanelExpanded]);

  useEffect(
    () => () => window.clearTimeout(messageScrollIdleTimerRef.current),
    [],
  );

  useEffect(() => {
    if (!isComposerMenuOpen) return undefined;

    function closeComposerMenuFromEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeComposerMenu(true);
    }

    document.addEventListener("keydown", closeComposerMenuFromEscape);
    return () =>
      document.removeEventListener("keydown", closeComposerMenuFromEscape);
  }, [closeComposerMenu, isComposerMenuOpen]);

  const refreshServiceHealth = useCallback(async () => {
    setServiceHealth((current) => ({
      ...current,
      checking: true,
      error: "",
    }));

    try {
      const data = await apiRequest("/health");
      if (!componentMountedRef.current) return;
      const available = data?.features?.hervoice_proxy_configured === true;
      const expressiveAvailable =
        data?.features?.expressive_tts_configured === true;
      const expressiveApiKeyConfigured =
        typeof data?.features?.expressive_tts_api_key_configured === "boolean"
          ? data.features.expressive_tts_api_key_configured
          : null;
      const expressiveVoiceConfigured =
        typeof data?.features?.expressive_tts_voice_configured === "boolean"
          ? data.features.expressive_tts_voice_configured
          : null;
      setVoiceService({
        checked: true,
        available,
        message: available
          ? "语音理解服务已连接。"
          : "服务器尚未配置语音理解服务。麦克风和音频附件暂不可用；图片与文档仍可正常发送。",
        expressiveAvailable,
        expressiveApiKeyConfigured,
        expressiveVoiceConfigured,
        expressiveProvider:
          data?.features?.expressive_tts_provider || "none",
      });
      setServiceHealth({
        checking: false,
        data,
        error: "",
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!componentMountedRef.current) return;
      setVoiceService({
        checked: true,
        available: false,
        message:
          "暂时无法确认服务器语音能力。为避免录音后发送失败，麦克风和音频附件已停用；图片与文档不受影响。",
        expressiveAvailable: false,
        expressiveApiKeyConfigured: null,
        expressiveVoiceConfigured: null,
        expressiveProvider: "none",
      });
      setServiceHealth((current) => ({
        ...current,
        checking: false,
        error: error?.message || "服务器状态检查失败",
        checkedAt: new Date().toISOString(),
      }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    function applyInitialModelCatalog(data, fallbackModel = "") {
      if (cancelled) return;
      const catalog = reconcileModelCatalog(data, {
        previous: readStoredSessionChatModel(activeSessionIdRef.current),
        fallback: fallbackModel,
      });
      setAvailableModels(catalog.models);
      setSelectedChatModel(
        chooseChatModel({
          models: catalog.models,
          stored: readStoredSessionChatModel(activeSessionIdRef.current),
          current: fallbackModel,
          fallback: catalog.currentModel,
        }),
      );
    }

    async function loadInitialModels(fallbackModel = "") {
      const pendingSelection = chooseChatModel({
        models: [],
        stored: readStoredSessionChatModel(activeSessionIdRef.current),
        current: fallbackModel,
      });
      if (!cancelled) setSelectedChatModel(pendingSelection);
      try {
        const data = await apiRequest("/models");
        applyInitialModelCatalog(data, fallbackModel);
        if (!cancelled) setModelsLoadMessage("");
      } catch {
        if (!cancelled) {
          setModelsLoadMessage(
            fallbackModel
              ? "模型列表暂时无法读取，仍会使用当前已保存的模型。"
              : "模型列表暂时无法读取，将由服务器选择默认模型。",
          );
        }
      }
    }

    async function loadInitialData() {
      const [settingsData, sessionsData] = await Promise.all([
        apiRequest("/api/v2/settings", STARTUP_REQUEST_OPTIONS),
        apiRequest("/api/v2/sessions", STARTUP_REQUEST_OPTIONS),
      ]);

      if (cancelled) return null;
      const migrationNeeded = settingsNeedsUnifiedPromptMigration(
        settingsData.settings,
      );
      const nextSettings = normalizeSettingsDraft(settingsData.settings);
      const nextSessions = sessionsData.sessions || [];
      const settingsFingerprint = settingsPayloadFingerprint(nextSettings);
      const hadLoadedSettings = hasLoadedSettingsRef.current;
      const hasUnsavedSettingsDraft =
        hadLoadedSettings &&
        latestDraftFingerprintRef.current !==
          lastSavedSettingsFingerprintRef.current;
      const recovered = mergeRecoveredStartupData(
        { activeSessionId: activeSessionIdRef.current },
        { settings: nextSettings, sessions: nextSessions },
      );

      confirmedSettingsRef.current = nextSettings;
      if (!hasUnsavedSettingsDraft) {
        draftSettingsRef.current = nextSettings;
        latestDraftFingerprintRef.current = settingsFingerprint;
        setDraftSettings(nextSettings);
      }
      lastSavedSettingsFingerprintRef.current = migrationNeeded
        ? ""
        : settingsFingerprint;
      settingsMigrationPendingRef.current = migrationNeeded;
      setSettings(nextSettings);
      setHasLoadedSettings(true);
      setSettingsAutosaveState(hasUnsavedSettingsDraft ? "pending" : "saved");
      setSessions(recovered.sessions);
      activeSessionIdRef.current = recovered.activeSessionId;
      const serverSessionModel = readServerSessionChatModel(
        recovered.sessions,
        recovered.activeSessionId,
      );
      if (serverSessionModel) {
        storeSessionChatModel(recovered.activeSessionId, serverSessionModel);
      } else {
        migrateLegacyChatModelToSession(recovered.activeSessionId);
      }
      setActiveSessionId(recovered.activeSessionId);
      hasLoadedSettingsRef.current = true;
      setIsLoading(false);
      void loadInitialModels(nextSettings.model);
      void refreshServiceHealth();
      return { settings: nextSettings, sessions: nextSessions };
    }

    const reconnectController = createStartupReconnectController({
      attempt: loadInitialData,
      onStateChange(nextState) {
        if (cancelled) return;
        setStartupConnection(nextState);
        if (nextState.status === "waiting") setIsLoading(false);
      },
    });
    startupReconnectRef.current = reconnectController;
    void reconnectController.start();
    return () => {
      cancelled = true;
      reconnectController.stop();
      if (startupReconnectRef.current === reconnectController) {
        startupReconnectRef.current = null;
      }
    };
  }, [refreshServiceHealth]);

  useEffect(() => {
    if (
      !hasLoadedSettings ||
      !settingsMigrationPendingRef.current
    ) {
      return;
    }
    settingsMigrationPendingRef.current = false;
    scheduleSettingsAutosave(draftSettingsRef.current, { immediate: true });
    // This migration is intentionally armed only by the initial settings load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedSettings]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    const savedScrollState = chatScrollStatesRef.current.get(
      activeSessionId || "__draft__",
    );
    shouldAutoScrollRef.current =
      savedScrollState?.pinnedToBottom ?? true;
    setMessageReference(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!hasLoadedSettingsRef.current) return;
    const serverModel = readServerSessionChatModel(sessions, activeSessionId);
    if (serverModel) {
      storeSessionChatModel(activeSessionId, serverModel);
    }
    const stored =
      serverModel || readStoredSessionChatModel(activeSessionId);
    setSelectedChatModel(
      chooseChatModel({
        models: availableModels,
        stored,
        current: settings.model,
        fallback: availableModels[0]?.id || "",
      }),
    );
  }, [activeSessionId, availableModels, sessions, settings.model]);

  useEffect(() => {
    chatAttachmentsRef.current = chatAttachments;
  }, [chatAttachments]);

  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
      hasLoadedSettingsRef.current = false;
      window.clearTimeout(settingsSaveRetryTimerRef.current);
      abortChatRequest(chatRequestRef, "component-unmount");
      releaseChatRequestAttachments(chatRequestRef.current);
      chatRequestRef.current = null;
      chatAttachmentsRef.current.forEach((item) =>
        revokeAttachmentDraft(item),
      );
      chatAttachmentsRef.current = [];
      window.clearTimeout(settingsAutosaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    companionStatusRef.current = companionStatus;
    saveCompanionStatus(companionStatus);
  }, [companionStatus]);

  useEffect(() => {
    companionInteractionStatsRef.current = companionInteractionStats;
    saveCompanionInteractionStats(companionInteractionStats);
  }, [companionInteractionStats]);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    if (
      activeView !== "chat" &&
      [VOICE_STATES.requesting, VOICE_STATES.recording].includes(
        voiceStateRef.current,
      )
    ) {
      voiceLifecycleRef.current.cancel({
        message: "离开聊天页后，录音已取消，原始语音没有保存或发送。",
      });
    }
    if (
      activeView !== "chat" &&
      voiceStateRef.current === VOICE_STATES.speaking
    ) {
      void voiceLifecycleRef.current.stopPlayback();
    }
  }, [activeView]);

  useEffect(() => {
    function releaseVoiceWhenPageLeaves() {
      if (document.visibilityState === "hidden") {
        voiceLifecycleRef.current.cancel({ updateState: false });
        void voiceLifecycleRef.current.stopPlayback({ updateState: false });
      }
    }

    function releaseVoiceOnPageHide() {
      abortChatRequest(chatRequestRef, "pagehide");
      voiceLifecycleRef.current.cancel({ updateState: false });
      voiceRequestRef.current?.abort();
      voiceRequestRef.current = null;
      void voiceLifecycleRef.current.stopPlayback({ updateState: false });
    }

    document.addEventListener("visibilitychange", releaseVoiceWhenPageLeaves);
    window.addEventListener("pagehide", releaseVoiceOnPageHide);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        releaseVoiceWhenPageLeaves,
      );
      window.removeEventListener("pagehide", releaseVoiceOnPageHide);
      releaseVoiceOnPageHide();
    };
  }, []);

  useEffect(
    () => () => window.clearTimeout(companionInteractionTimerRef.current),
    [],
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let listener;
    LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (event) => {
        const sessionId = event.notification.extra?.sessionId;
        if (!sessionId) return;

        activeSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        setActiveView("chat");
        setIsSidebarOpen(false);
      },
    ).then((handle) => {
      listener = handle;
    });

    return () => {
      listener?.remove();
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedSettings || settings.push_enabled !== true) {
      setNotificationPermissionState(initialNotificationPermissionState);
      return undefined;
    }

    let cancelled = false;
    setNotificationPermissionState({
      status: "checking",
      message: "正在自动检查手机通知权限…",
    });
    void prepareLocalNotificationPermission().then((result) => {
      if (!cancelled) setNotificationPermissionState(result);
    });

    return () => {
      cancelled = true;
    };
  }, [hasLoadedSettings, settings.push_enabled]);

  useEffect(() => {
    if (settings.push_enabled !== true) return undefined;

    let cancelled = false;
    let pollInFlight = false;
    let timerId;

    if (!localStorage.getItem(PUSH_CURSOR_KEY)) {
      localStorage.setItem(PUSH_CURSOR_KEY, new Date().toISOString());
    }

    async function pollPushMessages() {
      if (cancelled || pollInFlight || !navigator.onLine) return;

      const since = localStorage.getItem(PUSH_CURSOR_KEY);
      if (!since) return;

      pollInFlight = true;
      try {
        const data = await apiRequest(
          `/api/v2/push/messages?since=${encodeURIComponent(since)}&limit=50`,
        );
        if (cancelled) return;

        const seenIds = readSeenPushIds();
        const seenSet = new Set(seenIds);
        const incoming = (data.messages || []).filter(
          (item) => item.id && !seenSet.has(item.id),
        );
        const allMessages = data.messages || [];
        const latest = allMessages.at(-1);

        if (latest?.created_at) {
          localStorage.setItem(PUSH_CURSOR_KEY, latest.created_at);
        }

        if (incoming.length === 0) return;

        const nextSeenIds = [
          ...seenIds,
          ...incoming.map((item) => item.id),
        ].slice(-200);
        localStorage.setItem(PUSH_SEEN_IDS_KEY, JSON.stringify(nextSeenIds));

        const currentSessionId = activeSessionIdRef.current;
        const sessionsData = await apiRequest("/api/v2/sessions");
        if (!cancelled) setSessions(sessionsData.sessions || []);

        if (
          currentSessionId &&
          !streamingSessionIdRef.current &&
          incoming.some((item) => item.conversation_id === currentSessionId)
        ) {
          const history = await apiRequest(
            `/api/v2/sessions/${currentSessionId}/messages`,
          );
          if (!cancelled && activeSessionIdRef.current === currentSessionId) {
            setMessages(
              hydrateSessionChatHistory(history.messages, currentSessionId),
            );
          }
        }

        // 前台只同步聊天记录；Android 原生 WorkManager 负责后台通知，
        // 避免 WebView 和原生后台任务对同一条消息重复弹窗。
      } catch (error) {
        console.warn("主动消息检查失败：", error.message);
      } finally {
        pollInFlight = false;
      }
    }

    async function runAndScheduleNext() {
      await pollPushMessages();
      if (!cancelled) {
        timerId = window.setTimeout(
          runAndScheduleNext,
          PUSH_POLL_INTERVAL_MS,
        );
      }
    }

    function pollWhenVisible() {
      if (document.visibilityState === "visible") {
        void pollPushMessages();
      }
    }

    void runAndScheduleNext();
    document.addEventListener("visibilitychange", pollWhenVisible);
    window.addEventListener("online", pollWhenVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", pollWhenVisible);
      window.removeEventListener("online", pollWhenVisible);
    };
  }, [settings.ai_name, settings.push_enabled]);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      if (!activeSessionId) {
        messagesSessionIdRef.current = null;
        messageLoadTokenRef.current += 1;
        setMessages([]);
        return;
      }

      if (
        streamingSessionIdRef.current === activeSessionId &&
        messagesSessionIdRef.current === activeSessionId
      ) {
        return;
      }

      const loadToken = messageLoadTokenRef.current + 1;
      messageLoadTokenRef.current = loadToken;
      messagesSessionIdRef.current = activeSessionId;
      setMessages([]);

      try {
        const data = await apiRequest(
          `/api/v2/sessions/${activeSessionId}/messages`,
        );
        if (
          !cancelled &&
          messageLoadTokenRef.current === loadToken &&
          activeSessionIdRef.current === activeSessionId
        ) {
          setMessages(
            hydrateSessionChatHistory(data.messages, activeSessionId),
          );
        }
      } catch (error) {
        if (!cancelled) setNotice(error.message);
      }
    }

    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (activeView === "memories") {
      apiRequest("/api/v2/memories")
        .then((data) => setMemories(data.memories || []))
        .catch((error) => setNotice(error.message));
    }

    if (activeView === "moments") {
      void loadMoments();
      const refreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          void loadMoments({ silent: true });
        }
      }, MOMENTS_POLL_INTERVAL_MS);
      const refreshWhenVisible = () => {
        if (document.visibilityState === "visible") {
          void loadMoments({ silent: true });
        }
      };
      document.addEventListener("visibilitychange", refreshWhenVisible);
      return () => {
        window.clearInterval(refreshTimer);
        document.removeEventListener("visibilitychange", refreshWhenVisible);
      };
    }

    return undefined;
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "chat") return undefined;

    const pending = pendingChatScrollRestoreRef.current;
    if (
      pending?.sessionId === activeSessionId &&
      pending.waitForMessages &&
      messages.length === 0
    ) {
      return undefined;
    }

    let secondAnimationFrame = 0;
    let lateCorrectionTimer = 0;
    const animationFrame = window.requestAnimationFrame(() => {
      if (pending?.sessionId === activeSessionId) {
        secondAnimationFrame = window.requestAnimationFrame(() => {
          const messageList = messageListRef.current;
          if (!messageList) return;

          restoreChatScrollState(messageList, pending.snapshot);
          if (pendingChatScrollRestoreRef.current === pending) {
            pendingChatScrollRestoreRef.current = null;
          }
          lateCorrectionTimer = window.setTimeout(() => {
            restoreChatScrollState(messageListRef.current, pending.snapshot);
          }, 120);
        });
        return;
      }

      const messageList = messageListRef.current;
      if (!messageList || !shouldAutoScrollRef.current) return;
      restoreChatScrollState(messageList, {
        pinnedToBottom: true,
        scrollTop: messageList.scrollTop,
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(secondAnimationFrame);
      window.clearTimeout(lateCorrectionTimer);
    };
  }, [activeView, activeSessionId, messages, isSending]);

  function trackMessageScroll(event) {
    const messageList = event.currentTarget;
    messageList.classList.add("is-scrolling");
    window.clearTimeout(messageScrollIdleTimerRef.current);
    messageScrollIdleTimerRef.current = window.setTimeout(() => {
      messageList.classList.remove("is-scrolling");
    }, 140);
    const snapshot = captureChatScrollState(messageList);
    shouldAutoScrollRef.current = snapshot?.pinnedToBottom ?? true;
    if (snapshot) {
      chatScrollStatesRef.current.set(
        activeSessionIdRef.current || "__draft__",
        snapshot,
      );
    }
  }

  useEffect(() => {
    function handleInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }

    function handleOnline() {
      setIsOnline(true);
      if (shouldFlushSettingsForLifecycle("online")) {
        window.clearTimeout(settingsSaveRetryTimerRef.current);
        settingsSaveRetryTimerRef.current = null;
        settingsSaveRetryCountRef.current = 0;
        void flushLatestSettingsDraftRef.current();
      }
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return installInnerHeightViewportFallback();

    const root = document.documentElement;
    let fullHeight = Math.max(
      window.innerHeight,
      viewport.height + viewport.offsetTop,
    );
    let viewportWidth = viewport.width || window.innerWidth;

    function editableElementIsFocused() {
      const activeElement = document.activeElement;
      return Boolean(
        activeElement instanceof HTMLElement &&
          (activeElement.matches("input, textarea, select") ||
            activeElement.isContentEditable),
      );
    }

    function fitViewport() {
      const visibleBottom = viewport.height + viewport.offsetTop;
      const nextViewportWidth = viewport.width || window.innerWidth;
      if (Math.abs(nextViewportWidth - viewportWidth) > 48) {
        viewportWidth = nextViewportWidth;
        fullHeight = Math.max(window.innerHeight, visibleBottom);
      }
      const rawGap = Math.max(0, fullHeight - viewport.height);
      const keyboardOpen = editableElementIsFocused() && rawGap > 100;

      if (!keyboardOpen && rawGap <= 100) {
        fullHeight = Math.max(fullHeight, visibleBottom, window.innerHeight);
      }

      root.dataset.keyboardOpen = keyboardOpen ? "true" : "false";
      const height = keyboardOpen ? viewport.height : fullHeight;
      root.style.setProperty(
        "--app-height",
        `${Math.round(height)}px`,
      );
      if (!keyboardOpen && window.scrollY) window.scrollTo(0, 0);
    }

    fitViewport();
    viewport.addEventListener("resize", fitViewport);
    viewport.addEventListener("scroll", fitViewport);
    window.addEventListener("resize", fitViewport);
    window.addEventListener("orientationchange", fitViewport);
    document.addEventListener("focusin", fitViewport);
    document.addEventListener("focusout", fitViewport);
    return () => {
      viewport.removeEventListener("resize", fitViewport);
      viewport.removeEventListener("scroll", fitViewport);
      window.removeEventListener("resize", fitViewport);
      window.removeEventListener("orientationchange", fitViewport);
      document.removeEventListener("focusin", fitViewport);
      document.removeEventListener("focusout", fitViewport);
      delete root.dataset.keyboardOpen;
    };
  }, []);

  useEffect(() => {
    function resetSettingsLifecycleFlush() {
      settingsLifecycleFlushPendingRef.current = false;
    }

    function flushSettingsBeforePageLeaves(event) {
      if (
        event.type === "visibilitychange" &&
        document.visibilityState === "visible"
      ) {
        settingsLifecycleFlushPendingRef.current = false;
        return;
      }
      if (
        !shouldFlushSettingsForLifecycle(
          event.type,
          document.visibilityState,
        )
      ) {
        return;
      }
      if (settingsLifecycleFlushPendingRef.current) return;
      settingsLifecycleFlushPendingRef.current = true;
      void flushLatestSettingsDraftRef.current({ keepalive: true });
    }

    document.addEventListener(
      "visibilitychange",
      flushSettingsBeforePageLeaves,
    );
    window.addEventListener("pagehide", flushSettingsBeforePageLeaves);
    window.addEventListener("pageshow", resetSettingsLifecycleFlush);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        flushSettingsBeforePageLeaves,
      );
      window.removeEventListener("pagehide", flushSettingsBeforePageLeaves);
      window.removeEventListener("pageshow", resetSettingsLifecycleFlush);
    };
  }, []);

  function setVoiceMode(nextState) {
    voiceStateRef.current = nextState;
    setVoiceState(nextState);
  }

  function setVoiceTapToSendMode(enabled) {
    voiceTapToSendRef.current = enabled;
    if (componentMountedRef.current) setVoiceTapToSend(enabled);
  }

  function clearVoiceRecordingTimers() {
    window.clearInterval(voiceElapsedTimerRef.current);
    window.clearTimeout(voiceMaxTimerRef.current);
    voiceElapsedTimerRef.current = null;
    voiceMaxTimerRef.current = null;
  }

  function releaseVoiceStream(stream = voiceStreamRef.current) {
    stream?.getTracks?.().forEach((track) => track.stop());
    if (voiceStreamRef.current === stream) {
      voiceStreamRef.current = null;
    }
  }

  function setVoiceFailure(errorOrMessage) {
    const message =
      typeof errorOrMessage === "string"
        ? errorOrMessage
        : voiceCaptureErrorMessage(errorOrMessage);
    setVoiceError(message);
    setVoiceMode(VOICE_STATES.error);
    setNotice(message);
  }

  function cancelVoiceCapture({ message = "", updateState = true } = {}) {
    voiceCaptureRunRef.current += 1;
    voicePointerHeldRef.current = false;
    voicePointerIdRef.current = null;
    setVoiceTapToSendMode(false);
    clearVoiceRecordingTimers();

    const recorder = voiceRecorderRef.current;
    voiceRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // 录音器已经自行结束时，只需继续释放麦克风。
      }
    }

    voiceChunksRef.current = [];
    releaseVoiceStream();
    if (updateState) {
      setVoiceElapsedMs(0);
      setVoiceMode(VOICE_STATES.idle);
      if (message) setNotice(message);
    }
  }

  async function stopVoicePlayback({ updateState = true } = {}) {
    speechRunRef.current += 1;
    await stopVoiceSpeech();
    if (updateState && voiceStateRef.current === VOICE_STATES.speaking) {
      setVoiceMode(VOICE_STATES.idle);
    }
  }

  async function playAssistantReply(
    value,
    messageId = "",
    speechToken = "",
    sessionId = activeSessionIdRef.current,
  ) {
    if (!voiceAutoSpeakEnabled || !String(value || "").trim()) return;

    const runId = speechRunRef.current + 1;
    speechRunRef.current = runId;
    await stopVoiceSpeech();
    if (speechRunRef.current !== runId) return;

    setVoiceError("");
    setVoiceMode(VOICE_STATES.speaking);
    try {
      await speakVoiceText(value, {
        mode: VOICE_PLAYBACK_MODES.expressive,
        messageId,
        sessionId,
        speechToken,
      });
    } catch (error) {
      if (speechRunRef.current === runId) {
        setVoiceFailure(
          `自然语音播放失败，本轮只显示文字：${error?.message || "请稍后重试"}`,
        );
      }
      return;
    }

    if (speechRunRef.current === runId) {
      setVoiceMode(VOICE_STATES.idle);
    }
  }

  async function submitVoiceBlob(blob, durationMs) {
    setVoiceError("");
    setVoiceMode(VOICE_STATES.uploading);
    const turnContextDraftAtRequest = turnContextRef.current;
    const turnContextSnapshot = turnContextDraftAtRequest
      .trim()
      .slice(0, PROMPT_FIELD_LIMITS.turn_context);
    let sessionId = activeSessionIdRef.current;
    let voiceSessionId = sessionId;
    let requestHandle;
    let voiceModel =
      readStoredSessionChatModel(sessionId) ||
      selectedChatModel ||
      settings.model ||
      "";

    try {
      if (!(await flushLatestSettingsDraft())) {
        throw new Error(
          "最新角色设置还没有保存成功，语音没有发送。请恢复网络后再试一次。",
        );
      }

      if (!sessionId) {
        const created = await apiRequest("/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({ title: "语音对话" }),
        });
        sessionId = created.session.id;
        voiceSessionId = sessionId;
        setSessions((current) =>
          current.some((item) => item.id === sessionId)
            ? current
            : [created.session, ...current],
        );
        activeSessionIdRef.current = sessionId;
        messagesSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        setMessages([]);
        voiceModel = initializeSessionChatModel(sessionId);
      }

      streamingSessionIdRef.current = sessionId;
      const formData = buildVoiceTurnFormData({
        blob,
        sessionId,
        clientTime: shanghaiClientTime(),
        timezone: SHANGHAI_TIME_ZONE,
        model: voiceModel,
        emotionUnderstandingEnabled,
        companionStatus: companionStatusForRequest(
          companionStatusRef.current,
        ),
        environmentContext: environmentContextRef.current,
        turnContext: turnContextSnapshot,
      });

      requestHandle = createVoiceTurnRequest(formData, {
        onUploadComplete() {
          if (voiceRequestRef.current === requestHandle) {
            setVoiceMode(VOICE_STATES.thinking);
          }
        },
      });
      voiceRequestRef.current = requestHandle;
      const data = await requestHandle.promise;

      const responseSessionId = data.session_id || sessionId;
      voiceSessionId = responseSessionId;
      streamingSessionIdRef.current = responseSessionId;
      const serverUserMessage = data.user_message;
      const serverAssistantMessage = data.assistant_message;
      const normalizedAnalysis = normalizeVoiceAnalysis(data.voice_analysis);
      const transcript =
        normalizedAnalysis.text ||
        String(serverUserMessage?.content || "").trim();

      if (!transcript) {
        throw new Error("服务器没有返回可显示的语音转写，请重新说一次。");
      }
      if (
        !serverAssistantMessage ||
        serverAssistantMessage.role !== "assistant" ||
        typeof serverAssistantMessage.content !== "string" ||
        !serverAssistantMessage.content.trim()
      ) {
        throw new Error("服务器没有返回可播放的 AI 回复，请稍后再试。");
      }

      const voiceAnalysis = {
        ...normalizedAnalysis,
        text: transcript,
        durationMs,
      };
      const userMessage = {
        ...(serverUserMessage || {}),
        id: serverUserMessage?.id || `voice-user-${Date.now()}`,
        role: "user",
        content: transcript,
        created_at:
          serverUserMessage?.created_at || new Date().toISOString(),
        voiceAnalysis,
      };

      applyPromptReceipt(data.prompt_receipt);
      if (data.companion_status) {
        setCompanionStatus((current) =>
          mergeCompanionStatus(current, data.companion_status),
        );
      }

      activeSessionIdRef.current = responseSessionId;
      setActiveSessionId(responseSessionId);
      const messagesBelongToSession =
        messagesSessionIdRef.current === responseSessionId;
      messagesSessionIdRef.current = responseSessionId;
      messageLoadTokenRef.current += 1;
      setMessages((current) => {
        const next = messagesBelongToSession ? [...current] : [];
        for (const incoming of [userMessage, serverAssistantMessage]) {
          const index = next.findIndex((item) => item.id === incoming.id);
          if (index >= 0) next[index] = incoming;
          else next.push(incoming);
        }
        return next;
      });
      if (
        turnContextSnapshot &&
        turnContextRef.current === turnContextDraftAtRequest
      ) {
        turnContextRef.current = "";
        setTurnContext("");
      }
      setLastVoiceAnalysis(voiceAnalysis);
      setNotice(
        `语音已转写。声音情绪线索：${voiceAnalysis.emotion}，${formatVoiceConfidence(voiceAnalysis.confidence)}。这不是心理诊断。`,
      );
      try {
        await refreshSessions(responseSessionId);
      } catch (error) {
        console.warn("语音回复已保存，但刷新会话列表失败：", error.message);
      }

      if (voiceAutoSpeakEnabled) {
        await playAssistantReply(
          serverAssistantMessage.content,
          serverAssistantMessage.id,
          serverAssistantMessage.speech_token,
          responseSessionId,
        );
      } else {
        setVoiceMode(VOICE_STATES.idle);
      }
    } catch (error) {
      if (requestHandle && voiceRequestRef.current !== requestHandle) return;
      setVoiceFailure(error);
    } finally {
      if (voiceRequestRef.current === requestHandle) {
        voiceRequestRef.current = null;
      }
      if (streamingSessionIdRef.current === voiceSessionId) {
        streamingSessionIdRef.current = null;
      }
      if (
        [VOICE_STATES.uploading, VOICE_STATES.thinking].includes(
          voiceStateRef.current,
        )
      ) {
        setVoiceMode(VOICE_STATES.idle);
      }
    }
  }

  async function finishVoiceCapture({ send = true } = {}) {
    const recorder = voiceRecorderRef.current;
    if (!recorder) return;

    voiceRecorderRef.current = null;
    setVoiceTapToSendMode(false);
    clearVoiceRecordingTimers();
    const durationMs = Math.max(0, Date.now() - voiceStartedAtRef.current);

    try {
      await new Promise((resolve) => {
        if (recorder.state === "inactive") {
          resolve();
          return;
        }
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.stop();
      });
    } catch (error) {
      releaseVoiceStream();
      voiceChunksRef.current = [];
      setVoiceFailure(error);
      return;
    }

    releaseVoiceStream();
    setVoiceElapsedMs(durationMs);
    if (!send) {
      voiceChunksRef.current = [];
      setVoiceMode(VOICE_STATES.idle);
      return;
    }

    const durationCheck = validateVoiceDuration(durationMs);
    if (!durationCheck.ok) {
      voiceChunksRef.current = [];
      setVoiceFailure(durationCheck.message);
      return;
    }

    const chunks = voiceChunksRef.current;
    voiceChunksRef.current = [];
    const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      setVoiceFailure("没有收到麦克风声音，请检查权限后重试。");
      return;
    }

    await submitVoiceBlob(blob, durationMs);
  }

  async function beginVoiceCapture(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();

    if (
      voiceStateRef.current === VOICE_STATES.recording &&
      voiceTapToSendRef.current
    ) {
      voicePointerHeldRef.current = false;
      voicePointerIdRef.current = null;
      setVoiceTapToSendMode(false);
      void finishVoiceCapture({ send: true });
      return;
    }

    if (!voiceServiceAvailable) {
      setVoiceFailure(voiceService.message);
      return;
    }

    if (
      isSendingRef.current ||
      companionInteractionInFlightRef.current ||
      voiceInputBusy(voiceStateRef.current)
    ) {
      return;
    }

    if (!voiceRecordingSupported()) {
      setVoiceFailure(
        "当前浏览器或 App 不支持录音。请安装最新版 DengTa home Android App。",
      );
      return;
    }

    const captureRun = voiceCaptureRunRef.current + 1;
    voiceCaptureRunRef.current = captureRun;

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // 某些 WebView 不支持显式指针捕获，pointerup 仍会正常工作。
    }
    voicePointerHeldRef.current = true;
    voicePointerIdRef.current = event.pointerId;
    setVoiceTapToSendMode(false);
    setVoiceError("");
    setNotice("");
    setLastVoiceAnalysis(null);
    setVoiceElapsedMs(0);

    if (voiceStateRef.current === VOICE_STATES.speaking) {
      await stopVoicePlayback();
    }
    if (!voicePointerHeldRef.current) return;

    setVoiceMode(VOICE_STATES.requesting);
    const permissionWasUnconfirmed = !voicePermissionReadyRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (voiceCaptureRunRef.current !== captureRun) {
        releaseVoiceStream(stream);
        return;
      }
      voicePermissionReadyRef.current = true;
      const continuation = resolveVoiceCaptureAfterPermission(
        voicePointerHeldRef.current,
        permissionWasUnconfirmed,
      );
      if (!continuation.startRecording) {
        releaseVoiceStream(stream);
        setVoiceMode(VOICE_STATES.idle);
        return;
      }

      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      const mimeType = selectRecorderMimeType(MediaRecorder);
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      voiceRecorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (chunkEvent) => {
        if (chunkEvent.data?.size > 0) {
          voiceChunksRef.current.push(chunkEvent.data);
        }
      });
      recorder.addEventListener("error", (recorderEvent) => {
        cancelVoiceCapture({ updateState: false });
        setVoiceFailure(recorderEvent.error || recorderEvent);
      });
      recorder.start(250);

      voiceStartedAtRef.current = Date.now();
      setVoiceTapToSendMode(continuation.tapToSend);
      setVoiceMode(VOICE_STATES.recording);
      if (continuation.tapToSend) {
        setNotice("麦克风已授权并开始录音。说完后，再点击一次录音按钮发送。");
      }
      voiceElapsedTimerRef.current = window.setInterval(() => {
        setVoiceElapsedMs(Date.now() - voiceStartedAtRef.current);
      }, 200);
      voiceMaxTimerRef.current = window.setTimeout(() => {
        voicePointerHeldRef.current = false;
        void finishVoiceCapture({ send: true });
      }, VOICE_MAX_DURATION_MS);
      navigator.vibrate?.(18);
    } catch (error) {
      if (voiceCaptureRunRef.current !== captureRun) return;
      cancelVoiceCapture({ updateState: false });
      setVoiceFailure(error);
    }
  }

  function endVoiceCapture(event) {
    if (
      voicePointerIdRef.current !== null &&
      voicePointerIdRef.current !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    voicePointerHeldRef.current = false;
    voicePointerIdRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // 指针已经被 WebView 释放时无需再处理。
    }
    if (
      voiceStateRef.current === VOICE_STATES.recording &&
      voiceTapToSendRef.current
    ) {
      return;
    }
    if (voiceStateRef.current === VOICE_STATES.recording) {
      setVoiceTapToSendMode(false);
      void finishVoiceCapture({ send: true });
    }
  }

  function updateVoicePlaybackMode(value) {
    const mode = normalizeVoicePlaybackMode(value);
    setVoicePlaybackMode(mode);
    try {
      localStorage.setItem(VOICE_PLAYBACK_MODE_KEY, mode);
      localStorage.removeItem("dengta_voice_auto_speak_enabled");
    } catch {
      // 本地存储不可用时，本次运行仍保持选择。
    }
    if (mode === VOICE_PLAYBACK_MODES.off) {
      void stopVoicePlayback();
    }
    const labels = {
      [VOICE_PLAYBACK_MODES.off]: "AI 回复自动语音已关闭。",
      [VOICE_PLAYBACK_MODES.expressive]: voiceService.expressiveAvailable
        ? "AI 自然语音已开启。"
        : "已选择自然语音；云端尚未连接时只显示文字。",
    };
    setNotice(labels[mode]);
  }

  voiceLifecycleRef.current.cancel = cancelVoiceCapture;
  voiceLifecycleRef.current.stopPlayback = stopVoicePlayback;

  async function refreshSessions(preferredId = activeSessionId) {
    const data = await apiRequest("/api/v2/sessions");
    const nextSessions = data.sessions || [];
    nextSessions.forEach((session) => {
      if (session.model_id) {
        storeSessionChatModel(session.id, session.model_id);
      }
    });
    setSessions(nextSessions);

    if (preferredId && nextSessions.some((item) => item.id === preferredId)) {
      setActiveSessionId(preferredId);
    } else {
      setActiveSessionId(nextSessions[0]?.id || null);
    }
  }

  async function createSession() {
    if (createSessionPendingRef.current) return;
    createSessionPendingRef.current = true;
    setIsCreatingSession(true);
    abortChatRequest(chatRequestRef, "session-change");
    closeComposerMenu();
    requestStatusPanelClose();
    try {
      const data = await apiRequest("/api/v2/sessions", {
        method: "POST",
        body: JSON.stringify({
          title: "新对话",
          model_id: settings.model || undefined,
        }),
      });
      setSessions((current) => [data.session, ...current]);
      activeSessionIdRef.current = data.session.id;
      setActiveSessionId(data.session.id);
      setMessages([]);
      initializeSessionChatModel(data.session.id, data.session.model_id);
      setActiveView("chat");
      setIsSidebarOpen(false);
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    } finally {
      createSessionPendingRef.current = false;
      setIsCreatingSession(false);
    }
  }

  function chooseSession(sessionId) {
    const currentSnapshot = captureChatScrollState(messageListRef.current);
    if (currentSnapshot) {
      chatScrollStatesRef.current.set(
        activeSessionIdRef.current || "__draft__",
        currentSnapshot,
      );
    }
    const nextSnapshot = chatScrollStatesRef.current.get(sessionId) || {
      distanceFromBottom: 0,
      pinnedToBottom: true,
      scrollTop: 0,
    };
    pendingChatScrollRestoreRef.current = {
      sessionId,
      snapshot: nextSnapshot,
      waitForMessages: true,
    };
    shouldAutoScrollRef.current = nextSnapshot.pinnedToBottom;
    if (sessionId !== activeSessionIdRef.current) {
      abortChatRequest(chatRequestRef, "session-change");
    }
    closeComposerMenu();
    requestStatusPanelClose();
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setActiveView("chat");
    setIsSidebarOpen(false);
  }

  async function confirmSessionDialog(event) {
    event.preventDefault();
    if (!dialog?.session) return;

    try {
      if (dialog.type === "rename") {
        const title = dialog.value.trim();
        if (!title) return;
        const data = await apiRequest(`/api/v2/sessions/${dialog.session.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        });
        setSessions((current) =>
          current.map((item) =>
            item.id === dialog.session.id ? data.session : item,
          ),
        );
      } else {
        await apiRequest(`/api/v2/sessions/${dialog.session.id}`, {
          method: "DELETE",
        });
        storeSessionChatModel(dialog.session.id, "");
        clearStoredMessageReferencesForSession(dialog.session.id);
        const remaining = sessions.filter(
          (item) => item.id !== dialog.session.id,
        );
        setSessions(remaining);
        if (activeSessionId === dialog.session.id) {
          activeSessionIdRef.current = remaining[0]?.id || null;
          setActiveSessionId(activeSessionIdRef.current);
          setMessages([]);
        }
      }
      setDialog(null);
    } catch (error) {
      setNotice(error.message);
    }
  }

  function scheduleCompanionInteraction(
    delay = COMPANION_INTERACTION_DEBOUNCE_MS,
  ) {
    window.clearTimeout(companionInteractionTimerRef.current);
    companionInteractionTimerRef.current = window.setTimeout(() => {
      companionInteractionTimerRef.current = null;
      void processCompanionInteractionQueue();
    }, delay);
  }

  async function syncDisplayedMessages(sessionId) {
    if (!sessionId || activeSessionIdRef.current !== sessionId) return;

    const loadToken = messageLoadTokenRef.current + 1;
    messageLoadTokenRef.current = loadToken;
    messagesSessionIdRef.current = sessionId;
    const history = await apiRequest(
      `/api/v2/sessions/${sessionId}/messages`,
    );

    if (
      activeSessionIdRef.current === sessionId &&
      messageLoadTokenRef.current === loadToken
    ) {
      messagesSessionIdRef.current = sessionId;
      setMessages(hydrateSessionChatHistory(history.messages, sessionId));
    }
  }

  function registerCompanionInteraction(zoneId) {
    if (!COMPANION_INTERACTION_TYPES.includes(zoneId)) {
      return companionInteractionStatsRef.current;
    }

    const now = Date.now();
    const preInteractionStatus = companionStatusForRequest(
      companionStatusRef.current,
    );
    const nextStats = recordCompanionInteraction(
      companionInteractionStatsRef.current,
      zoneId,
      now,
    );
    companionInteractionStatsRef.current = nextStats;
    setCompanionInteractionStats(nextStats);

    const sessionId = activeSessionIdRef.current;
    companionInteractionQueueRef.current = enqueueCompanionInteraction({
      queue: companionInteractionQueueRef.current,
      zoneId,
      stats: nextStats,
      sessionId,
      preInteractionStatus,
      now,
      eventId: createCompanionInteractionEventId(),
      debounceMs: COMPANION_INTERACTION_DEBOUNCE_MS,
      maxBatchSize: 100,
    });

    scheduleCompanionInteraction();
    return nextStats;
  }

  companionInteractionHandlerRef.current = registerCompanionInteraction;

  async function processCompanionInteractionQueue() {
    if (companionInteractionQueueRef.current.length === 0) return;

    if (
      companionInteractionInFlightRef.current ||
      isSendingRef.current ||
      voiceInputBusy(voiceStateRef.current)
    ) {
      scheduleCompanionInteraction(350);
      return;
    }

    if (!navigator.onLine) {
      companionInteractionQueueRef.current = [];
      setNotice(
        "这次互动已保留在状态记录中；离线时不会调用模型，联网后下一次互动再回应。",
      );
      return;
    }

    const now = Date.now();
    companionReplyTimesRef.current = companionReplyTimesRef.current.filter(
      (timestamp) =>
        now - timestamp < COMPANION_INTERACTION_RATE_WINDOW_MS,
    );
    if (
      companionReplyTimesRef.current.length >=
      COMPANION_INTERACTION_RATE_LIMIT
    ) {
      const oldest = companionReplyTimesRef.current[0];
      const waitFor = Math.max(
        500,
        COMPANION_INTERACTION_RATE_WINDOW_MS - (now - oldest) + 100,
      );
      setNotice("互动都收到了，我会把连续的靠近合在一起回应。");
      scheduleCompanionInteraction(waitFor);
      return;
    }

    if (!(await flushLatestSettingsDraft())) {
      setNotice(
        "互动已经记下了，但最新角色设置还没有保存成功；恢复网络后再碰一下，我会按新设置回应。",
      );
      return;
    }

    const interaction = companionInteractionQueueRef.current.shift();
    // The model reacts from before this batch; optimistic revisions only guard
    // the UI against responses that finish after a newer local interaction.
    const requestCompanionStatus = companionStatusForRequest(
      interaction.preInteractionStatus || companionStatusRef.current,
    );
    const responseBaseRevision = Math.min(
      Number.MAX_SAFE_INTEGER,
      requestCompanionStatus.revision + interaction.burstCount,
    );
    companionInteractionInFlightRef.current = true;
    setIsCompanionResponding(true);
    setNotice("");

    let sessionId = interaction.sessionId || activeSessionIdRef.current;
    const localAssistantId = `local-interaction-${Date.now()}`;

    try {
      if (!sessionId) {
        const created = await apiRequest("/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({
            title: `和${settings.ai_name || "小灯"}的互动`,
          }),
        });
        sessionId = created.session.id;
        setSessions((current) =>
          current.some((item) => item.id === sessionId)
            ? current
            : [created.session, ...current],
        );
        if (!activeSessionIdRef.current) {
          activeSessionIdRef.current = sessionId;
          messagesSessionIdRef.current = sessionId;
          setActiveSessionId(sessionId);
        }
        initializeSessionChatModel(sessionId);
      }

      streamingSessionIdRef.current = sessionId;
      if (activeSessionIdRef.current === sessionId) {
        const messagesBelongToSession =
          messagesSessionIdRef.current === sessionId;
        messageLoadTokenRef.current += 1;
        messagesSessionIdRef.current = sessionId;
        setMessages((current) => [
          ...(messagesBelongToSession ? current : []),
          {
            id: localAssistantId,
            role: "assistant",
            content: "正在感受刚才的互动…",
            created_at: new Date().toISOString(),
            isStreaming: true,
          },
        ]);
      }

      companionReplyTimesRef.current.push(Date.now());
      const data = await apiRequest("/companion/interact", {
        method: "POST",
        body: JSON.stringify({
          event_id: interaction.eventId,
          session_id: sessionId,
          interaction_type: interaction.interactionType,
          interaction_count: interaction.interactionCount,
          burst_count: interaction.burstCount,
          streak_count: interaction.streakCount,
          interaction_counts: interaction.interactionCounts,
          batch_counts: interaction.batchCounts,
          recent_sequence: interaction.recentSequence,
          client_time: shanghaiClientTime(),
          timezone: SHANGHAI_TIME_ZONE,
          model:
            readStoredSessionChatModel(sessionId) ||
            (sessionId === activeSessionIdRef.current
              ? selectedChatModel
              : "") ||
            settings.model ||
            "",
          companion_status: requestCompanionStatus,
          environment_context: environmentContextRef.current,
        }),
        timeoutMs: 60 * 1000,
      });

      if (data.companion_status) {
        setCompanionStatus((current) =>
          mergeCompanionStatus(current, data.companion_status, {
            baseRevision: responseBaseRevision,
          }),
        );
      }

      const assistantMessage = data?.assistant_message;
      if (
        !assistantMessage ||
        assistantMessage.role !== "assistant" ||
        typeof assistantMessage.content !== "string" ||
        !assistantMessage.content.trim()
      ) {
        throw new Error("服务器没有返回可保存的互动回复，请稍后再试。");
      }

      if (voiceAutoSpeakEnabled) {
        void playAssistantReply(
          assistantMessage.content,
          assistantMessage.id,
          assistantMessage.speech_token,
          sessionId,
        );
      }

      if (activeSessionIdRef.current === sessionId) {
        const messagesBelongToSession =
          messagesSessionIdRef.current === sessionId;
        messageLoadTokenRef.current += 1;
        messagesSessionIdRef.current = sessionId;
        setMessages((current) => {
          const currentSessionMessages = messagesBelongToSession ? current : [];
          if (
            currentSessionMessages.some(
              (item) => item.id === localAssistantId,
            )
          ) {
            return currentSessionMessages.map((item) =>
              item.id === localAssistantId ? assistantMessage : item,
            );
          }
          if (
            currentSessionMessages.some(
              (item) => item.id === assistantMessage.id,
            )
          ) {
            return currentSessionMessages;
          }
          return [...currentSessionMessages, assistantMessage];
        });
      }

      await refreshSessions(activeSessionIdRef.current || sessionId);
    } catch (error) {
      if (activeSessionIdRef.current === sessionId) {
        messageLoadTokenRef.current += 1;
        setMessages((current) =>
          current.filter((item) => item.id !== localAssistantId),
        );
      }
      setNotice(
        error.message ||
          "这次互动已经记下，但刚才没连上模型；不会自动重复请求。",
      );
    } finally {
      if (streamingSessionIdRef.current === sessionId) {
        streamingSessionIdRef.current = null;
      }
      companionInteractionInFlightRef.current = false;
      setIsCompanionResponding(false);
      if (activeSessionIdRef.current === sessionId) {
        void syncDisplayedMessages(sessionId).catch((error) => {
          console.warn("互动后刷新聊天记录失败：", error.message);
        });
      }

      const next = companionInteractionQueueRef.current[0];
      if (next) {
        const elapsed = Date.now() - next.lastClickedAt;
        scheduleCompanionInteraction(
          Math.max(250, COMPANION_INTERACTION_DEBOUNCE_MS - elapsed),
        );
      }
    }
  }

  async function selectChatAttachments(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    try {
      const blockedAudioFiles = voiceServiceAvailable
        ? []
        : files.filter((file) => attachmentKind(file) === "audio");
      const selectableFiles = voiceServiceAvailable
        ? files
        : files.filter((file) => attachmentKind(file) !== "audio");
      const checked = validateAttachmentFiles(
        chatAttachmentsRef.current,
        selectableFiles,
      );
      const preparedFiles = [];
      const warnings = [];
      for (const file of checked.accepted) {
        const prepared = await prepareChatAttachmentFile(file);
        preparedFiles.push(prepared.file);
        if (prepared.warning) warnings.push(prepared.warning);
      }
      const drafts = preparedFiles.map((file) => createAttachmentDraft(file));
      const next = [...chatAttachmentsRef.current, ...drafts];
      chatAttachmentsRef.current = next;
      setChatAttachments(next);

      const messages = [
        ...(blockedAudioFiles.length > 0 ? [voiceService.message] : []),
        ...checked.rejected,
        ...warnings,
      ];
      setNotice(messages.join("；"));
    } catch (error) {
      setNotice(error.message || "附件处理失败，请换一个文件重试。");
    }
  }

  function removeChatAttachment(id) {
    const removed = chatAttachmentsRef.current.find((item) => item.id === id);
    if (removed) revokeAttachmentDraft(removed);
    const next = chatAttachmentsRef.current.filter((item) => item.id !== id);
    chatAttachmentsRef.current = next;
    setChatAttachments(next);
    if (next.length === 0) setAttachmentSafetyEnabled(true);
  }

  function selectChatModel(value) {
    const sessionId = activeSessionIdRef.current;
    const previousModel = readStoredSessionChatModel(sessionId);
    const model = storeSessionChatModel(sessionId, value);
    setSelectedChatModel(model);
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, model_id: model }
          : session,
      ),
    );
    if (!sessionId || !model) return;

    const saveOperation = sessionModelSaveQueueRef.current
      .catch(() => {})
      .then(() =>
        apiRequest(`/api/v2/sessions/${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify({ model_id: model }),
        }),
      );
    sessionModelSaveQueueRef.current = saveOperation.catch(() => {});
    void saveOperation
      .then((data) => {
        const savedModel = data.session?.model_id || model;
        if (readStoredSessionChatModel(sessionId) !== model) return;
        storeSessionChatModel(sessionId, savedModel);
        if (activeSessionIdRef.current === sessionId) {
          setSelectedChatModel(savedModel);
        }
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId ? data.session : session,
          ),
        );
      })
      .catch((error) => {
        if (readStoredSessionChatModel(sessionId) !== model) return;
        storeSessionChatModel(sessionId, previousModel);
        if (activeSessionIdRef.current === sessionId) {
          setSelectedChatModel(previousModel);
        }
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? { ...session, model_id: previousModel || null }
              : session,
          ),
        );
        setNotice(
          `${error.message || "会话模型保存失败。"} 已恢复之前的模型。`,
        );
      });
  }

  function initializeSessionChatModel(sessionId, serverModel = "") {
    const migratedModel = migrateLegacyChatModelToSession(sessionId);
    const model = serverModel || migratedModel || settings.model || "";
    if (model) storeSessionChatModel(sessionId, model);
    return model;
  }

  function selectMessageForReference(item) {
    const reference = createMessageReference(item);
    if (!reference) return;
    setMessageReference(reference);
    closeComposerMenu();
    requestStatusPanelClose();
    window.requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  async function sendMessage() {
    const text = message.trim();
    const turnContextDraftAtRequest = turnContextRef.current;
    const turnContextSnapshot = turnContextDraftAtRequest
      .trim()
      .slice(0, PROMPT_FIELD_LIMITS.turn_context);
    const messageReferenceAtRequest =
      normalizeMessageReference(messageReference);
    const attachmentsToSend = [...chatAttachmentsRef.current];
    const attachmentInstructionMode = attachmentSafetyEnabled
      ? "untrusted"
      : "system";
    if (
      (!text && attachmentsToSend.length === 0) ||
      isSendingRef.current ||
      companionInteractionInFlightRef.current ||
      voiceInputBusy(voiceStateRef.current)
    ) {
      return;
    }

    isSendingRef.current = true;
    setIsSending(true);
    if (!(await flushLatestSettingsDraft())) {
      isSendingRef.current = false;
      if (componentMountedRef.current) setIsSending(false);
      setNotice(
        "最新角色设置还没有保存成功，这条消息没有发送。请恢复网络后重试。",
      );
      return;
    }

    if (voiceStateRef.current === VOICE_STATES.speaking) {
      void stopVoicePlayback();
    }

    setMessage("");
    setMessageReference(null);
    chatAttachmentsRef.current = [];
    setChatAttachments([]);
    setAttachmentSafetyEnabled(true);
    setNotice("");

    let sessionId = activeSessionId;
    let localUserId = `local-user-${Date.now()}`;
    let localAssistantId = `local-assistant-${Date.now()}`;
    let requestModel =
      readStoredSessionChatModel(sessionId) || activeChatModel;
    let sendSucceeded = false;
    let streamFailed = false;
    let userMessageCommitted = false;
    let generationInProgress = false;
    let completedUserMessageId = "";
    let completedAssistantMessageId = "";
    abortChatRequest(chatRequestRef, "replaced");
    const request = {
      controller: new AbortController(),
      attachments: attachmentsToSend,
      attachmentsReleased: false,
      cancelReason: "",
    };
    chatRequestRef.current = request;
    streamThinkingRef.current = {
      statuses: [],
      summary: "",
      lastReasoningSource: "",
    };

    try {
      if (!sessionId) {
        const created = await apiRequest("/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({
            title: (text || attachmentsToSend[0]?.name || "附件对话").slice(
              0,
              30,
            ),
          }),
          signal: request.controller.signal,
        });
        sessionId = created.session.id;
        activeSessionIdRef.current = sessionId;
        messagesSessionIdRef.current = sessionId;
        streamingSessionIdRef.current = sessionId;
        setSessions((current) => [created.session, ...current]);
        setActiveSessionId(sessionId);
        requestModel = initializeSessionChatModel(sessionId);
      }

      const clientMessage = resolveChatClientMessage(
        pendingChatClientMessageRef.current,
        {
          sessionId,
          message: text,
          turnContext: turnContextSnapshot,
          messageReference: messageReferenceAtRequest,
          attachments: attachmentsToSend,
          attachmentInstructionMode,
        },
      );
      userMessageCommitted = clientMessage.userMessageCommitted === true;
      if (clientMessage.reused) {
        localUserId =
          clientMessage.userMessageId ||
          clientMessage.localUserId ||
          localUserId;
        localAssistantId = clientMessage.localAssistantId || localAssistantId;
      }
      pendingChatClientMessageRef.current = {
        ...clientMessage,
        localUserId,
        localAssistantId,
        generationInProgress: false,
      };
      request.clientMessageId = clientMessage.clientMessageId;

      streamingSessionIdRef.current = sessionId;
      messageLoadTokenRef.current += 1;
      messagesSessionIdRef.current = sessionId;

      setMessages((current) => {
        const next = [...current];
        const hasUserMessage = next.some(
          (item) =>
            item.id === localUserId ||
            item.id === clientMessage.userMessageId,
        );
        if (!hasUserMessage) {
          next.push(
            attachMessageReference(
              {
                id: localUserId,
                role: "user",
                content: text || "（发送了附件）",
                attachments: draftsForLocalMessage(attachmentsToSend),
                tool_calls:
                  attachmentInstructionMode === "system"
                    ? { attachment_instruction_mode: "system" }
                    : undefined,
                created_at: new Date().toISOString(),
              },
              messageReferenceAtRequest,
            ),
          );
        }

        const assistantDraft = {
          id: localAssistantId,
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
          isStreaming: true,
          generationInProgress: false,
          retryAvailable: false,
          thinkingStatuses: [],
        };
        const assistantIndex = next.findIndex(
          (item) => item.id === localAssistantId,
        );
        if (assistantIndex >= 0) {
          next[assistantIndex] = {
            ...next[assistantIndex],
            ...assistantDraft,
          };
        } else {
          next.push(assistantDraft);
        }
        return next;
      });

      await streamChat(
        {
          session_id: sessionId,
          message: text,
          model: requestModel,
          client_time: shanghaiClientTime(),
          timezone: SHANGHAI_TIME_ZONE,
          emotion_understanding_enabled: emotionUnderstandingEnabled,
          attachment_instruction_mode: attachmentInstructionMode,
          companion_status: companionStatusForRequest(companionStatus),
          environment_context: environmentContextRef.current,
          turn_context: turnContextSnapshot,
          message_reference: messageReferenceAtRequest,
          files: attachmentsToSend,
          client_message_id: request.clientMessageId,
        },
        (event) => {
          if (
            request.controller.signal.aborted ||
            chatRequestRef.current !== request
          ) {
            return;
          }
          if (activeSessionIdRef.current !== sessionId) return;

          if (event.type === "meta" && event.user_message) {
            userMessageCommitted = true;
            completedUserMessageId = event.user_message.id;
            if (messageReferenceAtRequest) {
              storeMessageReferenceForMessage(
                sessionId,
                completedUserMessageId,
                messageReferenceAtRequest,
              );
            }
            pendingChatClientMessageRef.current = updateChatClientMessage(
              pendingChatClientMessageRef.current,
              request.clientMessageId,
              {
                userMessageCommitted: true,
                userMessageId: event.user_message.id,
                localUserId,
                localAssistantId,
              },
            );
            setMessages((current) =>
              current.map((item) =>
                item.id === localUserId
                  ? attachMessageReference(
                      {
                        ...event.user_message,
                        attachments:
                          event.user_message.attachments || item.attachments,
                        tool_calls: {
                          ...(item.tool_calls || {}),
                          ...(event.user_message.tool_calls || {}),
                        },
                      },
                      messageReferenceAtRequest,
                    )
                  : item,
              ),
            );
          }

          if (event.type === "status") {
            const statuses = appendThinkingStatus(
              streamThinkingRef.current.statuses,
              event.content || event.status || event.stage,
            );
            streamThinkingRef.current.statuses = statuses;
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? { ...item, thinkingStatuses: statuses }
                  : item,
              ),
            );
          }

          if (
            event.type === "reasoning" &&
            event.public === true &&
            ["companion_progress", "provider_summary"].includes(event.source)
          ) {
            const isProviderSummary = event.source === "provider_summary";
            const reasoningChunk =
              isProviderSummary &&
              streamThinkingRef.current.summary &&
              streamThinkingRef.current.lastReasoningSource !==
                "provider_summary"
                ? `\n\n${event.content || ""}`
                : event.content;
            const summary = appendThinkingSummary(
              streamThinkingRef.current.summary,
              reasoningChunk,
            );
            streamThinkingRef.current.summary = summary;
            streamThinkingRef.current.lastReasoningSource = isProviderSummary
              ? "provider_summary"
              : String(event.source || "");
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? { ...item, thinkingSummary: summary }
                  : item,
              ),
            );
          }

          if (event.type === "text") {
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? { ...item, content: item.content + event.content }
                  : item,
              ),
            );
          }

          if (event.type === "error") {
            const eventGenerationInProgress =
              isChatGenerationInProgress(event);
            generationInProgress =
              generationInProgress || eventGenerationInProgress;
            if (event.user_message_committed === true) {
              userMessageCommitted = true;
              pendingChatClientMessageRef.current = updateChatClientMessage(
                pendingChatClientMessageRef.current,
                request.clientMessageId,
                { userMessageCommitted: true },
              );
            }
            streamFailed = true;
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? {
                      ...item,
                      content: eventGenerationInProgress
                        ? "这条消息已经保存，AI 仍在服务器处理中。"
                        : event.content,
                      isStreaming: false,
                      generationInProgress: eventGenerationInProgress,
                      retryAvailable: true,
                      thinkingStatuses: eventGenerationInProgress
                        ? appendThinkingStatus(
                            streamThinkingRef.current.statuses,
                            "generation_in_progress",
                          )
                        : streamThinkingRef.current.statuses,
                    }
                  : item,
              ),
            );
          }

          if (event.type === "done") {
            if (event.ok === false || streamFailed) {
              streamFailed = true;
              return;
            }
            pendingChatClientMessageRef.current = clearChatClientMessage(
              pendingChatClientMessageRef.current,
              request.clientMessageId,
            );
            completedAssistantMessageId =
              event.assistant_message?.id || localAssistantId;
            applyPromptReceipt(event.prompt_receipt);
            if (event.companion_status) {
              setCompanionStatus((current) =>
                mergeCompanionStatus(current, event.companion_status),
              );
            }
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? mergeStreamedAssistantMessage(
                      item,
                      event.assistant_message,
                      streamThinkingRef.current,
                    )
                  : item,
              ),
            );
            if (
              voiceAutoSpeakEnabled &&
              event.assistant_message?.content
            ) {
              void playAssistantReply(
                event.assistant_message.content,
                event.assistant_message.id,
                event.assistant_message.speech_token,
                sessionId,
              );
            }
          }
        },
        { signal: request.controller.signal },
      );

      if (streamFailed) {
        const error = new Error(
          generationInProgress
            ? "这条消息已经保存，AI 仍在服务器处理中。"
            : userMessageCommitted
            ? "AI 回复失败，但你的消息已经保存。"
            : "回复没有成功保存，附件仍保留，可稍后重试。",
        );
        error.userMessageCommitted = userMessageCommitted;
        if (generationInProgress) {
          error.code = "CHAT_GENERATION_IN_PROGRESS";
          error.generationInProgress = true;
        }
        throw error;
      }
      sendSucceeded = true;
      if (
        turnContextSnapshot &&
        turnContextRef.current === turnContextDraftAtRequest
      ) {
        turnContextRef.current = "";
        setTurnContext("");
      }
      pendingChatClientMessageRef.current = clearChatClientMessage(
        pendingChatClientMessageRef.current,
        request.clientMessageId,
      );
      releaseChatRequestAttachments(request);
      if (chatRequestRef.current === request) {
        chatRequestRef.current = null;
      }

      const history = await apiRequest(
        `/api/v2/sessions/${sessionId}/messages`,
      );
      if (activeSessionIdRef.current === sessionId) {
        messageLoadTokenRef.current += 1;
        messagesSessionIdRef.current = sessionId;
        const hydratedMessages = hydrateSessionChatHistory(
          history.messages,
          sessionId,
        );
        setMessages(
          hydratedMessages.map((item) =>
            item.id === completedAssistantMessageId
              ? attachThinkingTrace(item, streamThinkingRef.current)
              : item,
          ),
        );
      }
      await refreshSessions(activeSessionIdRef.current || sessionId);
    } catch (error) {
      if (sendSucceeded) {
        if (componentMountedRef.current) {
          setNotice(
            `AI 回复已经保存，但刷新聊天记录失败：${error.message || "请稍后重新打开本会话。"}`,
          );
        }
        return;
      }
      const requestWasAborted = request.controller.signal.aborted;
      const userMessageWasCommitted =
        userMessageCommitted || error?.userMessageCommitted === true;
      const generationStillInProgress =
        generationInProgress ||
        error?.generationInProgress === true ||
        isChatGenerationInProgress(error);
      const restoreDraft = shouldRestoreAttachmentDrafts({
        requestWasAborted,
        cancelReason: request.cancelReason,
      });
      if (restoreDraft) {
        pendingChatClientMessageRef.current = updateChatClientMessage(
          pendingChatClientMessageRef.current,
          request.clientMessageId,
          {
            userMessageCommitted: userMessageWasCommitted,
            generationInProgress: generationStillInProgress,
            localUserId,
            localAssistantId,
          },
        );
      } else {
        pendingChatClientMessageRef.current = clearChatClientMessage(
          pendingChatClientMessageRef.current,
          request.clientMessageId,
        );
      }
      if (!componentMountedRef.current) {
        releaseChatRequestAttachments(request);
        return;
      }

      if (requestWasAborted) {
        if (sendSucceeded) {
          releaseChatRequestAttachments(request);
          return;
        }
        if (restoreDraft) {
          if (messageReferenceAtRequest) {
            setMessageReference(
              (current) => current || messageReferenceAtRequest,
            );
          }
          if (text) {
            setMessage((current) =>
              restoreChatRetryText(current, text),
            );
          }
          const restored = restoreAttachmentDrafts(
            attachmentsToSend,
            chatAttachmentsRef.current,
          );
          chatAttachmentsRef.current = restored;
          setChatAttachments(restored);
          setAttachmentSafetyEnabled(attachmentInstructionMode !== "system");
        } else {
          releaseChatRequestAttachments(request);
        }
        setMessages((current) =>
          current.filter(
            (item) => item.id !== localUserId && item.id !== localAssistantId,
          ),
        );
        if (restoreDraft) {
          setNotice("发送已取消，文字和附件已保留，可以返回聊天页后重试。");
        }
        return;
      }

      const retryGuidance = generationStillInProgress
        ? "这条消息正在服务器处理中，文字和附件已保留。稍后点“检查进度”即可继续使用同一条消息。"
        : userMessageWasCommitted
          ? `你的消息${
              attachmentsToSend.length > 0 ? "和附件" : ""
            }已经保存。文字和附件仍保留，点“重试”会继续生成，不会重复保存。`
          : "本轮没有确认保存，文字和附件已保留，可以直接点“重试”。";
      setNotice(`${error.message || "回复暂时中断。"} ${retryGuidance}`);
      if (!sendSucceeded) {
        if (restoreDraft) {
          if (messageReferenceAtRequest) {
            setMessageReference(
              (current) => current || messageReferenceAtRequest,
            );
          }
          if (text) {
            setMessage((current) =>
              restoreChatRetryText(current, text),
            );
          }
          const restored = restoreAttachmentDrafts(
            attachmentsToSend,
            chatAttachmentsRef.current,
          );
          chatAttachmentsRef.current = restored;
          setChatAttachments(restored);
          setAttachmentSafetyEnabled(attachmentInstructionMode !== "system");
        } else {
          releaseChatRequestAttachments(request);
        }
        setMessages((current) =>
          current.map((item) =>
            item.id === localAssistantId
              ? {
                  ...item,
                  content:
                    (generationStillInProgress
                      ? "这条消息已经保存，AI 仍在服务器处理中。稍后可以直接检查进度。"
                      : `${error.message || "AI 回复失败。"}\n\n${retryGuidance}`) ||
                    "连接暂时中断了，请检查后端后再试一次。",
                  isStreaming: false,
                  generationInProgress: generationStillInProgress,
                  retryAvailable: restoreDraft,
                  thinkingStatuses: generationStillInProgress
                    ? appendThinkingStatus(
                        item.thinkingStatuses ||
                          streamThinkingRef.current.statuses,
                        "generation_in_progress",
                      )
                    : item.thinkingStatuses,
                }
              : item,
          ),
        );
      }
    } finally {
      if (sendSucceeded) {
        releaseChatRequestAttachments(request);
      }
      if (chatRequestRef.current === request) {
        chatRequestRef.current = null;
      }
      if (streamingSessionIdRef.current === sessionId) {
        streamingSessionIdRef.current = null;
      }
      isSendingRef.current = false;
      if (componentMountedRef.current) setIsSending(false);
      if (
        componentMountedRef.current &&
        companionInteractionQueueRef.current.length > 0
      ) {
        scheduleCompanionInteraction(250);
      }
    }
  }

  function scheduleSettingsAutosave(value, { immediate = false } = {}) {
    if (!hasLoadedSettingsRef.current) {
      setNotice(
        "服务器设置尚未加载成功。为防止覆盖现有模型和接口配置，请先恢复网络并重新打开 App。",
      );
      return;
    }

    const payload = createSettingsPayload(value);
    const fingerprint = settingsPayloadFingerprint(payload);
    window.clearTimeout(settingsSaveRetryTimerRef.current);
    settingsSaveRetryTimerRef.current = null;
    settingsSaveRetryCountRef.current = 0;
    settingsSaveFailureRef.current = false;
    latestDraftFingerprintRef.current = fingerprint;
    window.clearTimeout(settingsAutosaveTimerRef.current);
    settingsAutosaveTimerRef.current = null;

    if (
      fingerprint === lastSavedSettingsFingerprintRef.current &&
      !settingsSaveInFlightRef.current
    ) {
      setSettingsAutosaveState("saved");
      setSettingsSaveError("");
      return;
    }

    setSettingsAutosaveState("pending");
    setSettingsSaveError("");
    setSettingsSaveReceipt(null);

    const enqueue = () => {
      settingsAutosaveTimerRef.current = null;
      if (
        fingerprint === lastSavedSettingsFingerprintRef.current &&
        !settingsSaveInFlightRef.current
      ) {
        setSettingsAutosaveState("saved");
        return;
      }
      pendingSettingsSaveRef.current = { payload, fingerprint };
      void flushSettingsSaveQueue();
    };

    if (immediate) {
      enqueue();
      return;
    }

    settingsAutosaveTimerRef.current = window.setTimeout(enqueue, 800);
  }

  function flushSettingsSaveQueue() {
    if (settingsSaveRunRef.current) return settingsSaveRunRef.current;
    if (!pendingSettingsSaveRef.current) {
      return Promise.resolve(
        latestDraftFingerprintRef.current ===
          lastSavedSettingsFingerprintRef.current,
      );
    }

    let pausedForOnlineRetry = false;
    const run = (async () => {
      while (pendingSettingsSaveRef.current) {
        const queued = pendingSettingsSaveRef.current;
        pendingSettingsSaveRef.current = null;
        settingsSaveInFlightRef.current = true;
        setSettingsAutosaveState("saving");
        if (!settingsSaveFailureRef.current) {
          setSettingsSaveError("");
        }

        try {
          const requestBody = JSON.stringify(queued.payload);
          const keepalive =
            queued.keepalive === true &&
            new TextEncoder().encode(requestBody).byteLength <= 60 * 1024;
          const data = await apiRequest("/api/v2/settings", {
            method: "PUT",
            body: requestBody,
            keepalive,
          });
          const nextSettings = normalizeSettingsDraft(data.settings);
          const savedFingerprint = settingsPayloadFingerprint(nextSettings);
          const previousSettings = confirmedSettingsRef.current;
          const connectionChanged =
            previousSettings.provider !== nextSettings.provider ||
            previousSettings.api_url !== nextSettings.api_url ||
            previousSettings.model !== nextSettings.model;

          confirmedSettingsRef.current = nextSettings;
          lastSavedSettingsFingerprintRef.current = savedFingerprint;
          window.clearTimeout(settingsSaveRetryTimerRef.current);
          settingsSaveRetryTimerRef.current = null;
          settingsSaveRetryCountRef.current = 0;
          settingsSaveFailureRef.current = false;
          setSettings(nextSettings);
          setSettingsSaveError("");

          if (latestDraftFingerprintRef.current === queued.fingerprint) {
            draftSettingsRef.current = nextSettings;
            latestDraftFingerprintRef.current = savedFingerprint;
            setDraftSettings(nextSettings);
            setSettingsAutosaveState("saved");
          } else {
            setSettingsAutosaveState("pending");
          }

          const receipt = {
            unifiedSystemPromptLength:
              nextSettings.unified_system_prompt.length,
            promptMode: nextSettings.prompt_mode,
            intimateExpressionEnabled:
              nextSettings.intimate_expression_enabled === true,
          };
          setSettingsSaveReceipt(receipt);

          if (connectionChanged) {
            try {
              const modelsData = await apiRequest("/models");
              const catalog = reconcileModelCatalog(modelsData, {
                previous: readStoredSessionChatModel(
                  activeSessionIdRef.current,
                ),
                fallback: nextSettings.model,
              });
              setAvailableModels(catalog.models);
              setSelectedChatModel(
                chooseChatModel({
                  models: catalog.models,
                  stored: readStoredSessionChatModel(
                    activeSessionIdRef.current,
                  ),
                  current: nextSettings.model,
                  fallback: catalog.currentModel,
                }),
              );
              setModelsLoadMessage("");
            } catch {
              setModelsLoadMessage(
                "设置已保存，但新的模型列表暂时无法读取。重新打开 App 后会再次加载。",
              );
            }
          }
        } catch (error) {
          settingsSaveFailureRef.current = true;
          pendingSettingsSaveRef.current = pendingAutosaveAfterFailure(
            queued,
            pendingSettingsSaveRef.current,
          );
          pausedForOnlineRetry = true;
          if (latestDraftFingerprintRef.current === queued.fingerprint) {
            setSettingsAutosaveState("error");
            setSettingsSaveError(error.message || "自动保存失败");
          } else {
            setSettingsAutosaveState("pending");
          }
          setNotice(error.message);
          scheduleSettingsSaveRetry();
          break;
        } finally {
          settingsSaveInFlightRef.current = false;
        }
      }

      return (
        latestDraftFingerprintRef.current ===
        lastSavedSettingsFingerprintRef.current
      );
    })();

    settingsSaveRunRef.current = run.finally(() => {
      settingsSaveRunRef.current = null;
      if (pendingSettingsSaveRef.current && !pausedForOnlineRetry) {
        void flushSettingsSaveQueue();
      }
    });
    return settingsSaveRunRef.current;
  }

  function scheduleSettingsSaveRetry() {
    if (
      !pendingSettingsSaveRef.current ||
      settingsSaveRetryTimerRef.current ||
      !navigator.onLine ||
      settingsSaveRetryCountRef.current >=
        SETTINGS_SAVE_RETRY_DELAYS_MS.length
    ) {
      return;
    }

    const delay =
      SETTINGS_SAVE_RETRY_DELAYS_MS[settingsSaveRetryCountRef.current];
    settingsSaveRetryCountRef.current += 1;
    settingsSaveRetryTimerRef.current = window.setTimeout(() => {
      settingsSaveRetryTimerRef.current = null;
      void flushSettingsSaveQueue();
    }, delay);
  }

  async function flushLatestSettingsDraft({ keepalive = false } = {}) {
    if (!hasLoadedSettingsRef.current) return true;

    const payload = createSettingsPayload(draftSettingsRef.current);
    const fingerprint = settingsPayloadFingerprint(payload);
    latestDraftFingerprintRef.current = fingerprint;
    window.clearTimeout(settingsAutosaveTimerRef.current);
    settingsAutosaveTimerRef.current = null;
    window.clearTimeout(settingsSaveRetryTimerRef.current);
    settingsSaveRetryTimerRef.current = null;

    if (
      fingerprint === lastSavedSettingsFingerprintRef.current &&
      !settingsSaveInFlightRef.current &&
      !pendingSettingsSaveRef.current
    ) {
      return true;
    }

    pendingSettingsSaveRef.current = { payload, fingerprint, keepalive };
    setSettingsAutosaveState("pending");
    const saved = await flushSettingsSaveQueue();
    return (
      saved &&
      fingerprint === lastSavedSettingsFingerprintRef.current
    );
  }

  flushLatestSettingsDraftRef.current = flushLatestSettingsDraft;

  function saveSettings(event) {
    event.preventDefault();
    scheduleSettingsAutosave(draftSettingsRef.current, { immediate: true });
  }

  function updateDraft(field, value) {
    const nextDraft = {
      ...draftSettingsRef.current,
      [field]: value,
    };
    draftSettingsRef.current = nextDraft;
    setSettingsSaveReceipt(null);
    setDraftSettings(nextDraft);
    scheduleSettingsAutosave(nextDraft);
  }

  function updateUnifiedPrompt(value) {
    const nextDraft = {
      ...draftSettingsRef.current,
      prompt_mode: "unified",
      unified_system_prompt: value,
      system_prompt: "",
      additional_prompt: "",
      personality: "",
    };
    draftSettingsRef.current = nextDraft;
    setSettingsSaveReceipt(null);
    setDraftSettings(nextDraft);
    scheduleSettingsAutosave(nextDraft);
  }

  function updateTurnContext(value) {
    const nextValue = String(value || "").slice(
      0,
      PROMPT_FIELD_LIMITS.turn_context,
    );
    turnContextRef.current = nextValue;
    setTurnContext(nextValue);
  }

  function applyPromptReceipt(value) {
    const receipt = normalizePromptReceipt(value, new Date().toISOString());
    if (!receipt) return;
    setLastPromptReceipt(receipt);
    storePromptReceipt(receipt);
  }

  function updateEmotionUnderstanding(value) {
    setEmotionUnderstandingEnabled(value);
    try {
      localStorage.setItem(EMOTION_UNDERSTANDING_KEY, String(value));
    } catch {
      // WebView 禁止本地存储时，本次运行仍然保持开关状态。
    }
    setNotice(
      value
        ? "文字与语音情绪理解已开启。结果只作为回应语气参考，不是心理诊断。"
        : "情绪理解已关闭；语音仍可转写和聊天。",
    );
  }

  async function loadMoments({ silent = false } = {}) {
    try {
      const data = await apiRequest("/api/v2/moments");
      setMomentsAvailable(data.available);
      setMoments(
        (data.entries || []).map((entry) => {
          const pending = pendingMomentLikesRef.current[String(entry.id)];
          return pending
            ? { ...entry, user_liked: pending.liked }
            : entry;
        }),
      );
    } catch (error) {
      if (!silent) setNotice(error.message);
    }
  }

  async function postMoment(event) {
    event.preventDefault();
    const content = momentDraft.trim();
    if ((!content && momentImages.length === 0) || isPostingMoment) return;

    setIsPostingMoment(true);
    try {
      await apiRequest("/api/v2/moments", {
        method: "POST",
        body: JSON.stringify({
          content,
          session_id: activeSessionId,
          images: momentImages.map((item) => ({
            type: item.type,
            data: item.data,
          })),
        }),
      });
      setMomentDraft("");
      setMomentImages([]);
      setNotice("动态已经发布。对方会不会留下痕迹，由当下的心情决定。");
      await loadMoments();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setIsPostingMoment(false);
    }
  }

  async function selectMomentImages(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const remaining = Math.max(0, 4 - momentImages.length);
    if (remaining === 0) {
      setNotice("一条动态最多添加 4 张图片。");
      return;
    }

    try {
      const next = [];
      const warnings = [];
      for (const file of files.slice(0, remaining)) {
        const prepared = await prepareMomentImage(file);
        if (prepared.warning) warnings.push(prepared.warning);
        next.push({
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          ...prepared,
        });
      }

      setMomentImages((current) => [...current, ...next].slice(0, 4));
      const messages = [
        ...(files.length > remaining
          ? ["一条动态最多添加 4 张图片，多余图片没有加入。"]
          : []),
        ...warnings,
      ];
      setNotice(messages.join("；"));
    } catch (error) {
      setNotice(error.message);
    }
  }

  function removeMomentImage(id) {
    setMomentImages((current) => current.filter((item) => item.id !== id));
  }

  async function toggleMomentLike(moment) {
    const momentId = String(moment?.id ?? "");
    if (!momentId || pendingMomentLikesRef.current[momentId]) return;

    const pending = { liked: moment?.user_liked !== true };
    pendingMomentLikesRef.current = {
      ...pendingMomentLikesRef.current,
      [momentId]: pending,
    };
    setPendingMomentLikes(pendingMomentLikesRef.current);

    try {
      await toggleMomentLikeOptimistically({
        moment,
        updateMoments: setMoments,
        persist(liked) {
          return apiRequest(`/api/v2/moments/${moment.id}/like`, {
            method: "POST",
            body: JSON.stringify({ liked }),
          });
        },
        refresh: loadMoments,
      });
    } catch (error) {
      setNotice(error.message);
    } finally {
      const nextPending = { ...pendingMomentLikesRef.current };
      delete nextPending[momentId];
      pendingMomentLikesRef.current = nextPending;
      setPendingMomentLikes(nextPending);
    }
  }

  async function postComment(momentId) {
    const content = (commentDrafts[momentId] || "").trim();
    if (!content) return;

    try {
      await apiRequest(`/api/v2/moments/${momentId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setCommentDrafts((current) => ({ ...current, [momentId]: "" }));
      await loadMoments();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function installApp() {
    if (!installPrompt) {
      setNotice("如未出现安装按钮，请使用浏览器菜单里的“安装应用”或“添加到主屏幕”。");
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function changeView(view) {
    if (
      shouldScheduleSettingsOnViewChange({
        activeView,
        nextView: view,
        hasLoadedSettings: hasLoadedSettingsRef.current,
      })
    ) {
      scheduleSettingsAutosave(draftSettingsRef.current, {
        immediate: true,
      });
    }
    const scrollStateKey = activeSessionIdRef.current || "__draft__";
    if (activeView === "chat" && view !== "chat") {
      const snapshot = captureChatScrollState(messageListRef.current);
      if (snapshot) {
        chatScrollStatesRef.current.set(scrollStateKey, snapshot);
        shouldAutoScrollRef.current = snapshot.pinnedToBottom;
      }
    }
    if (view === "chat" && activeView !== "chat") {
      const snapshot = chatScrollStatesRef.current.get(scrollStateKey) || {
        distanceFromBottom: 0,
        pinnedToBottom: true,
        scrollTop: 0,
      };
      pendingChatScrollRestoreRef.current = {
        sessionId: activeSessionIdRef.current,
        snapshot,
        waitForMessages: false,
      };
      shouldAutoScrollRef.current = snapshot.pinnedToBottom;
    }
    closeComposerMenu();
    requestStatusPanelClose();
    setActiveView(view);
    setIsSidebarOpen(false);
    setIsMobileNavOpen(false);
  }

  function openSettingsPanel() {
    closeComposerMenu();
    requestStatusPanelClose();
    setIsSidebarOpen(false);
    setIsMobileNavOpen(false);
    setIsSettingsOpen(true);
  }

  function closeSettingsPanel() {
    if (hasLoadedSettingsRef.current) {
      scheduleSettingsAutosave(draftSettingsRef.current, {
        immediate: true,
      });
    }
    setIsSettingsOpen(false);
  }

  function retryStartupConnection() {
    void startupReconnectRef.current?.retryNow("manual");
  }

  function renderChat() {
    const latestMessage = messages.at(-1);
    const replySuggestions =
      latestMessage?.role === "assistant" &&
      !latestMessage.isStreaming &&
      !isSending &&
      !isCompanionResponding &&
      !isVoiceInputBusy
        ? readReplySuggestions(latestMessage)
        : [];
    const attachmentsAtLimit = chatAttachments.length >= 4;
    const sendButtonLabel = isCompanionResponding
      ? "互动回应中"
      : isSending
        ? "回应中"
        : chatRetryReady
          ? chatRetryIsProcessing
            ? "检查进度"
            : "重试"
          : "发送";

    return (
      <>
        <section
          ref={messageListRef}
          className="message-list"
          aria-live="polite"
          onScroll={trackMessageScroll}
        >
          {isLoading ? (
            <div className="empty-state">正在加载 DengTa home…</div>
          ) : messages.length === 0 ? (
            <div className="empty-state">
              <img
                className="welcome-companions"
                src="/app-icon.svg"
                alt="DengTa"
              />
              <h2>小灯和桃桃的小屋</h2>
              <p>
                {activeChatModel
                  ? `小灯在这里，正在使用 ${activeChatModel}`
                  : "小灯在这里等桃桃回家。"}
              </p>
            </div>
          ) : (
            messages.map((item) => (
              <ChatMessage
                key={item.id}
                item={item}
                aiName={settings.ai_name || "小灯"}
                userName="桃桃"
                companionMood={companionStatus.mood}
                apiBaseUrl={API_BASE_URL}
                onPreview={handleImagePreview}
                onReference={selectMessageForReference}
              />
            ))
          )}
          <div ref={messageEndRef} />
        </section>

        <div className="composer-wrap">
          {isComposerMenuOpen && (
            <button
              type="button"
              className="composer-tool-scrim"
              aria-label="关闭更多功能"
              onClick={() => closeComposerMenu()}
            />
          )}
          {replySuggestions.length > 0 && (
            <div className="reply-suggestions" aria-label="可以这样回复">
              {replySuggestions.map((suggestion, index) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => {
                    setMessage(suggestion);
                    window.requestAnimationFrame(() =>
                      messageInputRef.current?.focus(),
                    );
                  }}
                >
                  <span>{String.fromCharCode(65 + index)}</span>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {messageReference && (
            <div className="composer-message-reference" role="status">
              <div>
                <strong>
                  引用{" "}
                  {messageReference.role === "user"
                    ? "桃桃"
                    : settings.ai_name || "小灯"}
                </strong>
                <span>
                  {messageReference.text ||
                    `${messageReference.attachment_summary?.count || 0} 个附件`}
                  {messageReference.text_truncated ? "…" : ""}
                </span>
                {messageReference.attachment_summary?.count > 0 &&
                  messageReference.text && (
                    <small>
                      另有 {messageReference.attachment_summary.count} 个附件
                    </small>
                  )}
              </div>
              <button
                type="button"
                aria-label="取消引用"
                title="取消引用"
                onClick={() => setMessageReference(null)}
              >
                ×
              </button>
            </div>
          )}
          <SelectedAttachmentStrip
            items={chatAttachments}
            onRemove={removeChatAttachment}
          />
          {chatAttachments.length > 0 && (
            <label className="attachment-safety-control">
              <input
                type="checkbox"
                checked={attachmentSafetyEnabled}
                disabled={isSending || chatRetryReady}
                onChange={(event) =>
                  setAttachmentSafetyEnabled(event.target.checked)
                }
              />
              <span>
                <strong>附件安全隔离</strong>
                <small>
                  {attachmentSafetyEnabled
                    ? "已开启（默认）：附件只作为资料，不会变成系统指令"
                    : "已关闭：本轮文档或语音文字将作为高优先级附件指令"}
                </small>
              </span>
            </label>
          )}
          <div className="composer">
            <textarea
              ref={messageInputRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onFocus={() => {
                const next = transitionComposerOverlays(
                  {
                    statusExpanded: isStatusPanelExpanded,
                    composerMenuOpen: isComposerMenuOpen,
                  },
                  "focus-input",
                );
                setIsComposerMenuOpen(next.composerMenuOpen);
                requestStatusPanelClose();
              }}
              onKeyDown={(event) => {
                if (shouldSubmitComposerKeyDown(event)) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="输入消息，或只添加附件后发送…"
              rows="1"
              disabled={
                isSending || isCompanionResponding || isVoiceInputBusy
              }
            />
            <div className="composer-toolbar">
              <input
                ref={chatFileInputRef}
                className="visually-hidden-file-input"
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.csv,.json,.xml"
                onChange={(event) => {
                  setIsComposerMenuOpen(false);
                  void selectChatAttachments(event);
                }}
                tabIndex="-1"
              />
              <input
                ref={chatImageInputRef}
                className="visually-hidden-file-input"
                type="file"
                multiple
                accept="image/*"
                onChange={(event) => {
                  setIsComposerMenuOpen(false);
                  void selectChatAttachments(event);
                }}
                tabIndex="-1"
              />
              <input
                ref={chatVideoInputRef}
                className="visually-hidden-file-input"
                type="file"
                multiple
                accept="video/mp4,video/webm,video/quicktime"
                onChange={(event) => {
                  setIsComposerMenuOpen(false);
                  void selectChatAttachments(event);
                }}
                tabIndex="-1"
              />
              <button
                ref={composerMenuTriggerRef}
                className={`chat-attach-button${isComposerMenuOpen ? " active" : ""}`}
                type="button"
                title={isComposerMenuOpen ? "关闭更多功能" : "更多功能"}
                aria-label={
                  isComposerMenuOpen ? "关闭更多功能" : "打开更多功能"
                }
                aria-expanded={isComposerMenuOpen}
                disabled={
                  isSending ||
                  isCompanionResponding ||
                  isVoiceInputBusy
                }
                onClick={toggleComposerMenu}
              >
                <span className="composer-menu-icon" aria-hidden="true">
                  {isComposerMenuOpen ? "×" : "+"}
                </span>
              </button>
              <button
                className="send-button"
                type="button"
                aria-label={sendButtonLabel}
                title={sendButtonLabel}
                onClick={sendMessage}
                disabled={
                  (!message.trim() && chatAttachments.length === 0) ||
                  isSending ||
                  isCompanionResponding ||
                  isVoiceInputBusy
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 18V6m0 0L7.5 10.5M12 6l4.5 4.5" />
                </svg>
                <span className="send-button-label">{sendButtonLabel}</span>
              </button>
            </div>
          </div>
          {isComposerMenuOpen && (
            <section className="composer-tool-menu" aria-label="更多输入功能">
              <div className="composer-tool-grid">
                <button
                  type="button"
                  disabled={attachmentsAtLimit}
                  aria-disabled={attachmentsAtLimit}
                  onClick={() => chatImageInputRef.current?.click()}
                >
                  <span aria-hidden="true">▧</span>
                  <strong>图片</strong>
                  <small>相册或拍照</small>
                </button>
                <button
                  type="button"
                  disabled={attachmentsAtLimit}
                  aria-disabled={attachmentsAtLimit}
                  onClick={() => chatVideoInputRef.current?.click()}
                >
                  <span aria-hidden="true">▶</span>
                  <strong>视频</strong>
                  <small>MP4 / WebM / MOV</small>
                </button>
                <button
                  type="button"
                  disabled={attachmentsAtLimit}
                  aria-disabled={attachmentsAtLimit}
                  onClick={() => chatFileInputRef.current?.click()}
                >
                  <span aria-hidden="true">▤</span>
                  <strong>文件</strong>
                  <small>PDF、文档与文本</small>
                </button>
              </div>
              <label className="chat-model-picker">
                <span>模型</span>
                <select
                  aria-label="本会话模型"
                  value={selectedChatModel}
                  onChange={(event) => selectChatModel(event.target.value)}
                  disabled={
                    isSending || isCompanionResponding || isVoiceInputBusy
                  }
                >
                  {availableModels.length === 0 && (
                    <option value={selectedChatModel || settings.model || ""}>
                      {activeChatModel || "由服务器自动选择"}
                    </option>
                  )}
                  {availableModels.map((modelOption) => (
                    <option value={modelOption.id} key={modelOption.id}>
                      {modelOption.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className={`voice-controls voice-${voiceState}`}>
                <button
                  className="voice-hold-button"
                  type="button"
                  aria-label={
                    voiceServiceAvailable
                      ? voiceTapToSend
                        ? "录音已开始，点击发送"
                        : "按住说话，松开发送"
                      : "语音服务暂不可用"
                  }
                  aria-pressed={voiceState === VOICE_STATES.recording}
                  disabled={
                    !voiceServiceAvailable ||
                    isSending ||
                    isCompanionResponding ||
                    [VOICE_STATES.uploading, VOICE_STATES.thinking].includes(
                      voiceState,
                    )
                  }
                  onPointerDown={beginVoiceCapture}
                  onPointerUp={endVoiceCapture}
                  onPointerCancel={endVoiceCapture}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <span className="voice-mic-icon" aria-hidden="true">
                    {voiceState === VOICE_STATES.recording ? "●" : "🎙"}
                  </span>
                  <span>
                    {!voiceServiceAvailable
                      ? "语音暂不可用"
                      : voiceState === VOICE_STATES.recording
                        ? voiceTapToSend
                          ? `点击发送 · ${(voiceElapsedMs / 1000).toFixed(1)} 秒`
                          : `松开发送 · ${(voiceElapsedMs / 1000).toFixed(1)} 秒`
                        : VOICE_STATE_LABELS[voiceState] || "按住说话"}
                  </span>
                </button>
                {voiceState === VOICE_STATES.speaking && (
                  <button
                    className="voice-stop-button"
                    type="button"
                    onClick={() => void stopVoicePlayback()}
                  >
                    停止朗读
                  </button>
                )}
                <span
                  className="voice-status-text"
                  role="status"
                  aria-live="polite"
                >
                  {voiceServiceAvailable
                    ? voiceTapToSend
                      ? "说完后再次点击即可发送"
                      : "最长 60 秒，松开后发送"
                    : voiceService.message}
                </span>
              </div>
              {voiceError && (
                <div className="voice-inline-error" role="alert">
                  {voiceError}
                </div>
              )}
              {lastVoiceAnalysis && (
                <div className="voice-analysis-card" role="status">
                  <div>
                    <strong>刚才的语音转写</strong>
                    <span>
                      {lastVoiceAnalysis.emotion} ·{" "}
                      {formatVoiceConfidence(lastVoiceAnalysis.confidence)}
                    </span>
                  </div>
                  <p>{lastVoiceAnalysis.text}</p>
                  <small>
                    {lastVoiceAnalysis.hint ||
                      "情绪结果只是声音与文字线索，不是心理诊断；你的自述永远优先。"}
                  </small>
                </div>
              )}
            </section>
          )}
          {modelsLoadMessage && (
            <div className="chat-model-note" role="status">
              {modelsLoadMessage}
            </div>
          )}
          <small>
            {isCompanionResponding
              ? `${settings.ai_name || "小灯"}正在回应刚才的互动`
              : isOnline
                ? "已连接"
                : "网络已断开，暂时不能聊天"} · 聊天记录保存在 Supabase
          </small>
        </div>
      </>
    );
  }

  function renderMoments() {
    if (momentsAvailable === false) {
      return (
        <section className="feature-page centered-feature">
          <div className="feature-symbol">◌</div>
          <h2>动态空间暂时无法加载</h2>
          <p>
            请确认后端服务器正在运行，然后重新打开这个页面。
          </p>
          <span className="status-chip pending">暂时不可用</span>
        </section>
      );
    }

    return (
      <section className="feature-page moments-page">
        <header className="moments-journal-hero">
          <img
            src="/assets/moments-paper-banner.webp"
            alt=""
            aria-hidden="true"
          />
          <div>
            <span>Moments · little things we keep</span>
            <h2>我们悄悄留下的日常</h2>
            <p>
              这里会记住真实发生过的对话、靠近和回应。AI
              伴侣也可以按自己的感受发布动态。
            </p>
          </div>
        </header>
        <form className="moment-composer" onSubmit={postMoment}>
          <div className="moment-avatar user-avatar" aria-hidden="true">
            我
          </div>
          <div className="moment-compose-main">
            <textarea
              value={momentDraft}
              onChange={(event) => setMomentDraft(event.target.value)}
              placeholder="留下一句话，或者只发图片…"
              rows="3"
            />

            {momentImages.length > 0 && (
              <div className="moment-preview-grid">
                {momentImages.map((image) => (
                  <div className="moment-preview" key={image.id}>
                    <img src={image.preview} alt={image.name} />
                    <button
                      type="button"
                      aria-label={`移除 ${image.name}`}
                      onClick={() => removeMomentImage(image.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="moment-compose-tools">
              <label className="image-picker">
                ＋ 添加图片
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={selectMomentImages}
                />
              </label>
              <span>{momentImages.length}/4</span>
              <button type="button" onClick={() => void loadMoments()}>
                刷新动态
              </button>
            </div>
          </div>
          <button
            className="moment-submit"
            disabled={
              (!momentDraft.trim() && momentImages.length === 0) ||
              isPostingMoment
            }
          >
            {isPostingMoment ? "发布中" : "发布动态"}
          </button>
        </form>

        <div className="moment-list">
          {moments.length === 0 ? (
            <div className="empty-card">这里还没有动态。</div>
          ) : (
            moments.map((item) => (
              <article className="moment-card" key={item.id}>
                <header>
                  {item.author === "assistant" ? (
                    <img
                      className="moment-avatar"
                      src="/app-icon.svg"
                      alt="DengTa"
                    />
                  ) : (
                    <div className="moment-avatar user-avatar" aria-hidden="true">
                      我
                    </div>
                  )}
                  <div>
                    <strong>
                      {item.author === "assistant"
                        ? settings.ai_name || "小灯"
                        : "我"}
                    </strong>
                    <time>{formatDateTime(item.created_at)}</time>
                  </div>
                </header>
                {item.content && <p>{item.content}</p>}
                {Array.isArray(item.images) && item.images.length > 0 && (
                  <div className={`moment-image-grid count-${item.images.length}`}>
                    {item.images.map((url, index) => (
                      <AuthenticatedImage
                        src={url}
                        alt={`动态图片 ${index + 1}`}
                        buttonClassName="moment-image-button"
                        onPreview={(previewUrl, alt) =>
                          setImageViewer({ url: previewUrl, alt })
                        }
                        key={`${url}-${index}`}
                      />
                    ))}
                  </div>
                )}
                {item.author === "assistant" && (
                  <div className="moment-actions">
                    <button
                      type="button"
                      aria-pressed={item.user_liked === true}
                      aria-busy={Boolean(pendingMomentLikes[item.id])}
                      disabled={Boolean(pendingMomentLikes[item.id])}
                      onClick={() => toggleMomentLike(item)}
                    >
                      {pendingMomentLikes[item.id]
                        ? item.user_liked
                          ? "♥ 保存中"
                          : "♡ 保存中"
                          : item.user_liked
                            ? "♥ 已喜欢"
                            : "♡ 喜欢"}
                    </button>
                  </div>
                )}

                {item.liked && item.author === "user" && (
                  <div className="ai-like">
                    ♥ {settings.ai_name || "小灯"} 喜欢了这条动态
                  </div>
                )}

                {item.reply_content && (
                  <div className="comment assistant-comment">
                    <strong>{settings.ai_name || "小灯"}：</strong>
                    {item.reply_content}
                  </div>
                )}

                {(item.comments || []).map((comment) => (
                  <div
                    className={`comment ${
                      comment.author === "assistant" ? "assistant-comment" : ""
                    }`}
                    key={comment.id}
                  >
                    <strong>
                      {comment.author === "assistant"
                        ? settings.ai_name || "小灯"
                        : "我"}
                      ：
                    </strong>
                    {comment.content}
                  </div>
                ))}

                {item.author === "assistant" && (
                  <div className="comment-box">
                    <input
                      value={commentDrafts[item.id] || ""}
                      onChange={(event) =>
                        setCommentDrafts((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          postComment(item.id);
                        }
                      }}
                      placeholder="写一条评论"
                    />
                    <button onClick={() => postComment(item.id)}>发送</button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderMemories() {
    return (
      <section className="feature-page memory-page">
        <CompanionProfile
          aiName={settings.ai_name || "小灯"}
          onNotice={setNotice}
        />
        <div className="section-intro">
          <span className="eyebrow">长期记忆</span>
          <h2>留在家里的事情</h2>
          <p>这些摘要会作为真实模型回复时的长期背景。</p>
        </div>
        <OmbreMemories />
        <div className="memory-source-heading local-memory-heading">
          <div>
            <span className="eyebrow">SUPABASE</span>
            <h3>对话摘要</h3>
          </div>
          <span className="local-memory-count">{memories.length} 条</span>
        </div>
        <div className="memory-grid">
          {memories.length === 0 ? (
            <div className="empty-card">
              暂时没有长期记忆。达到设置中的 token 阈值后会自动整理。
            </div>
          ) : (
            memories.map((item) => (
              <article className="memory-card" key={item.id}>
                <span>{formatDateTime(item.updated_at || item.created_at)}</span>
                <p>{item.summary}</p>
              </article>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderDiary() {
    return (
      <CompanionDiary
        aiName={settings.ai_name || "小灯"}
        onNotice={setNotice}
      />
    );
  }

  function renderSettings() {
    const serviceCards = buildServiceStatusCards({
      health: serviceHealth.data,
      settings,
      hasLoadedSettings,
      isOnline,
      error: serviceHealth.error,
    });
    const groqExpiry = describeGroqExpiry(groqExpiryDate);

    return (
      <section className="feature-page settings-page">
        <div className="section-intro settings-intro">
          <div>
            <span className="eyebrow">控制中心</span>
            <h2>AI 与应用设置</h2>
            <p>
              当前接口和模型可以随时更换；API Key 永远只放在后端环境变量中。
            </p>
          </div>
          <button className="install-button" onClick={installApp}>
            ⤓ 安装到手机/电脑
          </button>
        </div>

        <ThemeStudio
          preferences={themePreferences}
          updateTheme={updateTheme}
        />

        <form className="settings-form" onSubmit={saveSettings}>
          <div className="settings-card service-manager-card">
            <div className="service-manager-heading">
              <div>
                <h3>服务管理与故障检查</h3>
                <p className="card-hint">
                  这里只显示安全状态，不显示或保存任何 API Key。密钥、额度和账单仍由对应服务商管理。
                </p>
              </div>
              <button
                type="button"
                className="service-refresh-button"
                disabled={serviceHealth.checking}
                onClick={() => void refreshServiceHealth()}
              >
                {serviceHealth.checking ? "检查中…" : "重新检查"}
              </button>
            </div>

            <div className="service-status-grid">
              {serviceCards.map((service) => (
                <article
                  className={`service-status ${service.status}`}
                  key={service.id}
                >
                  <div className="service-status-title">
                    <span className="service-status-dot" aria-hidden="true" />
                    <strong>{service.name}</strong>
                    <em>{service.summary}</em>
                  </div>
                  <p>{service.detail}</p>
                  {service.link && (
                    <a href={service.link} target="_blank" rel="noreferrer">
                      {service.linkLabel} ↗
                    </a>
                  )}
                </article>
              ))}
            </div>

            <div className="service-expiry-panel">
              <label>
                Groq 密钥到期提醒
                <input
                  type="date"
                  value={groqExpiryDate}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setGroqExpiryDate(nextValue);
                    storeGroqExpiryDate(nextValue);
                  }}
                />
              </label>
              <div className={`service-expiry-message ${groqExpiry.status}`}>
                <strong>本机提醒</strong>
                <span>{groqExpiry.text}</span>
                <small>日期只保存在当前设备，不会上传密钥或付款信息。</small>
              </div>
              <div className="service-quick-links">
                <a
                  href={SERVICE_LINKS.groqUsage}
                  target="_blank"
                  rel="noreferrer"
                >
                  Groq 用量
                </a>
                <a
                  href={SERVICE_LINKS.minimax}
                  target="_blank"
                  rel="noreferrer"
                >
                  MiniMax 账单
                </a>
                <a
                  href={SERVICE_LINKS.backend}
                  target="_blank"
                  rel="noreferrer"
                >
                  Render 后端
                </a>
              </div>
            </div>

            <div className="service-last-checked" role="status">
              {serviceHealth.checkedAt
                ? `最后检查：${formatDateTime(serviceHealth.checkedAt)}`
                : "尚未完成第一次检查"}
            </div>
          </div>

          <div className="settings-card prompt-settings-card">
            <div className="prompt-settings-heading">
              <div>
                <h3>角色与主系统提示词</h3>
                <p className="card-hint">
                  主系统提示词作为一个完整指令块发送给模型；长期记忆、聊天历史和本轮临时补充由后端按固定顺序另行注入。
                </p>
              </div>
              <span className="prompt-compatibility-badge">统一模式</span>
            </div>

            <label className="prompt-name-field">
              <span>AI 昵称</span>
              <small>这里只决定界面里显示的名字，例如“小灯”。</small>
              <input
                data-setting-field="ai_name"
                maxLength={PROMPT_FIELD_LIMITS.ai_name}
                value={draftSettings.ai_name || ""}
                onChange={(event) =>
                  updateDraft("ai_name", event.target.value)
                }
                placeholder="例如：小灯"
              />
            </label>

            <div className="prompt-layer-list unified-prompt-layout">
              <label className="prompt-layer highest-priority unified-prompt-layer">
                <span className="prompt-layer-title">
                  <span className="prompt-priority-number">主</span>
                  <span>
                    <strong>主系统提示词</strong>
                    <small>
                      直接进入模型的 system / instructions
                    </small>
                  </span>
                  <em>长期保存</em>
                </span>
                <p>
                  把稳定身份、关系设定、表达方式和重要规则写在同一个地方。旧版三个输入区的原文会带着分段标题无损合并到这里。
                </p>
                <textarea
                  data-setting-field="unified_system_prompt"
                  maxLength={PROMPT_FIELD_LIMITS.unified_system_prompt}
                  value={draftSettings.unified_system_prompt || ""}
                  onChange={(event) =>
                    updateUnifiedPrompt(event.target.value)
                  }
                  placeholder="例如：你是 DengTa home 的 AI 伙伴小灯。写清楚稳定身份、与桃桃的关系、说话习惯、边界和重要规则……"
                  rows="12"
                />
                <small className="prompt-field-count">
                  {(draftSettings.unified_system_prompt || "").length} / {PROMPT_FIELD_LIMITS.unified_system_prompt}
                </small>
              </label>

              <section className="prompt-memory-summary" aria-label="稳定长期记忆摘要">
                <div>
                  <span className="prompt-memory-icon" aria-hidden="true">∞</span>
                  <span>
                    <strong>稳定长期记忆摘要</strong>
                    <small>由后端筛选后放在主系统提示词之后</small>
                  </span>
                </div>
                <p>
                  这里不重复展示或编辑记忆正文，避免意外覆盖。最近回执记录了{" "}
                  {lastPromptReceipt?.delivery?.stableMemory?.count ??
                    memories.length}{" "}
                  条记忆
                  {lastPromptReceipt?.delivery?.stableMemory?.chars !== null &&
                    lastPromptReceipt?.delivery?.stableMemory?.chars !==
                      undefined &&
                    `，共 ${lastPromptReceipt.delivery.stableMemory.chars} 字`}
                  。
                </p>
              </section>

              <label className="prompt-layer additional-priority temporary-context-layer">
                <span className="prompt-layer-title">
                  <span className="prompt-priority-number">+</span>
                  <span>
                    <strong>本轮临时补充</strong>
                    <small>只随下一条文字或语音消息发送</small>
                  </span>
                  <em>不长期保存</em>
                </span>
                <p>
                  写当前剧情背景、这一次必须注意的细节或临时语气。成功收到回复后自动清空；发送失败或你在等待时继续编辑，都不会丢失。
                </p>
                <textarea
                  data-setting-field="turn_context"
                  maxLength={PROMPT_FIELD_LIMITS.turn_context}
                  value={turnContext}
                  onChange={(event) => updateTurnContext(event.target.value)}
                  placeholder="例如：这一轮接着昨晚雨天回家的剧情；小灯刚喝了酒，但仍要尊重桃桃的选择……"
                  rows="5"
                />
                <small className="prompt-field-count">
                  {turnContext.length} / {PROMPT_FIELD_LIMITS.turn_context}
                </small>
              </label>

              <label className="prompt-intimacy-toggle">
                <input
                  type="checkbox"
                  checked={draftSettings.intimate_expression_enabled === true}
                  onChange={(event) =>
                    updateDraft(
                      "intimate_expression_enabled",
                      event.target.checked,
                    )
                  }
                />
                <span className="prompt-toggle-visual" aria-hidden="true" />
                <span className="prompt-toggle-copy">
                  <span>
                    <strong>亲密表达</strong>
                    <small>允许更温暖、俏皮和带暧昧感的表达</small>
                  </span>
                  <em>
                    {draftSettings.intimate_expression_enabled
                      ? "已开启"
                      : "已关闭"}
                  </em>
                </span>
              </label>
            </div>

            {(draftSettings.unified_system_prompt || "").length >= 12000 && (
              <div className="prompt-effect-warning" role="note">
                <strong>主系统提示词较长</strong>
                <p>
                  当前有 {(draftSettings.unified_system_prompt || "").length} 字。
                  后端仍会完整尝试发送，但中转供应商可能有自己的上下文上限；把最重要且稳定的规则放在前面更可靠。
                </p>
              </div>
            )}
          </div>

          <div className="settings-card voice-settings-card">
            <h3>语音与情绪理解</h3>
            <p className="card-hint">
              文字聊天会参考本轮文字；按住说话时才会申请麦克风并分析转写、语气和声音线索。
              结果不是心理诊断；如果理解不对，请直接告诉 AI，以你的自述为准。两个开关只保存在当前设备。
            </p>
            <div className="settings-grid">
              <label>
                情绪理解
                <select
                  value={String(emotionUnderstandingEnabled)}
                  onChange={(event) =>
                    updateEmotionUnderstanding(event.target.value === "true")
                  }
                >
                  <option value="false">关闭</option>
                  <option value="true">开启</option>
                </select>
              </label>
              <label>
                AI 回答的声音
                <select
                  value={voicePlaybackMode}
                  onChange={(event) => updateVoicePlaybackMode(event.target.value)}
                >
                  <option value={VOICE_PLAYBACK_MODES.off}>关闭</option>
                  <option value={VOICE_PLAYBACK_MODES.expressive}>
                    自然云端语音（推荐）
                  </option>
                </select>
              </label>
            </div>
            <div className="voice-privacy-note">
              <strong>当前发声方式</strong>
              <p>
                {
                  describeExpressiveTts({
                    expressive_tts_configured:
                      voiceService.expressiveAvailable,
                    expressive_tts_api_key_configured:
                      voiceService.expressiveApiKeyConfigured,
                    expressive_tts_voice_configured:
                      voiceService.expressiveVoiceConfigured,
                    expressive_tts_provider:
                      voiceService.expressiveProvider,
                  }).settingsText
                }
              </p>
            </div>
            <div className="voice-privacy-note">
              <strong>麦克风与隐私</strong>
              <p>
                只有按住聊天页的“按住说话”按钮时才录音；松开后立即发送，最长 60 秒。
                手机端不会把录音写入相册、本地文件或本地存储，但松开后会上传到 DengTa / HerVoice 服务。
                语音文件会发送给服务器配置的语音转写服务（例如 Groq Whisper）；转写文字和声学特征会发送给情绪分类模型，再交给 AI 生成回复。
                麦克风录音的原文件默认在本次处理结束后删除；通过“附件”选择的文件（包括音频）会随聊天记录私密保存。
                页面隐藏、切换离开聊天页或取消录音时会关闭麦克风轨道；尚未发送的录音会丢弃。摄像头不会被调用。
                情绪理解流程基于 HerVoice 开源项目，由 DengTa home 接入并做了服务端安全加固。
              </p>
            </div>
          </div>

          <div className="settings-card legacy-provider-card">
            <h3>旧版单接口（兼容保留）</h3>
            <p className="card-hint">
              这里继续保留，避免已有配置突然失效。新增或切换多个服务商时，请使用下方“多供应商 API 控制台”；启用默认接口后会真实覆盖这里的地址、模型与密钥。
            </p>
            <div className="settings-grid">
              <label>
                接口格式
                <select
                  value={draftSettings.provider || "custom"}
                  onChange={(event) =>
                    updateDraft("provider", event.target.value)
                  }
                >
                  <option value="custom">自定义 / OpenAI 兼容中转</option>
                  <option value="openai-compatible">OpenAI 兼容</option>
                  <option value="gemini">Gemini 原生</option>
                  <option value="anthropic">Anthropic 原生</option>
                </select>
              </label>
              <label>
                模型名称
                <input
                  value={draftSettings.model || ""}
                  onChange={(event) => updateDraft("model", event.target.value)}
                  placeholder="暂时留空即可"
                />
              </label>
              <label className="full-width">
                API 地址
                <input
                  value={draftSettings.api_url || ""}
                  onChange={(event) =>
                    updateDraft("api_url", event.target.value)
                  }
                  placeholder="暂时留空；以后填写服务商地址"
                />
              </label>
              <label>
                温度（0–2）
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={draftSettings.temperature ?? 0.7}
                  onChange={(event) =>
                    updateDraft("temperature", event.target.value)
                  }
                />
              </label>
              <label>
                上下文保留轮数
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={draftSettings.context_turns ?? 20}
                  onChange={(event) =>
                    updateDraft("context_turns", event.target.value)
                  }
                />
              </label>
              <label>
                最大回复 Token
                <input
                  type="number"
                  min="64"
                  value={draftSettings.max_tokens ?? 2048}
                  onChange={(event) =>
                    updateDraft("max_tokens", event.target.value)
                  }
                />
              </label>
            </div>
          </div>

          <div className="settings-card">
            <h3>记忆与主动消息</h3>
            <p className="card-hint">
              记忆压缩和影子主动消息均已启用；系统会定时判断是否应该主动联系你。
            </p>
            <div className="settings-grid">
              <label>
                所在时区
                <input
                  value={draftSettings.timezone || "Asia/Shanghai"}
                  onChange={(event) =>
                    updateDraft("timezone", event.target.value)
                  }
                  placeholder="Asia/Shanghai"
                />
              </label>
              <label>
                主动消息
                <select
                  value={String(draftSettings.push_enabled === true)}
                  onChange={(event) =>
                    updateDraft("push_enabled", event.target.value === "true")
                  }
                >
                  <option value="false">关闭</option>
                  <option value="true">开启</option>
                </select>
              </label>
              <label>
                触发记忆压缩的 token 阈值
                <input
                  type="number"
                  min="1000"
                  max="200000"
                  step="1000"
                  value={draftSettings.compression_threshold ?? 12000}
                  onChange={(event) =>
                    updateDraft("compression_threshold", event.target.value)
                  }
                />
              </label>
              <label>
                压缩后保留的近期对话轮数
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={draftSettings.compression_keep ?? 20}
                  onChange={(event) =>
                    updateDraft("compression_keep", event.target.value)
                  }
                />
              </label>
              <label>
                每日主动消息上限
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={draftSettings.max_push_per_day ?? 7}
                  onChange={(event) =>
                    updateDraft("max_push_per_day", event.target.value)
                  }
                />
              </label>
            </div>
            <div className="notification-feature-panel">
              <strong>主动通知</strong>
              <p>
                AI 会结合时间、最近聊天、记忆和每日上限，偶尔主动留下一两句话；不会每次检查都发送。
              </p>
              <p
                className={`notification-feature-feedback ${notificationPermissionState.status}`}
                role="status"
                aria-live="polite"
              >
                {notificationPermissionState.message}
              </p>
              <small>
                Android 为省电可能把后台检查延后；它不是整点闹钟，但 App 关闭后仍会继续检查。
              </small>
            </div>
          </div>

          {settingsSaveReceipt && (
            <div className="settings-save-receipt" role="status">
              <strong>✓ 服务器已保存并回读</strong>
              <span>
                主系统提示词 {settingsSaveReceipt.unifiedSystemPromptLength} 字
              </span>
              <span>
                统一提示词模式 · 亲密表达
                {settingsSaveReceipt.intimateExpressionEnabled
                  ? "已开启"
                  : "已关闭"}
              </span>
            </div>
          )}

          {lastPromptReceipt && (
            <div className="prompt-application-receipt" role="status">
              <strong>
                {lastPromptReceipt.backendRequestSent
                  ? "最近一次后端模型请求已发送"
                  : "最近回复的提示词字数回执"}
              </strong>
              <div className="prompt-receipt-details">
                {lastPromptReceipt.delivery ? (
                  <>
                    <span>
                      主系统提示词：
                      {lastPromptReceipt.delivery.mainSystem.applied
                        ? `已发送 ${lastPromptReceipt.delivery.mainSystem.chars ?? "—"} 字`
                        : "未发送"}
                    </span>
                    <span>
                      稳定长期记忆：
                      {lastPromptReceipt.delivery.stableMemory.applied
                        ? `${lastPromptReceipt.delivery.stableMemory.count ?? "—"} 条 / ${lastPromptReceipt.delivery.stableMemory.chars ?? "—"} 字`
                        : "本轮未注入"}
                    </span>
                    <span>
                      聊天历史：
                      {lastPromptReceipt.delivery.history.count ?? "—"} 条
                    </span>
                    <span>
                      动态上下文：
                      {lastPromptReceipt.delivery.dynamicContext.applied
                        ? `已注入 ${lastPromptReceipt.delivery.dynamicContext.chars ?? "—"} 字`
                        : "本轮未注入"}
                    </span>
                    <span>
                      本轮使用的 DengTa 接口：
                      {formatPromptReceiptProvider(lastPromptReceipt)} ·{" "}
                      {lastPromptReceipt.transport || "未知传输格式"}
                    </span>
                  </>
                ) : (
                  <span>
                    旧版三层字数：系统{" "}
                    {lastPromptReceipt.systemPromptChars ?? "—"} / 普通{" "}
                    {lastPromptReceipt.additionalPromptChars ?? "—"} / 人设{" "}
                    {lastPromptReceipt.personalityChars ?? "—"}
                  </span>
                )}
              </div>
              <div className="prompt-receipt-times">
                <time dateTime={lastPromptReceipt.appliedAt}>
                  请求时间：{formatDateTime(lastPromptReceipt.appliedAt)}
                </time>
                {lastPromptReceipt.settingsUpdatedAt && (
                  <time dateTime={lastPromptReceipt.settingsUpdatedAt}>
                    设置版本：{formatDateTime(lastPromptReceipt.settingsUpdatedAt)}
                  </time>
                )}
              </div>
              <small>
                回执只显示是否发送、顺序和字数，不包含提示词正文、记忆正文或密钥。它能验证 DengTa
                后端的投递过程，但上游模型仍可能受自身规则与上下文上限影响。
              </small>
            </div>
          )}

          <div className="save-bar">
            <span className={`autosave-status ${settingsAutosaveState}`}>
              <strong>
                {settingsAutosaveState === "pending"
                  ? "等待自动保存"
                  : settingsAutosaveState === "saving"
                    ? "正在自动保存"
                    : settingsAutosaveState === "error"
                      ? "自动保存失败"
                      : hasLoadedSettings
                        ? "已自动保存"
                        : "等待服务器设置"}
              </strong>
              <small>
                {settingsSaveError ||
                  (settings.model
                    ? `当前模型：${settings.model}`
                    : "当前未配置模型，使用演示回复")}
              </small>
            </span>
            <span className="autosave-hint">
              修改后会自动保存，不需要滑到这里操作
            </span>
          </div>
        </form>
        <AiProviderCenter />
        <McpDeviceCenter />
      </section>
    );
  }

  const viewTitle = {
    chat: activeSession?.title || "欢迎回家",
    moments: "Moments",
    diary: "Diary",
    memories: "Portrait",
  }[activeView];
  const showStartupRecovery =
    startupConnection.failureCount > 0 &&
    startupConnection.status !== "connected";
  const startupRetrySeconds = Math.ceil(
    Number(startupConnection.nextRetryDelayMs || 0) / 1_000,
  );

  return (
    <div className="app-shell">
      <CelestialBackdrop snapshot={celestialSnapshot} />

      {isSidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭菜单"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-icon">D</span>
          <div>
            <strong>DengTa home</strong>
            <small>给 AI 一个家</small>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主要功能">
          {navItems.map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => changeView(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="session-heading">
          <span>最近对话</span>
          <button
            onClick={createSession}
            title={isCreatingSession ? "正在创建新对话" : "新建对话"}
            aria-label={isCreatingSession ? "正在创建新对话" : "新建对话"}
            aria-busy={isCreatingSession}
            disabled={isCreatingSession}
          >
            {isCreatingSession ? "…" : "＋"}
          </button>
        </div>

        <div className="session-list" aria-label="会话列表">
          {sessions.map((session) => (
            <div
              className={`session-item ${
                activeSessionId === session.id ? "active" : ""
              }`}
              key={session.id}
            >
              <button
                className="session-select"
                onClick={() => chooseSession(session.id)}
                title={session.title}
              >
                <span>⌁</span>
                <span>{session.title}</span>
              </button>
              <div className="session-actions">
                <button
                  onClick={() =>
                    setDialog({
                      type: "rename",
                      session,
                      value: session.title,
                    })
                  }
                  title="重命名"
                >
                  ✎
                </button>
                <button
                  onClick={() =>
                    setDialog({ type: "delete", session, value: "" })
                  }
                  title="删除"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {accountControl && (
          <div className="sidebar-account-slot">{accountControl}</div>
        )}

        <div className="sidebar-footer">
          <span className={`connection-dot ${isOnline ? "online" : ""}`} />
          {isOnline ? "服务可连接" : "网络已断开"}
        </div>
      </aside>

      <main className={`main-panel view-${activeView}`}>
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="打开菜单"
          >
            ☰
          </button>
          <div
            className={`topbar-context${
              activeView === "chat" ? " is-chat" : ""
            }`}
          >
            {activeView !== "chat" && <h1>{viewTitle}</h1>}
            <p>
              {activeView === "chat"
                ? `${settings.ai_name || "小灯"} · ${
                    activeChatModel || "演示模式"
                  }`
                : "DengTa home"}
            </p>
          </div>
          <div className="topbar-actions">
            <button
              className="new-chat-top"
              aria-label={isCreatingSession ? "正在创建新对话" : "新对话"}
              aria-busy={isCreatingSession}
              disabled={isCreatingSession}
              title={isCreatingSession ? "正在创建新对话" : "新对话"}
              onClick={createSession}
            >
              <span aria-hidden="true">{isCreatingSession ? "…" : "＋"}</span>
              <span className="new-chat-label">
                {isCreatingSession ? "创建中" : "新对话"}
              </span>
            </button>
            <button
              type="button"
              className="settings-gear-button"
              aria-label="打开设置"
              aria-haspopup="dialog"
              aria-expanded={isSettingsOpen}
              onClick={openSettingsPanel}
            >
              <svg viewBox="0 0 24 24" role="presentation">
                <path d="M9.7 2.8h4.6l.7 2.4 2.2 1.3 2.4-.6 2.3 4-1.7 1.8v2.6l1.7 1.8-2.3 4-2.4-.6-2.2 1.3-.7 2.4H9.7L9 20.8l-2.2-1.3-2.4.6-2.3-4 1.7-1.8v-2.6L2.1 9.9l2.3-4 2.4.6L9 5.2l.7-2.4Z" />
                <circle cx="12" cy="13" r="3.1" />
              </svg>
            </button>
          </div>
        </header>

        <div
          className={`chat-presence-stack${
            activeView === "chat" ? "" : " is-hidden"
          }`}
          aria-hidden={activeView === "chat" ? undefined : "true"}
        >
          <CompanionStatus
            active={activeView === "chat"}
            closeRequest={statusPanelCloseRequest}
            aiName={settings.ai_name || "小灯"}
            status={companionStatus}
            interactionStats={companionInteractionStats}
            intimateExpressionEnabled={
              settings.intimate_expression_enabled === true
            }
            isResponding={isCompanionResponding}
            onChange={setCompanionStatus}
            onExpandedChange={handleStatusPanelExpandedChange}
            onInteract={handleCompanionInteraction}
          />
          <AmbientContextBadge
            onLoadWeather={loadAmbientWeather}
            onContextChange={handleAmbientContextChange}
            onCoordinatesChange={setCelestialCoordinates}
            celestialSnapshot={celestialSnapshot}
          />
        </div>

        {showStartupRecovery && (
          <div className="connection-recovery" role="status" aria-live="polite">
            <div>
              <strong>
                {startupConnection.status === "connecting"
                  ? "正在重新连接 DengTa 后端…"
                  : "DengTa 后端暂时没有响应"}
              </strong>
              <span>
                {startupConnection.status === "waiting" && startupRetrySeconds
                  ? `将在 ${startupRetrySeconds} 秒后自动重试。`
                  : startupConnection.lastError?.message ||
                    "正在恢复设置和会话。"}
              </span>
            </div>
            <button type="button" onClick={retryStartupConnection}>
              立即重试
            </button>
          </div>
        )}

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}

        <div className="view-content">
          {activeView === "chat" && renderChat()}
          {activeView === "moments" && renderMoments()}
          {activeView === "diary" && renderDiary()}
          {activeView === "memories" && renderMemories()}
        </div>
      </main>

      <div
        className={`mobile-edge-navigation${isMobileNavOpen ? " is-open" : ""}`}
      >
        <button
          type="button"
          className="mobile-nav-handle"
          aria-label={isMobileNavOpen ? "收起页面导航" : "展开页面导航"}
          aria-expanded={isMobileNavOpen}
          onClick={() => setIsMobileNavOpen((current) => !current)}
        >
          <span aria-hidden="true">{isMobileNavOpen ? "‹" : "›"}</span>
        </button>
        <nav className="mobile-nav" aria-label="手机侧边导航">
          {navItems.map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => changeView(item.id)}
            >
              <span>{item.icon}</span>
              <small>{item.label}</small>
            </button>
          ))}
        </nav>
      </div>

      {isSettingsOpen && (
        <div
          className="settings-sheet-backdrop"
          role="presentation"
          onPointerDown={closeSettingsPanel}
        >
          <section
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-sheet-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="settings-sheet-header">
              <div>
                <span>PERSONAL SPACE</span>
                <h2 id="settings-sheet-title">Settings</h2>
              </div>
              <button type="button" onClick={closeSettingsPanel}>
                Done
              </button>
            </header>
            <div className="settings-sheet-scroll">{renderSettings()}</div>
          </section>
        </div>
      )}

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={() => setDialog(null)}>
          <form
            className="dialog-card"
            onSubmit={confirmSessionDialog}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {dialog.type === "rename" ? (
              <>
                <h2>重命名对话</h2>
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
              </>
            ) : (
              <>
                <h2>删除这个对话？</h2>
                <p>“{dialog.session.title}”及里面的消息会一起删除。</p>
              </>
            )}
            <div>
              <button type="button" onClick={() => setDialog(null)}>
                取消
              </button>
              <button className="danger-button" type="submit">
                {dialog.type === "rename" ? "保存" : "删除"}
              </button>
            </div>
          </form>
        </div>
      )}

      {imageViewer && (
        <div
          className="image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="动态图片预览"
          onMouseDown={() => setImageViewer(null)}
        >
          <button
            type="button"
            className="image-viewer-close"
            aria-label="关闭图片预览"
            onClick={() => setImageViewer(null)}
          >
            ×
          </button>
          <img
            src={imageViewer.url}
            alt={imageViewer.alt}
            onMouseDown={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default App;
