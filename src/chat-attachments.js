export const CHAT_ATTACHMENT_MAX_FILES = 4;
export const CHAT_ATTACHMENT_MAX_FILE_BYTES = 12 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/json",
  "application/xml",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/xml",
]);

const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "docx",
  "json",
  "md",
  "pdf",
  "txt",
  "xml",
]);

function cleanText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function extensionOf(name) {
  const matched = cleanText(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return matched?.[1] || "";
}

export function attachmentKind(fileLike = {}) {
  const type = cleanText(fileLike.type || fileLike.mime_type).toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (DOCUMENT_MIME_TYPES.has(type)) return "document";
  if (DOCUMENT_EXTENSIONS.has(extensionOf(fileLike.name || fileLike.file_name))) {
    return "document";
  }
  return "unsupported";
}

export function formatAttachmentSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "大小未知";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function validateAttachmentFiles(existing = [], incoming = []) {
  const current = Array.isArray(existing) ? existing : [];
  const selected = Array.from(incoming || []);
  const accepted = [];
  const rejected = [];
  let totalBytes = current.reduce(
    (sum, item) => sum + Math.max(0, Number(item?.size || item?.file?.size || 0)),
    0,
  );

  for (const file of selected) {
    if (current.length + accepted.length >= CHAT_ATTACHMENT_MAX_FILES) {
      rejected.push(`${cleanText(file?.name) || "未命名文件"}：一条消息最多添加 4 个附件`);
      continue;
    }

    if (attachmentKind(file) === "unsupported") {
      rejected.push(
        `${cleanText(file?.name) || "未命名文件"}：暂不支持这种文件，只能选择图片、文档或音频`,
      );
      continue;
    }

    const size = Math.max(0, Number(file?.size || 0));
    if (size === 0) {
      rejected.push(`${cleanText(file?.name) || "未命名文件"}：文件为空`);
      continue;
    }

    if (size > CHAT_ATTACHMENT_MAX_FILE_BYTES) {
      rejected.push(
        `${cleanText(file?.name) || "未命名文件"}：单个附件不能超过 12MB`,
      );
      continue;
    }

    if (totalBytes + size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
      rejected.push(
        `${cleanText(file?.name) || "未命名文件"}：全部附件合计不能超过 20MB`,
      );
      continue;
    }

    accepted.push(file);
    totalBytes += size;
  }

  return { accepted, rejected, totalBytes };
}

export function createAttachmentDraft(file, urlApi = globalThis.URL) {
  const kind = attachmentKind(file);
  const previewUrl =
    kind === "image" && typeof urlApi?.createObjectURL === "function"
      ? urlApi.createObjectURL(file)
      : "";

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    name: cleanText(file?.name) || "未命名文件",
    type: cleanText(file?.type) || "application/octet-stream",
    size: Math.max(0, Number(file?.size || 0)),
    kind,
    previewUrl,
  };
}

export function revokeAttachmentDraft(draft, urlApi = globalThis.URL) {
  if (draft?.previewUrl && typeof urlApi?.revokeObjectURL === "function") {
    urlApi.revokeObjectURL(draft.previewUrl);
  }
}

function safeAttachmentUrl(rawValue, kind, apiBaseUrl = "") {
  const value = cleanText(rawValue, 8_000);
  if (!value) return "";

  if (kind === "image" && /^data:image\/(?:avif|gif|jpeg|jpg|png|webp);base64,/i.test(value)) {
    return value;
  }
  if (/^blob:/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/") && /^https?:\/\//i.test(apiBaseUrl)) {
    return `${apiBaseUrl.replace(/\/$/, "")}${value}`;
  }
  return "";
}

export function normalizeMessageAttachments(value, apiBaseUrl = "") {
  if (!Array.isArray(value)) return [];

  return value.slice(0, CHAT_ATTACHMENT_MAX_FILES).map((item, index) => {
    const source = item && typeof item === "object" ? item : {};
    const name =
      cleanText(source.name || source.file_name || source.filename) ||
      `附件 ${index + 1}`;
    const type = cleanText(source.type || source.mime_type || source.content_type);
    const kind = attachmentKind({ name, type });
    const rawUrl =
      source.previewUrl ||
      source.preview_url ||
      source.download_url ||
      source.url ||
      source.path;

    return {
      id: cleanText(source.id) || `${name}-${index}`,
      name,
      type,
      size: Math.max(0, Number(source.size || source.file_size || 0)),
      kind: kind === "unsupported" ? "document" : kind,
      url: safeAttachmentUrl(rawUrl, kind, apiBaseUrl),
    };
  });
}

export function draftsForLocalMessage(drafts = []) {
  return drafts.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    size: item.size,
    previewUrl: item.previewUrl,
  }));
}
