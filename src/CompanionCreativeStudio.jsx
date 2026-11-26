import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { apiRequest } from "./api";
import { authSession } from "./auth-session.js";
import { AuthenticatedImage } from "./PrivateMedia";

const IMAGE_PROVIDER_PRESETS = [
  { id: "openai", name: "OpenAI gpt-image-1（推荐）", base_url: "https://api.openai.com/v1", model: "gpt-image-1" },
  { id: "dalle3", name: "OpenAI DALL-E 3", base_url: "https://api.openai.com/v1", model: "dall-e-3" },
  { id: "openrouter", name: "OpenRouter gpt-image-1", base_url: "https://openrouter.ai/api/v1", model: "openai/gpt-image-1" },
  { id: "siliconflow_flux", name: "硅基流动 FLUX.1-dev", base_url: "https://api.siliconflow.cn/v1", model: "black-forest-labs/FLUX.1-dev" },
  { id: "siliconflow_qwen", name: "硅基流动 Qwen-Image（中文佳）", base_url: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen-Image" },
  { id: "siliconflow", name: "硅基流动 Kolors", base_url: "https://api.siliconflow.cn/v1", model: "Kwai-Kolors/Kolors" },
  { id: "zhipu", name: "智谱 CogView-4", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "cogview-4-250304" },
  { id: "custom", name: "自定义 OpenAI Images 接口", base_url: "", model: "" },
];

const CREATIVE_STYLE_OPTIONS = [
  { id: "auto", label: "智能匹配氛围" },
  { id: "watercolor_journal", label: "水彩手账涂鸦" },
  { id: "cinematic_film", label: "电影胶片纪实" },
  { id: "anime_luminous", label: "日系通透插画" },
  { id: "impasto_oil", label: "暖调厚涂油画" },
  { id: "colored_pencil_sketch", label: "彩铅淡彩速写" },
  { id: "editorial_portrait", label: "极简杂志人像" },
  { id: "storybook_gouache", label: "梦幻光影绘本" },
];

const CREATIVE_RATIO_OPTIONS = [
  { id: "", label: "按类型推荐" },
  { id: "1:1", label: "1:1 方画" },
  { id: "3:4", label: "3:4 竖版" },
  { id: "4:3", label: "4:3 横版" },
  { id: "9:16", label: "9:16 壁纸" },
  { id: "16:9", label: "16:9 宽屏" },
];

const CREATIVE_QUALITY_OPTIONS = [
  { id: "standard", label: "标准画质" },
  { id: "hd", label: "高清精绘" },
];

const PROVIDER_FAMILY_LABELS = Object.freeze({
  "gpt-image": "OpenAI gpt-image 原生适配",
  "dall-e-3": "DALL-E 3 原生适配",
  siliconflow: "SiliconFlow image_size + 避坑词适配",
  zhipu: "智谱 CogView 适配",
  "gemini-image": "Gemini Image 适配",
  "openai-compatible": "OpenAI Images 渐进兼容适配",
});

function stylePresetLabel(id) {
  return CREATIVE_STYLE_OPTIONS.find((item) => item.id === id)?.label || "智能匹配氛围";
}

function ratioLabel(id) {
  return CREATIVE_RATIO_OPTIONS.find((item) => item.id === id)?.label || id || "1:1 方画";
}

const EMPTY_STATUS = {
  settings: {
    generation_mode: "confirm",
    daily_call_limit: null,
    monthly_call_limit: null,
    surprise_enabled: false,
    max_surprise_days: 30,
  },
  provider: {
    configured: false,
    name: "我的图片接口",
    base_url: "",
    auth_type: "bearer",
    model: "",
    enabled: false,
    auth_configured: false,
    credential_state: "missing",
    credential_reentry_required: false,
    last_status: "untested",
    last_error_code: null,
  },
  usage: { day: 0, month: 0 },
  surprise_shutdown_required: false,
};

const CREATIVE_CREDENTIAL_RECOVERY_CODES = new Set([
  "creative_secret_invalid",
  "creative_secret_scope_invalid",
  "creative_provider_credential_unreadable",
  "creative_provider_credential_reentry_required",
]);

const IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE =
  "旧部署保存的图片接口凭据无法由当前后端解密。已有图片与手动上传文件仍保留；如需生成新图片，请重新填写图片接口。 / The saved image API credential cannot be decrypted by this backend. Existing images and manual uploads remain stored. Re-enter the image API settings to generate new images.";

const ARTWORK_METADATA_RECOVERY_MESSAGE =
  "已有图片与手动上传文件仍保留；旧作品文案可能暂不可读，未完成作品需要重新构思。重新填写图片 API Key 不能恢复旧作品文案。 / Existing images and manual uploads remain stored. Text from old artwork may be unavailable, and unfinished artwork must be recreated. Re-entering the image API key cannot restore old artwork text.";

function isCreativeCredentialRecoveryError(error) {
  return (
    CREATIVE_CREDENTIAL_RECOVERY_CODES.has(String(error?.code || "")) ||
    /图片接口或作品凭据.*(?:无法解密|不匹配)|(?:image|artwork).*(?:credential|secret).*(?:cannot|could not).*decrypt/i.test(
      String(error?.message || ""),
    )
  );
}

function providerNeedsCredentialReentry(provider) {
  return (
    provider?.credential_reentry_required === true ||
    provider?.credential_state === "needs_reentry"
  );
}

function artworkNeedsMetadataRecovery(artwork) {
  return (
    artwork?.metadata_reentry_required === true ||
    artwork?.metadata_state === "needs_reentry"
  );
}

function isArtworkMetadataRecoveryError(error) {
  return (
    String(error?.code || "") ===
      "creative_artwork_metadata_reentry_required" ||
    error?.metadata_reentry_required === true ||
    error?.metadata_state === "needs_reentry"
  );
}

function creativeErrorFeedback(
  error,
  recoveryMessage = ARTWORK_METADATA_RECOVERY_MESSAGE,
) {
  return isCreativeCredentialRecoveryError(error)
    ? recoveryMessage
    : error?.message || "请求失败，请稍后重试。";
}

function normalizeCreativeStatus(value = {}) {
  return {
    ...EMPTY_STATUS,
    ...value,
    settings: { ...EMPTY_STATUS.settings, ...(value.settings || {}) },
    provider: { ...EMPTY_STATUS.provider, ...(value.provider || {}) },
    usage: { ...EMPTY_STATUS.usage, ...(value.usage || {}) },
  };
}

const CREATIVE_FAILURE_MESSAGES = Object.freeze({
  creative_provider_not_enabled: "图片接口尚未启用，请先在设置里勾选启用并保存。",
  creative_provider_auth_failed: "图片接口拒绝了密钥，请检查 API Key。",
  creative_provider_rate_limited: "图片接口额度不足或当前请求过于频繁。",
  creative_provider_rejected: "图片接口拒绝了请求，请核对模型名和接口协议。",
  creative_provider_unavailable: "暂时无法连接图片接口，请检查 Base URL 和网络。",
  creative_provider_timeout: "图片供应商生成超时，可以稍后重试。",
  creative_provider_image_missing: "接口有响应，但返回格式里没有可识别的图片。",
  creative_provider_image_invalid: "接口返回的内容不是有效的 JPG、PNG 或 WebP 图片。",
  creative_provider_image_download_failed: "接口给出了图片地址，但服务器无法安全下载。",
  creative_provider_image_too_large: "接口返回的图片超过 12MB。",
  creative_output_too_large: "生成结果超过私人作品库的 5MB 保存上限。",
  creative_daily_limit_reached: "已达到你设置的今日图片调用上限。",
  creative_monthly_limit_reached: "已达到你设置的本月图片调用上限。",
});

function creativeFailureMessage(code) {
  return (
    CREATIVE_FAILURE_MESSAGES[String(code || "")] ||
    "图片生成没有完成，请查看图片接口状态后重试。"
  );
}

function creativeRequest(path, options) {
  return apiRequest(`/api/v2/creative${path}`, options);
}

function loadCreativeLibraryResources(request = creativeRequest) {
  // Provider health and the artwork library are independent. A stale provider
  // credential must never prevent a readable stored image from being shown.
  return Promise.allSettled([
    request("/status"),
    request("/artworks"),
  ]);
}

function useCreativeLibraryScope() {
  const [scope] = useState(() => {
    let owner, controller, active = false, generation = 0, operation = null;
    const matches = () => {
      const current = authSession.getSnapshot();
      return Boolean(owner?.user?.id && owner.activeCompanionId) &&
        current?.user?.id === owner.user.id && current?.activeCompanionId === owner.activeCompanionId;
    };
    const current = token => active && !controller.signal.aborted && matches() && (!token || token.generation === generation);
    const assertCurrent = () => {
      if (!current()) throw new DOMException("旧画室操作已取消。", "AbortError");
    };
    const cancel = () => { active = false; generation++; controller?.abort(); operation = null; };
    return {
      activate() { owner = authSession.getSnapshot(); controller = new AbortController(); active = true; generation++; },
      cancel, current, capture: () => ({ generation }),
      busy: () => operation !== null,
      begin() {
        if (!current() || operation) return null;
        operation = { generation };
        return operation;
      },
      finish(token) { if (operation === token) operation = null; },
      async request(path, options = {}) {
        assertCurrent();
        const token = { generation }, requestOwner = owner, requestController = controller;
        const assertRequest = () => {
          if (!current(token)) throw new DOMException("旧画室请求已取消。", "AbortError");
        };
        const data = await creativeRequest(path, { ...options, signal: requestController.signal,
          authSession: {
            getSnapshot: () => requestOwner,
            async getRequestContext() {
              assertRequest();
              const context = await authSession.getRequestContext();
              assertRequest();
              if (context?.companionId !== requestOwner.activeCompanionId) throw new DOMException("画室伴侣已切换。", "AbortError");
              return context;
            },
            captureCompanionFromResponse: response => { if (current(token)) authSession.captureCompanionFromResponse?.(response); },
            invalidateSession: message => { if (current(token)) return authSession.invalidateSession?.(message); },
          },
        });
        // JSON decoding can finish after an account switch even when fetch was aborted.
        assertRequest();
        return data;
      },
    };
  });
  useLayoutEffect(() => {
    scope.activate();
    const unsubscribe = authSession.subscribe?.(() => { if (!scope.current()) scope.cancel(); });
    return () => { unsubscribe?.(); scope.cancel(); };
  }, [scope]);
  return scope;
}

function modeLabel(value) {
  if (value === "autonomous") return "自主创作";
  if (value === "off") return "关闭图片生成";
  return "每次确认";
}

function stateLabel(value) {
  return (
    {
      idea: "构思中",
      awaiting_confirmation: "等你确认后再画",
      generating: "正在调用图片接口",
      ready: "已经画好",
      revealed: "惊喜已揭晓",
      failed: "这次生成失败",
      cancelled: "已经取消",
    }[value] || value
  );
}

function kindLabel(value) {
  return (
    {
      avatar: "头像构思",
      doodle: "随手涂鸦",
      gift: "一份画出来的礼物",
    }[value] || "作品"
  );
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function imageElementForFile(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    image.__dengtaObjectUrl = objectUrl;
    return image;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function prepareArtworkUpload(file) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file?.type) ||
    !file.size
  ) {
    throw new Error("手动上传只支持 JPG、PNG 或 WebP 图片。");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("手动上传的原图不能超过 12MB。");
  }
  const image = await imageElementForFile(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
    image.close?.();
    throw new Error("这张图片无法解码。");
  }
  const maxDimension = 2048;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (image.__dengtaObjectUrl) {
    URL.revokeObjectURL(image.__dengtaObjectUrl);
  }
  image.close?.();
  let quality = 0.9;
  let blob = await canvasBlob(canvas, "image/webp", quality);
  while (blob && blob.size > 5 * 1024 * 1024 && quality > 0.5) {
    quality -= 0.1;
    blob = await canvasBlob(canvas, "image/webp", quality);
  }
  if (!blob || blob.size > 5 * 1024 * 1024) {
    throw new Error("处理后的图片仍超过 5MB，请先在相册中缩小。");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return {
    data: btoa(binary),
    mime_type: blob.type || "image/webp",
  };
}

export function CompanionArtworkLibrary({
  aiName = "伴侣",
  onNotice,
  onOpenImageProviderSettings,
}) {
  const scope = useCreativeLibraryScope();
  const [artworks, setArtworks] = useState([]);
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [providerCredentialRecoveryRequired, setProviderCredentialRecoveryRequired] =
    useState(false);
  const [artworkMetadataUnavailable, setArtworkMetadataUnavailable] =
    useState(false);
  const [userBrief, setUserBrief] = useState("");
  const [stylePreset, setStylePreset] = useState("auto");
  const [aspectRatio, setAspectRatio] = useState("");
  const [quality, setQuality] = useState("standard");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [showAdvancedBrief, setShowAdvancedBrief] = useState(false);
  const [expandedPromptId, setExpandedPromptId] = useState("");
  const [promptDrafts, setPromptDrafts] = useState({});
  const [refineInstruction, setRefineInstruction] = useState({});

  const applyLoadResults = useCallback((results) => {
    const [statusResult, artworkResult] = results;
    let providerRecoveryRequired = false;
    let metadataUnavailable = false;
    const ordinaryErrors = [];

    if (statusResult.status === "fulfilled") {
      const nextStatus = normalizeCreativeStatus(statusResult.value);
      setStatus(nextStatus);
      providerRecoveryRequired = providerNeedsCredentialReentry(
        nextStatus.provider,
      );
    } else if (isCreativeCredentialRecoveryError(statusResult.reason)) {
      providerRecoveryRequired = true;
    } else {
      ordinaryErrors.push(statusResult.reason);
    }

    if (artworkResult.status === "fulfilled") {
      const returnedArtworks = Array.isArray(artworkResult.value.artworks)
        ? artworkResult.value.artworks
        : [];
      setArtworks(returnedArtworks);
      metadataUnavailable =
        artworkResult.value.metadata_reentry_required === true ||
        returnedArtworks.some(artworkNeedsMetadataRecovery);
    } else if (isCreativeCredentialRecoveryError(artworkResult.reason)) {
      metadataUnavailable = true;
    } else {
      ordinaryErrors.push(artworkResult.reason);
    }

    setProviderCredentialRecoveryRequired(providerRecoveryRequired);
    setArtworkMetadataUnavailable(metadataUnavailable);
    if (ordinaryErrors.length > 0) {
      setFeedback(
        ordinaryErrors[0]?.message || "作品库暂时无法读取，请稍后重试。",
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    const token = scope.capture();
    const results = await loadCreativeLibraryResources(scope.request);
    if (!scope.current(token)) throw new DOMException("旧画室操作已取消。", "AbortError");
    applyLoadResults(results);
    return results;
  }, [applyLoadResults, scope]);

  useEffect(() => {
    let active = true;
    loadCreativeLibraryResources(scope.request)
      .then((results) => {
        if (!active || !scope.current()) return;
        applyLoadResults(results);
      });
    return () => {
      active = false;
    };
  }, [applyLoadResults, scope]);

  async function requestIdea(kind, { direct = false } = {}) {
    const operation = scope.begin();
    if (!operation) return;
    setBusy(direct ? `direct:${kind}` : `idea:${kind}`);
    setFeedback("");
    try {
      const trimmedBrief = userBrief.trim();
      if (direct && !trimmedBrief) {
        setFeedback("先在上方写一句画面想法，才能直接建稿。");
        return;
      }
      const data = await scope.request("/ideas", {
        method: "POST",
        body: JSON.stringify({
          kind,
          acknowledge_cost: false,
          ...(trimmedBrief ? { brief: trimmedBrief } : {}),
          ...(direct ? { direct_prompt: trimmedBrief } : {}),
          style_preset: stylePreset,
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          quality,
          ...(negativePrompt.trim() ? { negative_prompt: negativePrompt.trim() } : {}),
        }),
      });
      await refresh();
      if (!scope.current(operation)) return;
      if (data.created && data.artwork?.id) {
        setExpandedPromptId(data.artwork.id);
      }
      const message = data.created
        ? direct
          ? "已按专业视觉规范编译建稿，可在下方检视或润色提示词后再确认生成。"
          : `${aiName}已经完成专业画面构思，图片还没有生成；可点开提示词检视或微调。`
        : data.reason || `${aiName}这次没有勉强自己画。`;
      setFeedback(message);
      onNotice?.(message);
    } catch (error) {
      if (!scope.current(operation)) return;
      setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  function openPromptEditor(artwork) {
    if (expandedPromptId === artwork.id) {
      setExpandedPromptId("");
      return;
    }
    setExpandedPromptId(artwork.id);
    setPromptDrafts((prev) => ({
      ...prev,
      [artwork.id]: {
        prompt: artwork.prompt_preview || "",
        negative_prompt: artwork.negative_prompt || "",
        aspect_ratio: artwork.aspect_ratio || "1:1",
        style_preset: artwork.style_preset || "auto",
        quality: artwork.quality || "standard",
      },
    }));
  }

  function updatePromptDraft(artworkId, field, value) {
    setPromptDrafts((prev) => ({
      ...prev,
      [artworkId]: {
        ...(prev[artworkId] || {}),
        [field]: value,
      },
    }));
  }

  async function savePromptDraft(artwork) {
    const draft = promptDrafts[artwork.id];
    if (!draft || !String(draft.prompt || "").trim()) {
      setFeedback("提示词不能为空，请至少保留主体与画面描述。");
      return;
    }
    const operation = scope.begin();
    if (!operation) return;
    setBusy(`save-prompt:${artwork.id}`);
    setFeedback("");
    try {
      const data = await scope.request(`/artworks/${artwork.id}/prompt`, {
        method: "PATCH",
        body: JSON.stringify({
          prompt: draft.prompt,
          negative_prompt: draft.negative_prompt,
          aspect_ratio: draft.aspect_ratio,
          style_preset: draft.style_preset,
          quality: draft.quality,
        }),
      });
      await refresh();
      if (!scope.current(operation)) return;
      if (data?.artwork) {
        setPromptDrafts((prev) => ({
          ...prev,
          [artwork.id]: {
            prompt: data.artwork.prompt_preview || "",
            negative_prompt: data.artwork.negative_prompt || "",
            aspect_ratio: data.artwork.aspect_ratio || "1:1",
            style_preset: data.artwork.style_preset || "auto",
            quality: data.artwork.quality || "standard",
          },
        }));
      }
      setFeedback("专业生图提示词与画幅参数已保存（不消耗图片额度）。");
    } catch (error) {
      if (!scope.current(operation)) return;
      setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function refinePromptWithAi(artwork) {
    const operation = scope.begin();
    if (!operation) return;
    const draft = promptDrafts[artwork.id] || {};
    setBusy(`refine:${artwork.id}`);
    setFeedback("");
    try {
      const data = await scope.request(`/artworks/${artwork.id}/refine-prompt`, {
        method: "POST",
        body: JSON.stringify({
          instruction: String(refineInstruction[artwork.id] || "").trim(),
          style_preset: draft.style_preset || artwork.style_preset || "auto",
          aspect_ratio: draft.aspect_ratio || artwork.aspect_ratio || "1:1",
          quality: draft.quality || artwork.quality || "standard",
        }),
      });
      await refresh();
      if (!scope.current(operation)) return;
      if (data?.artwork) {
        setPromptDrafts((prev) => ({
          ...prev,
          [artwork.id]: {
            prompt: data.artwork.prompt_preview || "",
            negative_prompt: data.artwork.negative_prompt || "",
            aspect_ratio: data.artwork.aspect_ratio || "1:1",
            style_preset: data.artwork.style_preset || "auto",
            quality: data.artwork.quality || "standard",
          },
        }));
        setRefineInstruction((prev) => ({ ...prev, [artwork.id]: "" }));
      }
      setFeedback("已用文字模型按 7 层美术指导结构完成专业润色（未消耗图片接口额度）。");
    } catch (error) {
      if (!scope.current(operation)) return;
      setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function copyPromptText(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setFeedback("生图提示词已复制到剪贴板。");
    } catch {
      setFeedback("当前环境无法直接写入剪贴板，请手动选中复制。");
    }
  }

  async function refreshArtworks() {
    const operation = scope.begin();
    if (!operation) return;
    setBusy("refresh");
    setFeedback("");
    try {
      await refresh();
    } catch (error) {
      if (scope.current(operation)) setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function generateArtwork(artwork) {
    if (!scope.current() || scope.busy()) return;
    if (artworkNeedsMetadataRecovery(artwork)) {
      setFeedback(ARTWORK_METADATA_RECOVERY_MESSAGE);
      return;
    }
    if (providerCredentialRecoveryRequired) {
      setFeedback(IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE);
      return;
    }
    if (!status.provider.enabled) {
      setFeedback(
        "图片接口尚未启用。请先前往设置保存并启用图片接口。 / The image API is not enabled. Save and enable it in Settings first.",
      );
      return;
    }
    const draft = promptDrafts[artwork.id];
    const effectiveRatio = draft?.aspect_ratio || artwork.aspect_ratio || "1:1";
    const effectiveQuality = draft?.quality || artwork.quality || "standard";
    if (
      !window.confirm(
        `现在会真实调用“${status.provider.name || "图片接口"}”（${status.provider.model || "默认模型"} · ${effectiveRatio} · ${effectiveQuality === "hd" ? "高清精绘" : "标准画质"}）生成《${
          artwork.title
        }》，可能产生供应商费用。继续吗？`,
      )
    ) {
      return;
    }
    const operation = scope.begin();
    if (!operation) return;
    setBusy(`generate:${artwork.id}`);
    setFeedback("");
    try {
      await scope.request(`/artworks/${artwork.id}/generate`, {
        method: "POST",
        body: JSON.stringify({
          acknowledge_cost: true,
          aspect_ratio: effectiveRatio,
          quality: effectiveQuality,
        }),
      });
      await refresh();
      if (!scope.current(operation)) return;
      const message = "图片已经生成并只保存在当前账号的私人作品库里。";
      setFeedback(message);
      onNotice?.(message);
    } catch (error) {
      if (!scope.current(operation)) return;
      await refresh().catch(() => {});
      if (!scope.current(operation)) return;
      if (isArtworkMetadataRecoveryError(error)) {
        setArtworkMetadataUnavailable(true);
      } else if (isCreativeCredentialRecoveryError(error)) {
        setProviderCredentialRecoveryRequired(true);
      }
      setFeedback(
        creativeErrorFeedback(
          error,
          isArtworkMetadataRecoveryError(error)
            ? ARTWORK_METADATA_RECOVERY_MESSAGE
            : IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE,
        ),
      );
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function removeArtwork(artwork) {
    if (!scope.current() || scope.busy()) return;
    if (!window.confirm(`永久删除《${artwork.title}》吗？删除后无法恢复。`)) {
      return;
    }
    const operation = scope.begin();
    if (!operation) return;
    setBusy(`delete:${artwork.id}`);
    try {
      await scope.request(`/artworks/${artwork.id}`, {
        method: "DELETE",
      });
      await refresh();
      if (!scope.current(operation)) return;
      setFeedback("作品已经从私人存储中删除。");
    } catch (error) {
      if (!scope.current(operation)) return;
      setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function uploadArtworkFile(file) {
    if (!file) return;
    const operation = scope.begin();
    if (!operation) return;
    setBusy("upload");
    setFeedback("");
    try {
      const prepared = await prepareArtworkUpload(file);
      if (!scope.current(operation)) return;
      await scope.request("/artworks/upload", {
        method: "POST",
        body: JSON.stringify({
          ...prepared,
          kind: "doodle",
          title: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
          description: "由当前账号手动放进私人作品库的图片。",
          alt_text: file.name.slice(0, 200),
        }),
      });
      await refresh();
      if (!scope.current(operation)) return;
      setFeedback("图片已去除可识别元数据并保存到私人作品库，没有调用图片模型。");
    } catch (error) {
      if (!scope.current(operation)) return;
      setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function uploadArtwork(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    await uploadArtworkFile(file);
  }

  async function importArtworkFromClipboard() {
    try {
      if (!navigator.clipboard?.read) throw new Error("clipboard_unsupported");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const extension = imageType === "image/png" ? "png" : imageType === "image/webp" ? "webp" : "jpg";
        const file = new File([blob], `剪贴板图片-${Date.now()}.${extension}`, { type: imageType });
        await uploadArtworkFile(file);
        return;
      }
      setFeedback("剪贴板里没有找到图片。先复制一张图，再点“从剪贴板导入”。");
    } catch {
      setFeedback("当前浏览器不允许直接读取剪贴板。可以先复制图片，在画室页面按 Ctrl+V，或使用“手动上传”。");
    }
  }

  async function handleArtworkPaste(event) {
    const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    await uploadArtworkFile(file);
  }

  return (
    <section className="companion-artwork-library" aria-labelledby="creative-library-title" onPaste={handleArtworkPaste}>
      <div className="profile-section-heading">
        <div>
          <span className="eyebrow">只属于你们的私人画册</span>
          <h3 id="creative-library-title">头像、涂鸦与小礼物</h3>
        </div>
        <small>{modeLabel(status.settings.generation_mode)}</small>
      </div>

      {(providerCredentialRecoveryRequired || artworkMetadataUnavailable) && (
        <div className="creative-credential-recovery" role="alert">
          <div>
            <strong>
              {providerCredentialRecoveryRequired
                ? "图片接口需要重新填写 / Image API setup required"
                : "旧作品文案暂不可读 / Old artwork text unavailable"}
            </strong>
            <p>
              {providerCredentialRecoveryRequired
                ? IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE
                : ARTWORK_METADATA_RECOVERY_MESSAGE}
            </p>
          </div>
          {providerCredentialRecoveryRequired && (
            <button type="button" onClick={onOpenImageProviderSettings}>
              前往图片接口设置 / Open image settings
            </button>
          )}
        </div>
      )}

      <div className="creative-invitation-card creative-director-workbench">
        <div className="creative-director-header">
          <div>
            <strong>{aiName}可以先做视觉分镜，再决定画不画</strong>
            <p>
              构思会参考真实聊天、角色档案与专业 7 层美术指导规范；先构思只会使用当前文字模型，不会调用图片接口。
            </p>
          </div>
          <button
            type="button"
            className="creative-subtle-toggle"
            onClick={() => setShowAdvancedBrief((open) => !open)}
          >
            {showAdvancedBrief ? "收起避坑词" : "高级避坑词"}
          </button>
        </div>

        <div className="creative-director-controls">
          <label className="creative-brief-field">
            <span>画面主题 / 灵感方向（可选）</span>
            <input
              type="text"
              value={userBrief}
              maxLength={400}
              disabled={Boolean(busy)}
              placeholder="留空=由伴侣结合最近聊天自由构思；也可写想法，如：雨夜落地窗边暖黄台灯与热可可"
              onChange={(event) => setUserBrief(event.target.value)}
            />
          </label>
          <div className="creative-director-row">
            <label>
              <span>画风预设</span>
              <select
                value={stylePreset}
                disabled={Boolean(busy)}
                onChange={(event) => setStylePreset(event.target.value)}
              >
                {CREATIVE_STYLE_OPTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>成片画质</span>
              <select
                value={quality}
                disabled={Boolean(busy)}
                onChange={(event) => setQuality(event.target.value)}
              >
                {CREATIVE_QUALITY_OPTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="creative-ratio-group" role="group" aria-label="画幅比例">
            <span className="creative-ratio-label">画幅比例</span>
            <div className="creative-ratio-pills">
              {CREATIVE_RATIO_OPTIONS.map((item) => (
                <button
                  key={item.id || "default"}
                  type="button"
                  className={aspectRatio === item.id ? "is-active" : ""}
                  disabled={Boolean(busy)}
                  onClick={() => setAspectRatio(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {showAdvancedBrief && (
            <label className="creative-brief-field">
              <span>额外避坑词（Negative Prompt，可选）</span>
              <input
                type="text"
                value={negativePrompt}
                maxLength={400}
                disabled={Boolean(busy)}
                placeholder="例如：多余路人、杂乱背景文字（系统已默认防畸形手指、水印和乱码）"
                onChange={(event) => setNegativePrompt(event.target.value)}
              />
            </label>
          )}
        </div>

        <div className="creative-invitation-actions">
          {[
            ["doodle", "想一张涂鸦"],
            ["gift", "想一份画出来的礼物"],
            ["avatar", "想一个自我形象"],
          ].map(([kind, label]) => (
            <button
              type="button"
              key={kind}
              disabled={
                Boolean(busy) ||
                status.settings.generation_mode === "off"
              }
              onClick={() => requestIdea(kind)}
            >
              {busy === `idea:${kind}` ? "正在构思…" : label}
            </button>
          ))}
          {userBrief.trim() && (
            <button
              type="button"
              disabled={
                Boolean(busy) ||
                status.settings.generation_mode === "off"
              }
              onClick={() => requestIdea("doodle", { direct: true })}
            >
              {busy === "direct:doodle" ? "编译中…" : "按此直接建稿"}
            </button>
          )}
          <label className="creative-upload-button">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={Boolean(busy)}
              onChange={uploadArtwork}
            />
            <span>{busy === "upload" ? "处理中…" : "手动上传"}</span>
          </label>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void importArtworkFromClipboard()}
          >
            从剪贴板导入
          </button>
        </div>
      </div>

      {status.settings.generation_mode === "off" && (
        <p className="creative-feedback" role="status">
          图片生成已关闭，不影响聊天和已有表情包。以后仍可在设置里重新开启。
        </p>
      )}
      {feedback && (
        <p className="creative-feedback" role="status">
          {feedback}
        </p>
      )}

      <div className="artwork-grid">
        {artworks.length === 0 ? (
          <div className="artwork-empty">
            <strong>这里还没有作品</strong>
            <p>
              没有真实聊天依据时，{aiName}不会用虚假的共同经历凑一张画。
            </p>
          </div>
        ) : (
          artworks.map((artwork) => (
            <article className={`artwork-card state-${artwork.state}`} key={artwork.id}>
              {artwork.image_url ? (
                <AuthenticatedImage
                  src={artwork.image_url}
                  alt={artwork.alt_text}
                  className="artwork-card-image"
                  loading="lazy"
                />
              ) : (
                <div className="artwork-concept" aria-hidden="true">
                  <span>✦</span>
                  <small>{kindLabel(artwork.kind)}</small>
                </div>
              )}
              <div className="artwork-card-copy">
                <span>{stateLabel(artwork.state)}</span>
                <strong>{artwork.title}</strong>
                <p>
                  {artwork.description ||
                    (artworkNeedsMetadataRecovery(artwork)
                      ? "旧作品文案暂不可读；已保存图片不受影响，未完成作品需重新构思。 / Old artwork text is unavailable. Saved images are unaffected; unfinished artwork must be recreated."
                      : "")}
                </p>
                {artwork.reason && <small>为什么想画：{artwork.reason}</small>}
                {(artwork.aspect_ratio || artwork.style_preset || artwork.quality === "hd") && (
                  <div className="artwork-meta-tags">
                    <span>{kindLabel(artwork.kind)}</span>
                    {artwork.aspect_ratio && <span>{ratioLabel(artwork.aspect_ratio)}</span>}
                    {artwork.style_preset && artwork.style_preset !== "auto" && (
                      <span>{stylePresetLabel(artwork.style_preset)}</span>
                    )}
                    {artwork.quality === "hd" && <span>高清精绘</span>}
                  </div>
                )}
                {artwork.model && (
                  <small>
                    {artwork.model} · 实际调用 {artwork.actual_call_count} 次
                  </small>
                )}
                {artwork.failure_code && (
                  <small className="artwork-error">
                    生成失败：{creativeFailureMessage(artwork.failure_code)}
                    <br />
                    错误码：{artwork.failure_code}
                  </small>
                )}
                {artwork.state === "generating" && (
                  <small>
                    先刷新查看是否已画好。若长时间没有结果，可以删除本次作品，再从上方重新构思。
                    删除不会撤回已提交的接口调用；重新生成可能产生新的接口费用。
                  </small>
                )}
                {expandedPromptId === artwork.id && (
                  <div className="artwork-prompt-drawer">
                    {["idea", "awaiting_confirmation", "failed"].includes(artwork.state) &&
                    !artworkNeedsMetadataRecovery(artwork) ? (
                      <>
                        <label>
                          <span>正向视觉提示词（实际发送给图片模型）</span>
                          <textarea
                            rows={4}
                            value={promptDrafts[artwork.id]?.prompt ?? artwork.prompt_preview ?? ""}
                            disabled={Boolean(busy)}
                            onChange={(event) =>
                              updatePromptDraft(artwork.id, "prompt", event.target.value)
                            }
                          />
                        </label>
                        <label>
                          <span>负向避坑词（Negative Prompt）</span>
                          <input
                            type="text"
                            value={
                              promptDrafts[artwork.id]?.negative_prompt ??
                              artwork.negative_prompt ??
                              ""
                            }
                            disabled={Boolean(busy)}
                            onChange={(event) =>
                              updatePromptDraft(artwork.id, "negative_prompt", event.target.value)
                            }
                          />
                        </label>
                        <div className="artwork-prompt-inline-selects">
                          <label>
                            <span>画幅</span>
                            <select
                              value={promptDrafts[artwork.id]?.aspect_ratio || artwork.aspect_ratio || "1:1"}
                              disabled={Boolean(busy)}
                              onChange={(event) =>
                                updatePromptDraft(artwork.id, "aspect_ratio", event.target.value)
                              }
                            >
                              {CREATIVE_RATIO_OPTIONS.filter((item) => item.id).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>画风</span>
                            <select
                              value={promptDrafts[artwork.id]?.style_preset || artwork.style_preset || "auto"}
                              disabled={Boolean(busy)}
                              onChange={(event) =>
                                updatePromptDraft(artwork.id, "style_preset", event.target.value)
                              }
                            >
                              {CREATIVE_STYLE_OPTIONS.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>画质</span>
                            <select
                              value={promptDrafts[artwork.id]?.quality || artwork.quality || "standard"}
                              disabled={Boolean(busy)}
                              onChange={(event) =>
                                updatePromptDraft(artwork.id, "quality", event.target.value)
                              }
                            >
                              {CREATIVE_QUALITY_OPTIONS.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label>
                          <span>AI 润色补充意见（可选）</span>
                          <input
                            type="text"
                            value={refineInstruction[artwork.id] || ""}
                            disabled={Boolean(busy)}
                            placeholder="如：改成逆光黄昏、拉近半身景别、增加手绘水彩纸纹"
                            onChange={(event) =>
                              setRefineInstruction((prev) => ({
                                ...prev,
                                [artwork.id]: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="artwork-prompt-drawer-actions">
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => void refinePromptWithAi(artwork)}
                          >
                            {busy === `refine:${artwork.id}` ? "润色中…" : "AI 专业润色"}
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={Boolean(busy)}
                            onClick={() => void savePromptDraft(artwork)}
                          >
                            {busy === `save-prompt:${artwork.id}` ? "保存中…" : "保存提示词"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <small className="artwork-prompt-readonly-label">正向视觉提示词</small>
                        <p className="artwork-prompt-readonly-text">
                          {artwork.prompt_preview || "（手动上传图片或旧版作品无提示词记录）"}
                        </p>
                        {artwork.negative_prompt && (
                          <small className="artwork-prompt-readonly-neg">
                            避坑约束：{artwork.negative_prompt}
                          </small>
                        )}
                        {artwork.prompt_preview && (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void copyPromptText(artwork.prompt_preview)}
                          >
                            复制提示词
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="artwork-card-actions">
                {(artwork.prompt_preview ||
                  ["idea", "awaiting_confirmation", "failed"].includes(artwork.state)) &&
                  !artworkNeedsMetadataRecovery(artwork) && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={Boolean(busy)}
                      onClick={() => openPromptEditor(artwork)}
                    >
                      {expandedPromptId === artwork.id
                        ? "收起提示词"
                        : ["idea", "awaiting_confirmation", "failed"].includes(artwork.state)
                          ? "精修提示词"
                          : "查看提示词"}
                    </button>
                  )}
                {artwork.state === "generating" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={Boolean(busy)}
                    onClick={refreshArtworks}
                  >
                    {busy === "refresh" ? "正在刷新…" : "刷新作品状态"}
                  </button>
                )}
                {["awaiting_confirmation", "failed"].includes(
                  artwork.state,
                ) && (
                  <button
                    type="button"
                    disabled={
                      Boolean(busy) ||
                      status.settings.generation_mode === "off"
                    }
                    onClick={() => generateArtwork(artwork)}
                  >
                    {busy === `generate:${artwork.id}`
                      ? "正在画…"
                      : artworkNeedsMetadataRecovery(artwork)
                        ? "重新构思后生成 / Recreate idea"
                        : providerCredentialRecoveryRequired
                          ? "重新配置后生成 / Reconfigure"
                          : !status.provider.enabled
                            ? "先启用图片接口 / Enable image API"
                      : artwork.state === "failed"
                        ? "确认费用后重试"
                        : "确认费用并生成"}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={Boolean(busy)}
                  onClick={() => removeArtwork(artwork)}
                >
                  删除
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

export default function CompanionCreativeSettings() {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [settingsDraft, setSettingsDraft] = useState(EMPTY_STATUS.settings);
  const [providerDraft, setProviderDraft] = useState(EMPTY_STATUS.provider);
  const [hiddenAction, setHiddenAction] = useState("reveal");
  const [credential, setCredential] = useState("");
  const [providerPreset, setProviderPreset] = useState("custom");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    const data = await creativeRequest("/status");
    const next = normalizeCreativeStatus(data);
    setStatus(next);
    setSettingsDraft(next.settings);
    setProviderDraft(next.provider);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    creativeRequest("/status")
      .then((data) => {
        if (!active) return;
        const next = normalizeCreativeStatus(data);
        setStatus(next);
        setSettingsDraft(next.settings);
        setProviderDraft(next.provider);
      })
      .catch((error) => {
        if (active) {
          setFeedback(
            isCreativeCredentialRecoveryError(error)
              ? IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE
              : error.message,
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveSettings(event) {
    event.preventDefault();
    setBusy("settings");
    setFeedback("");
    try {
      const data = await creativeRequest("/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...settingsDraft,
          daily_call_limit:
            settingsDraft.daily_call_limit === ""
              ? null
              : settingsDraft.daily_call_limit,
          monthly_call_limit:
            settingsDraft.monthly_call_limit === ""
              ? null
              : settingsDraft.monthly_call_limit,
          hidden_content_action:
            status.surprise_shutdown_required &&
            settingsDraft.surprise_enabled !== true
              ? hiddenAction
              : undefined,
        }),
      });
      await load();
      setFeedback(
        data.settings.generation_mode === "autonomous"
          ? "自主创作已启用；后台只会在随机检查到期且确实想画时调用图片接口。"
          : "图片创作权限已保存。",
      );
    } catch (error) {
      setFeedback(creativeErrorFeedback(error));
    } finally {
      setBusy("");
    }
  }

  async function saveProvider(event) {
    event.preventDefault();
    setBusy("provider");
    setFeedback("");
    try {
      const data = await creativeRequest("/provider", {
        method: "PUT",
        body: JSON.stringify({
          name: providerDraft.name,
          base_url: providerDraft.base_url,
          auth_type: providerDraft.auth_type,
          credential,
          model: providerDraft.model,
          enabled: providerDraft.enabled === true,
        }),
      });
      setCredential("");
      await load();
      setFeedback(data.message);
    } catch (error) {
      setFeedback(
        creativeErrorFeedback(error, IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE),
      );
    } finally {
      setBusy("");
    }
  }

  function updateSettings(field, value) {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  }

  function updateProvider(field, value) {
    setProviderDraft((current) => ({ ...current, [field]: value }));
  }

  function applyProviderPreset(id) {
    const preset =
      IMAGE_PROVIDER_PRESETS.find((item) => item.id === id) ||
      IMAGE_PROVIDER_PRESETS[IMAGE_PROVIDER_PRESETS.length - 1];
    setProviderPreset(preset.id);
    setProviderDraft((current) => ({
      ...current,
      name: preset.name,
      base_url: preset.base_url,
      model: preset.model,
    }));
  }

  async function reuseChatProvider() {
    if (busy) return;
    const model = String(providerDraft.model || "").trim();
    if (!model) {
      setFeedback("先选择预设或填写图片模型名，再复用聊天接口。");
      return;
    }
    setBusy("provider-chat");
    setFeedback("");
    try {
      const data = await creativeRequest("/provider/from-chat", {
        method: "POST",
        body: JSON.stringify({ model }),
      });
      if (data?.ok !== true || !data.provider) throw new Error("复用聊天接口失败。");
      await load();
      setFeedback("已复用当前聊天接口的地址和密钥；密钥不会显示在页面上。");
      setProviderPreset("custom");
    } catch (error) {
      setFeedback(creativeErrorFeedback(error, "复用聊天接口失败；可以继续手动填写图片接口。"));
    } finally {
      setBusy("");
    }
  }

  const providerCredentialRecoveryRequired =
    providerNeedsCredentialReentry(status.provider);

  return (
    <section className="settings-card companion-creative-settings">
      <div className="creative-settings-heading">
        <div>
          <span className="settings-kicker">私人创作</span>
          <h3>图片接口、涂鸦与秘密惊喜</h3>
          <p>
            图片接口与聊天模型完全分开。旧背景和头像不会恢复；已有表情包功能不受影响。
          </p>
        </div>
        <span className={status.provider.enabled ? "provider-state ready" : "provider-state pending"}>
          {status.provider.enabled ? "图片接口已启用" : "尚未启用"}
        </span>
      </div>

      {feedback && (
        <p className="creative-feedback" role="status">
          {feedback}
        </p>
      )}

      <form className="creative-permission-form" onSubmit={saveSettings}>
        <label>
          图片生成权限
          <select
            value={settingsDraft.generation_mode}
            onChange={(event) =>
              updateSettings("generation_mode", event.target.value)
            }
          >
            <option value="confirm">每次确认（默认）</option>
            <option value="autonomous">自主创作</option>
            <option value="off">关闭图片生成</option>
          </select>
          <small>
            “每次确认”只保存构思，直到你明确确认一次可能付费的图片调用。
          </small>
        </label>
        <label>
          24 小时滚动调用上限
          <input
            type="number"
            min="1"
            max="1000"
            value={settingsDraft.daily_call_limit ?? ""}
            placeholder="留空表示不设上限"
            onChange={(event) =>
              updateSettings("daily_call_limit", event.target.value)
            }
          />
        </label>
        <label>
          31 天滚动调用上限
          <input
            type="number"
            min="1"
            max="10000"
            value={settingsDraft.monthly_call_limit ?? ""}
            placeholder="留空表示不设上限"
            onChange={(event) =>
              updateSettings("monthly_call_limit", event.target.value)
            }
          />
        </label>
        <label className="creative-switch-row">
          <input
            type="checkbox"
            checked={settingsDraft.surprise_enabled === true}
            disabled={settingsDraft.generation_mode !== "autonomous"}
            onChange={(event) =>
              updateSettings("surprise_enabled", event.target.checked)
            }
          />
          <span>
            <strong>允许秘密惊喜</strong>
            <small>
              默认关闭。开启后，未揭晓的构思、作品和进度不会出现在聊天或作品库。
            </small>
          </span>
        </label>
        {settingsDraft.surprise_enabled === true && (
          <label>
            最晚揭晓天数
            <input
              type="number"
              min="1"
              max="365"
              value={settingsDraft.max_surprise_days}
              onChange={(event) =>
                updateSettings("max_surprise_days", Number(event.target.value))
              }
            />
          </label>
        )}
        {status.surprise_shutdown_required &&
          settingsDraft.surprise_enabled !== true && (
            <label>
              关闭后怎样处理已经准备的秘密内容
              <select
                value={hiddenAction}
                onChange={(event) => setHiddenAction(event.target.value)}
              >
                <option value="reveal">已完成作品立即揭晓，未完成任务取消</option>
                <option value="delete">全部永久删除</option>
              </select>
              <small>
                DengTa 不会把秘密任务无限留在后台，也不会替你做不可撤销的选择。
              </small>
            </label>
          )}
        <button className="primary-button" disabled={Boolean(busy)}>
          {busy === "settings" ? "保存中…" : "保存创作权限"}
        </button>
      </form>

      <form
        id="creative-provider-settings"
        className="creative-provider-form"
        onSubmit={saveProvider}
      >
        {providerCredentialRecoveryRequired && (
          <div className="creative-provider-reentry" role="alert">
            <strong>请重新填写图片 API Key / Re-enter image API key</strong>
            <small>
              旧密钥无法由当前后端解密；请在下方填写新密钥并保存。保存配置不会调用图片模型，也不会产生生成费用。 / The old key cannot be decrypted by this backend. Enter a new key below and save. Saving does not call the image model or incur generation charges.
            </small>
          </div>
        )}
        <div className="provider-section-title">
          <div>
            <strong>图片生成接口</strong>
            <small>
              支持 OpenAI Images API 兼容接口。选预设可直接填地址和模型；也可以复用当前聊天接口的密钥，少粘贴一次 API Key。
            </small>
          </div>
          <button
            type="button"
            className="creative-provider-reuse"
            onClick={reuseChatProvider}
            disabled={busy === "provider-chat"}
          >
            {busy === "provider-chat" ? "正在复用…" : "复用聊天接口"}
          </button>
        </div>
        <div className="creative-provider-grid">
          <label className="creative-provider-wide">
            快速配置
            <select
              value={providerPreset}
              onChange={(event) => applyProviderPreset(event.target.value)}
            >
              {IMAGE_PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
            <small>预设只填 Base URL 和模型名；仍需填该服务的 API Key，或点右上角“复用聊天接口”。</small>
          </label>
          <label>
            显示名称
            <input
              value={providerDraft.name || ""}
              onChange={(event) => updateProvider("name", event.target.value)}
              placeholder="例如：我的图片 API"
            />
          </label>
          <label>
            图片模型
            <input
              value={providerDraft.model || ""}
              onChange={(event) => updateProvider("model", event.target.value)}
              placeholder="例如：gpt-image-1"
              autoCapitalize="none"
              spellCheck="false"
            />
          </label>
          <label className="creative-provider-wide">
            Base URL
            <input
              type="url"
              value={providerDraft.base_url || ""}
              onChange={(event) =>
                updateProvider("base_url", event.target.value)
              }
              placeholder="https://api.example.com/v1"
              autoCapitalize="none"
              spellCheck="false"
            />
            <small>
              可填 API 根地址或完整的 /images/generations 地址，不要填控制台网页。
            </small>
          </label>
          <label>
            授权方式
            <select
              value={providerDraft.auth_type || "bearer"}
              onChange={(event) =>
                updateProvider("auth_type", event.target.value)
              }
            >
              <option value="bearer">Bearer API Key</option>
              <option value="none">无需密钥</option>
            </select>
          </label>
          {providerDraft.auth_type !== "none" && (
            <label>
              {providerDraft.auth_configured
                ? "更新图片 API Key（可留空）"
                : providerCredentialRecoveryRequired
                  ? "重新填写图片 API Key / Re-enter image API key"
                  : "图片 API Key"}
              <input
                type="password"
                required={providerCredentialRecoveryRequired}
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                placeholder={
                  providerDraft.auth_configured
                    ? "已加密保存；只在更换时填写"
                    : providerCredentialRecoveryRequired
                      ? "必须重新粘贴；旧密钥无法恢复"
                      : "粘贴图片供应商 API Key"
                }
                autoComplete="new-password"
              />
            </label>
          )}
          <label className="creative-switch-row creative-provider-wide">
            <input
              type="checkbox"
              checked={providerDraft.enabled === true}
              onChange={(event) =>
                updateProvider("enabled", event.target.checked)
              }
            />
            <span>
              <strong>启用这个图片接口</strong>
              <small>
                只有启用后，确认生成或自主创作才会真实调用它。
              </small>
            </span>
          </label>
        </div>
        <div className="creative-provider-summary">
          <span>
            最近 24 小时调用 <strong>{status.usage.day}</strong> 次
          </span>
          <span>
            最近 31 天调用 <strong>{status.usage.month}</strong> 次
          </span>
          <span>
            状态 <strong>{status.provider.last_status}</strong>
          </span>
          {status.provider.provider_family && (
            <span>
              协议适配{" "}
              <strong>
                {PROVIDER_FAMILY_LABELS[status.provider.provider_family] ||
                  status.provider.provider_family}
              </strong>
            </span>
          )}
          {status.provider.last_error_code && (
            <span className="artwork-error">
              最近失败：
              <strong>
                {creativeFailureMessage(status.provider.last_error_code)}
              </strong>
            </span>
          )}
        </div>
        <button className="primary-button" disabled={Boolean(busy)}>
          {busy === "provider" ? "安全保存中…" : "保存配置（不调用图片模型）"}
        </button>
      </form>
    </section>
  );
}
