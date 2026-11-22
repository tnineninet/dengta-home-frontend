// 「模型接入」表单的纯函数：不依赖 React，便于在 node:test 中直接回归。
// 这里只处理表单状态与保存意图，不改变后端校验、鉴权或供应商协议。

export const AUTO_CATALOG_DEBOUNCE_MS = 900;
export const AUTO_CATALOG_MIN_KEY_LENGTH = 8;

export const INITIAL_CATALOG_HINT =
  "填好 Base URL 和 API Key 后，会自动读取模型目录、选好模型并准备启用；最后只需点一次「保存并启用」。";

function trimmed(value) {
  return String(value ?? "").trim();
}

export function normalizeProviderBaseUrl(value) {
  return trimmed(value);
}

function providerAuthType(draft = {}) {
  return trimmed(draft.auth_type) || "bearer";
}

export function isProviderAutoCatalogReady(draft = {}) {
  const baseUrl = normalizeProviderBaseUrl(draft.base_url);
  if (!/^https:\/\/[^\s/]+/i.test(baseUrl)) return false;
  if (providerAuthType(draft) === "none") return true;
  return trimmed(draft.credential).length >= AUTO_CATALOG_MIN_KEY_LENGTH;
}

export function providerDraftSignature(draft = {}) {
  return [
    trimmed(draft.protocol) || "openai-chat",
    normalizeProviderBaseUrl(draft.base_url),
    providerAuthType(draft),
    trimmed(draft.credential),
  ].join("|");
}

export function suggestProviderName(draft = {}) {
  const baseUrl = normalizeProviderBaseUrl(draft.base_url);
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./i, "").trim();
    if (host) return host.slice(0, 80);
  } catch {
    // 输入尚未成为完整 URL 时继续使用下面的兜底名称。
  }
  return "我的模型接口";
}

// 新建保存必须显式启用并设为首选：模型目录读通 ≠ 参与聊天路由。
// 保存后的真实状态仍以后端返回的 profile 为准（见 providerActivationView）。
export function buildProviderCreateIntent(draft = {}) {
  return {
    ...draft,
    name: trimmed(draft.name) || suggestProviderName(draft),
    default_model: trimmed(draft.default_model),
    enabled: true,
    is_default: true,
  };
}

export function mergeCatalogSelection(draft = {}, models = []) {
  const currentModel = trimmed(draft.default_model);
  const firstModel = (Array.isArray(models) ? models : [])
    .map((model) => trimmed(model))
    .find(Boolean) || "";
  return {
    default_model: currentModel || firstModel,
    auto_selected_model: currentModel ? "" : firstModel,
    enabled: true,
    is_default: true,
  };
}

export function providerActivationView(profile = null) {
  if (!profile || typeof profile !== "object") {
    return {
      state: "unknown",
      enabled: false,
      isDefault: false,
      message:
        "保存请求已完成，但没有收到接口状态回执；请点「刷新接口列表」核对是否已启用。",
    };
  }
  const enabled = profile.enabled === true;
  const isDefault = profile.is_default === true;
  if (enabled && isDefault) {
    return {
      state: "active",
      enabled,
      isDefault,
      message: "接口已加密保存并启用，已设为下次聊天首选；现在可以直接去聊天。",
    };
  }
  if (enabled) {
    return {
      state: "enabled",
      enabled,
      isDefault,
      message:
        "接口已保存并启用，但还不是下次聊天首选；点右侧按钮设为下次聊天首选。",
    };
  }
  return {
    state: "disabled",
    enabled,
    isDefault,
    message:
      "接口已保存，但后端返回的状态是未启用；聊天仍不会使用它。点右侧按钮完成启用。",
  };
}
