import { apiFetch, apiRequest } from "./api.js";
import { readTextFileBatches } from "./large-text-file.js";

export const CONTENT_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
export const CONTENT_IMPORT_PAGED_MAX_BYTES = 1024 ** 3;
export const CONTENT_IMPORT_PAGED_EXTENSIONS = /\.(txt|text|md|markdown|log|csv|tsv|jsonl|ndjson)$/i;

const IMPORT_ERROR_MESSAGES = Object.freeze({
  payload_too_large: "导入文件超过 100MB，请拆分后重试。",
  file_too_large: "导入文件超过 100MB，请拆分后重试。",
  import_paged_file_too_large: "文本文件超过 1GB，请拆分后重试。",
  import_paged_preview_required: "此文件需要在数据导入面板分段预览，不能整份上传。",
  import_record_too_large: "单条 CSV 或 JSONL 记录超过 1MB，请拆分该记录或导出为纯文本。",
  import_file_too_large: "导入文件超过 100MB，请拆分后重试。",
  unsupported_file_type: "此入口不支持该格式，请选择 TXT、Markdown、JSON、CSV、TSV、JSONL、HTML、字幕、邮件、PDF 或 DOCX。",
  import_file_type_unsupported: "此格式不能作为文本读取；旧 DOC 请另存为 DOCX，表格或压缩包请先导出文本。",
  import_media_type_unsupported: "仅支持 JSON、TXT 或 Markdown 文件。",
  import_media_type_mismatch: "文件扩展名与内容格式不匹配，请检查后重试。",
  unsupported_format: "无法识别所选格式，请更换格式后重试。",
  invalid_json: "JSON 内容无法解析，请检查格式是否完整。",
  import_json_invalid: "JSON 内容无法解析，请检查格式是否完整。",
  import_json_too_large: "JSON 结构超过单次解析容量，请导出为 JSONL 或拆成完整的 JSON 文件；系统没有截断或保存这份文件。",
  import_document_too_large: "PDF、DOCX 和邮件直传最多 20MB，请拆分或导出文本后重试。",
  import_csv_invalid: "CSV 的引号未闭合，请检查导出是否完整。",
  import_pdf_no_text: "扫描版 PDF 没有可提取的文字，请先进行 OCR 再导入。",
  invalid_import: "导入内容无法生成候选项，请检查文件或粘贴文本。",
  import_empty: "导入内容不能为空。",
  import_content_required: "请粘贴要导入的文本。",
  import_source_type_invalid: "请选择世界书或聊天记录后重试。",
  import_invalid_encoding: "无法识别文本编码，支持 UTF-8、带 BOM 的 UTF-16 和 GB18030；请另存为 UTF-8 后重试。",
  import_not_found: "这次导入预览已失效，请重新预览。",
  decisions_required: "每个候选项都必须明确选择接受或拒绝。",
  import_decision_invalid: "每个候选项都必须明确选择接受或拒绝。",
  import_decisions_incomplete: "必须为全部候选项选择接受或拒绝。",
  import_target_invalid: "候选项的写入位置无效，请重新选择。",
  import_time_unreliable: "这条日历线索缺少可靠时间，暂时不能接受。",
  import_already_committed: "这次导入已经提交，无需重复操作。",
  validation_error: "导入内容未通过校验，请检查候选项后重试。",
  authentication_required: "登录状态已失效，请重新登录后再导入。",
  import_scope_changed: "账号或伴侣已切换，旧导入操作已取消，请在当前面板重新选择文件。",
  import_commit_receipt_invalid: "提交结果尚未确认，请先检查提交结果，暂勿重复提交。",
  import_preview_receipt_invalid: "服务器返回的预览与本段不匹配，请保留进度并查看错误日志。",
  import_read_failed: "文件读取失败，请确认原文件仍可访问，再重新选择后重试。",
  import_cancelled: "读取已取消，可以重新选择原文件继续。",
  request_timeout: "请求超时。提交操作请先检查提交结果；预览或日志读取可检查网络后重试。",
  import_binary_disguised: "文件实际是二进制文档，无法按文本分段读取。请使用真实扩展名或导出为文本。",
});

