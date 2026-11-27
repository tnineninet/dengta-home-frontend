/**
 * Smart Screen Change Monitor & Timestamped Screen Evidence Store.
 *
 * Detects meaningful visual screen changes (perceptual 32x18 luminance/RGB delta)
 * and foreground app switches, stores compact timestamped thumbnails in a local
 * session registry so chat messages can display interactive "截屏依据" cards
 * showing EXACTLY when and what screen frame the companion saw.
 */

export const SCREEN_DIFF_WIDTH = 32;
export const SCREEN_DIFF_HEIGHT = 18;
export const SCREEN_CHANGE_DEFAULT_THRESHOLD = 18; // percent (0-100)
export const SCREEN_CHANGE_MIN_COOLDOWN_MS = 12_000;
export const MAX_SCREEN_EVIDENCE_ITEMS = 6;

const evidenceRegistryById = new Map();
const evidenceListeners = new Set();
let recentEvidenceList = [];

export function formatEvidenceTimeLabel(isoOrDate = new Date()) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Compute mean absolute perceptual pixel difference (0..100%) between two
 * equal-length Uint8ClampedArray / Uint8Array luminance vectors.
 */
export function computeLumaChangePercent(prevLuma, nextLuma) {
  if (!prevLuma || !nextLuma || prevLuma.length === 0 || prevLuma.length !== nextLuma.length) {
    return 100;
  }
  let diffSum = 0;
  let significantPixels = 0;
  for (let i = 0; i < prevLuma.length; i += 1) {
    const delta = Math.abs(prevLuma[i] - nextLuma[i]);
    diffSum += delta;
    if (delta >= 22) significantPixels += 1;
  }
  const meanPct = (diffSum / (prevLuma.length * 255)) * 100;
  const areaPct = (significantPixels / prevLuma.length) * 100;
  // Blend pixel-area change and intensity change for reliable UI switch detection.
  return Math.min(100, Math.round(areaPct * 0.65 + meanPct * 1.15));
}

export function shouldTriggerAutoScreenCapture({
  changeScore = 0,
  appChanged = false,
  elapsedMs = Number.POSITIVE_INFINITY,
  threshold = SCREEN_CHANGE_DEFAULT_THRESHOLD,
  cooldownMs = SCREEN_CHANGE_MIN_COOLDOWN_MS,
} = {}) {
  if (appChanged) {
    return elapsedMs >= Math.min(4000, cooldownMs);
  }
  if (elapsedMs < cooldownMs) return false;
  return changeScore >= threshold;
}

/**
 * Downsample an HTMLVideoElement or HTMLImageElement into a compact 32x18 luminance vector.
 */
export function extractLumaSignature(mediaEl) {
  if (!mediaEl || typeof document === "undefined") return null;
  const w = mediaEl.videoWidth || mediaEl.naturalWidth || mediaEl.width || 0;
  const h = mediaEl.videoHeight || mediaEl.naturalHeight || mediaEl.height || 0;
  if (!w || !h) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SCREEN_DIFF_WIDTH;
    canvas.height = SCREEN_DIFF_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(mediaEl, 0, 0, SCREEN_DIFF_WIDTH, SCREEN_DIFF_HEIGHT);
    const { data } = ctx.getImageData(0, 0, SCREEN_DIFF_WIDTH, SCREEN_DIFF_HEIGHT);
    const luma = new Uint8Array(SCREEN_DIFF_WIDTH * SCREEN_DIFF_HEIGHT);
    for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) {
      luma[i] = Math.round(data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
    }
    return luma;
  } catch {
    return null;
  }
}

export async function createThumbnailDataUrlFromFile(file, { maxEdge = 360, quality = 0.68 } = {}) {
  if (!file || typeof document === "undefined") return "";
  let objectUrl = "";
  try {
    let source = null;
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(file);
    } else {
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      source = img;
    }
    const sw = source.width || source.naturalWidth || 0;
    const sh = source.height || source.naturalHeight || 0;
    if (!sw || !sh) {
      source.close?.();
      return "";
    }
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      source.close?.();
      return "";
    }
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return "";
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore.
      }
    }
  }
}

export async function extractLumaSignatureFromFile(file) {
  if (!file || typeof document === "undefined") return null;
  let objectUrl = "";
  try {
    let source = null;
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(file);
    } else {
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      source = img;
    }
    const sig = extractLumaSignature(source);
    source.close?.();
    return sig;
  } catch {
    return null;
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore.
      }
    }
  }
}

export function registerScreenEvidence(entry) {
  if (!entry || !entry.id) return null;
  const normalized = {
    id: String(entry.id),
    kind: entry.kind === "camera" ? "camera" : "screen",
    captured_at: entry.captured_at || new Date().toISOString(),
    time_label: entry.time_label || formatEvidenceTimeLabel(entry.captured_at || new Date()),
    app_name: String(entry.app_name || "").trim().slice(0, 40),
    trigger_reason: String(entry.trigger_reason || "屏幕内容显著变化").trim().slice(0, 40),
    change_score: Math.max(0, Math.min(100, Math.round(Number(entry.change_score) || 0))),
    thumbnail_data_url: String(entry.thumbnail_data_url || ""),
    file: entry.file || null,
  };
  evidenceRegistryById.set(normalized.id, normalized);
  if (normalized.kind === "screen") {
    recentEvidenceList = [
      normalized,
      ...recentEvidenceList.filter((item) => item.id !== normalized.id),
    ].slice(0, MAX_SCREEN_EVIDENCE_ITEMS);
  }
  if (evidenceRegistryById.size > 24) {
    const oldestKey = evidenceRegistryById.keys().next().value;
    if (oldestKey) evidenceRegistryById.delete(oldestKey);
  }
  evidenceListeners.forEach((cb) => {
    try {
      cb(recentEvidenceList);
    } catch {
      // Ignore subscriber errors.
    }
  });
  return normalized;
}

export function getScreenEvidenceById(id) {
  return evidenceRegistryById.get(String(id || "")) || null;
}

export function getRecentScreenEvidence() {
  return recentEvidenceList;
}

export function clearScreenEvidenceHistory() {
  recentEvidenceList = [];
  evidenceListeners.forEach((cb) => {
    try {
      cb(recentEvidenceList);
    } catch {
      // Ignore.
    }
  });
}

export function subscribeScreenEvidence(callback) {
  if (typeof callback !== "function") return () => {};
  evidenceListeners.add(callback);
  return () => {
    evidenceListeners.delete(callback);
  };
}

export function serializeEvidenceForPayload(entry) {
  if (!entry) return null;
  return {
    id: String(entry.id || "").slice(0, 64),
    kind: entry.kind === "camera" ? "camera" : "screen",
    captured_at: String(entry.captured_at || "").slice(0, 64),
    time_label: String(entry.time_label || "").slice(0, 16),
    app_name: String(entry.app_name || "").slice(0, 40),
    trigger_reason: String(entry.trigger_reason || "").slice(0, 40),
    change_score: Math.max(0, Math.min(100, Math.round(Number(entry.change_score) || 0))),
  };
}
