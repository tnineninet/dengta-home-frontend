export const CHAT_MODEL_STORAGE_KEY = "dengta_chat_model_v1";

function cleanText(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeModel(item) {
  if (typeof item === "string") {
    const id = cleanText(item);
    return id ? { id, label: id } : null;
  }

  if (!item || typeof item !== "object") return null;
  const id = cleanText(item.id || item.model || item.value || item.name);
  if (!id) return null;
  return {
    id,
    label: cleanText(item.label || item.display_name || item.name) || id,
  };
}

export function normalizeModelsResponse(value, fallbackModel = "") {
  const source = value && typeof value === "object" ? value : {};
  const rawModels = Array.isArray(source.models)
    ? source.models
    : Array.isArray(source.available_models)
      ? source.available_models
      : Array.isArray(source.data)
        ? source.data
        : [];
  const seen = new Set();
  const models = [];

  for (const item of rawModels) {
    const model = normalizeModel(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }

  const currentModel = cleanText(
    source.current_model || source.current || source.model || fallbackModel,
  );
  if (currentModel && !seen.has(currentModel)) {
    models.unshift({ id: currentModel, label: currentModel });
  }

  return { models, currentModel };
}

export function readStoredChatModel(storage = globalThis.localStorage) {
  try {
    return cleanText(storage?.getItem(CHAT_MODEL_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function storeChatModel(value, storage = globalThis.localStorage) {
  const model = cleanText(value);
  try {
    if (model) storage?.setItem(CHAT_MODEL_STORAGE_KEY, model);
    else storage?.removeItem(CHAT_MODEL_STORAGE_KEY);
  } catch {
    // 本机存储不可用时只影响下次启动的选择，不影响当前聊天。
  }
  return model;
}

export function chooseChatModel({ models = [], stored = "", current = "", fallback = "" }) {
  const available = new Set(models.map((item) => item.id));
  const candidates = [stored, current, fallback, models[0]?.id]
    .map((item) => cleanText(item))
    .filter(Boolean);
  return candidates.find((item) => available.size === 0 || available.has(item)) || "";
}