export const CONTENT_IMPORT_ERROR_FEEDBACK = Object.freeze(Object.fromEntries(
  Object.entries(IMPORT_ERROR_MESSAGES).map(([code, reason]) => [code, {
    reason,
    action: "预览失败可以修正文件后重试。提交回执未确认时，先检查提交结果，避免重复写入。",
  }]),
));

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
  error.error_log_id = source?.error_log_id;
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
  const limit = CONTENT_IMPORT_PAGED_EXTENSIONS.test(file.name) ? CONTENT_IMPORT_PAGED_MAX_BYTES : CONTENT_IMPORT_MAX_BYTES;
  if (Number(file.size) > limit) {
    throw importError({ code: limit === CONTENT_IMPORT_PAGED_MAX_BYTES ? "import_paged_file_too_large" : "file_too_large" });
  }
  if (!/\.(json|txt|text|md|markdown|log|csv|tsv|jsonl|ndjson|html|htm|srt|vtt|eml|pdf|docx|xml|yaml|yml|ini|conf)$/i.test(String(file.name || ""))) {
    throw importError({ code: "unsupported_file_type" });
  }
  return file;
}

export async function previewContentImportPage({ file, kind, startByte = 0, signal }, client = defaultClient) {
  validateImportFile(file);
  if (!CONTENT_IMPORT_PAGED_EXTENSIONS.test(file.name)) throw importError({code:'unsupported_file_type'});
  let text = '';
  const suffix = file.name.split('.').pop().toLowerCase();
  for await (const batch of readTextFileBatches(file, { startByte, chunkBytes: 64 * 1024, signal })) {
    text += batch.text;
    if (text.length > 1024 * 1024) throw importError({code:'import_record_too_large'});
    if (batch.endByte < file.size) {
      if (['jsonl','ndjson'].includes(suffix) && !/\r?\n$/.test(text)) continue;
      if (suffix === 'csv') {
        let quoted = false;
        for (let index=0;index<text.length;index++) if (text[index] === '"') {
          if (quoted && text[index+1] === '"') index++; else quoted = !quoted;
        }
        if (quoted || !/\r?\n$/.test(text)) continue;
      }
    }
    const part = new File([text], `part-${startByte}-${batch.endByte}.${suffix}`, { type: 'text/plain' });
    signal?.throwIfAborted();
    const data = await previewContentImport({ file: part, kind, signal }, client);
    return { data, page: { startByte, endByte: batch.endByte, totalBytes: file.size } };
  }
  throw importError({code:'import_empty'});
}

export function listContentImports(client = defaultClient) {
  return jsonImportRequest("/api/v2/imports/", undefined, client);
}

export function getContentImport(importId, client = defaultClient) {
  return jsonImportRequest(`/api/v2/imports/${encodeURIComponent(importId)}`, undefined, client);
}

export function previewContentImport(
  { file, kind, format = "auto", content = "", signal },
  client = defaultClient,
) {
  if (file) {
    validateImportFile(file);
    if (file.size > CONTENT_IMPORT_MAX_BYTES) throw importError({code:'import_paged_preview_required'});
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("kind", kind);
    formData.append("format", format);
    formData.append("source_type", kind);
    return formImportRequest(formData, signal ? { apiFetch: (path,options) => client.apiFetch(path,{...options,signal}), apiRequest:client.apiRequest } : client);
  }
  const mediaType = mediaTypeFor(format, content);
  return jsonImportRequest(
    "/api/v2/imports/preview",
    {
      method: "POST",
      ...(signal ? { signal } : {}),
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

export function commitContentImport(importId, decisions, client = defaultClient, options = {}) {
  return jsonImportRequest(
    `/api/v2/imports/${encodeURIComponent(importId)}/commit`,
    { ...options, method: "POST", body: JSON.stringify({ decisions }) },
    client,
  );
}
