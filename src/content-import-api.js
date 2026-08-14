import { apiFetch, apiRequest } from "./api.js";

export const CONTENT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

const IMPORT_ERROR_MESSAGES = Object.freeze({
  payload_too_large: "导入文件超过 10MB，请拆分后重试。",
  file_too_large: "导入文件超过 10MB，请拆分后重试。",
  import_file_too_large: "导入文件超过 10MB，请拆分后重试。",
  unsupported_file_type: "仅支持 JSON、TXT 或 Markdown 文件。",
  import_file_type_unsupported: "仅支持 JSON、TXT 或 Markdown 文件。",
  import_media_type_unsupported: "仅支持 JSON、TXT 或 Markdown 文件。",
  import_media_type_mismatch: "文件扩展名与内容格式不匹配，请检查后重试。",
  unsupported_format: "无法识别所选格式，请更换格式后重试。",
  invalid_json: "JSON 内容无法解析，请检查格式是否完整。",
  import_json_invalid: "JSON 内容无法解析，请检查格式是否完整。",
  invalid_import: "导入内容无法生成候选项，请检查文件或粘贴文本。",
  import_empty: "导入内容不能为空。",
  import_content_required: "请粘贴要导入的文本。",
  import_source_type_invalid: "请选择世界书或聊天记录后重试。",
  import_invalid_encoding: "文件必须使用 UTF-8 编码。",
  import_not_found: "这次导入预览已失效，请重新预览。",
  decisions_required: "每个候选项都必须明确选择接受或拒绝。",
  import_decision_invalid: "每个候选项都必须明确选择接受或拒绝。",
  import_decisions_incomplete: "必须为全部候选项选择接受或拒绝。",
  import_target_invalid: "候选项的写入位置无效，请重新选择。",
  import_time_unreliable: "这条日历线索缺少可靠时间，暂时不能接受。",
  import_already_committed: "这次导入已经提交，无需重复操作。",
  validation_error: "导入内容未通过校验，请检查候选项后重试。",
  authentication_required: "登录状态已失效，请重新登录后再导入。",
});

export function translatedImportError(source, fallback) {
  const code = String(source?.code || "").toLowerCase();
  if (IMPORT_ERROR_MESSAGES[code]) return IMPORT_ERROR_MESSAGES[code];
  const detail = String(source?.message || source?.detail || "").trim();
  return detail || fallback;
}

function importError(source, fallback, status) {
  const error = new Error(translatedImportError(source, fallback), {
    cause: source instanceof Error ? source : undefined,
  });
  error.code = source?.code || "content_import_failed";
  error.status = status ?? source?.status;
  return error;
}

async function jsonImportRequest(path, options, client) {
  try {
    return await client.apiRequest(path, options);
  } catch (error) {
    throw importError(error, "导入请求失败，请稍后重试。");
  }
}

async function formImportRequest(formData, client) {
  let response;
  try {
    response = await client.apiFetch("/api/v2/imports/preview", {
      method: "POST",
      body: formData,
      retry: false,
    });
  } catch (error) {
    throw importError(error, "无法上传文件，请检查网络后重试。");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw importError(data, `文件预览失败（HTTP ${response.status}）。`, response.status);
  }
  return data;
}

const defaultClient = { apiFetch, apiRequest };

function mediaTypeFor(format, content = "") {
  if (["sillytavern", "generic_json"].includes(format)) return "application/json";
  if (format === "plain_text") return "text/plain";
  return /^\s*[[{]/.test(content) ? "application/json" : "text/plain";
}

export function validateImportFile(file) {
  if (!file) throw importError({}, "请选择要导入的文件。");
  if (Number(file.size) > CONTENT_IMPORT_MAX_BYTES) {
    throw importError({ code: "file_too_large" });
  }
  if (!/\.(json|txt|text|md|markdown|log|csv)$/i.test(String(file.name || ""))) {
    throw importError({ code: "unsupported_file_type" });
  }
  return file;
}

export function listContentImports(client = defaultClient) {
  return jsonImportRequest("/api/v2/imports/", undefined, client);
}

export function getContentImport(importId, client = defaultClient) {
  return jsonImportRequest(`/api/v2/imports/${encodeURIComponent(importId)}`, undefined, client);
}

export function previewContentImport(
  { file, kind, format = "auto", content = "" },
  client = defaultClient,
) {
  if (file) {
    validateImportFile(file);
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("kind", kind);
    formData.append("format", format);
    formData.append("source_type", kind);
    return formImportRequest(formData, client);
  }
  const mediaType = mediaTypeFor(format, content);
  return jsonImportRequest(
    "/api/v2/imports/preview",
    {
      method: "POST",
      body: JSON.stringify({
        kind,
        format,
        content,
        source_type: kind,
        media_type: mediaType,
        source_name: mediaType === "application/json" ? "import.json" : "import.txt",
      }),
    },
    client,
  );
}

export function commitContentImport(importId, decisions, client = defaultClient) {
  return jsonImportRequest(
    `/api/v2/imports/${encodeURIComponent(importId)}/commit`,
    { method: "POST", body: JSON.stringify({ decisions }) },
    client,
  );
}
