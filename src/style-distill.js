import { publicChatErrorMessage } from "./chat-errors.js";

const LOCAL_ERRORS = {
  style_distill_source_short: "材料不足 40 字，请补充聊天记录后重试。",
  style_distill_source_long: "材料超过 6 万字，请分批提纯。",
  style_distill_file_required: "没有收到文件，请重新选择。",
  style_distill_file_empty: "文件中没有足够的文字，请换一个文件。",
  style_distill_file_too_large: "文件超过 20MB，请缩小文件后重试。",
  style_distill_file_invalid: "请一次上传一个文件。",
  style_distill_rate_limited: "提纯请求较频繁，请十分钟后重试。",
  style_distill_empty: "模型没有返回有效的提纯结果，请检查接口或补充材料后重试。",
  style_distill_model_unconfigured: "当前账号没有配置有效的模型或 API 密钥，请在「模型与服务」完成配置后重试。",
};

export function distillDiagnostic(error = {}) {
  return {
    error_code: error.code || "request_failed",
    provider_code: error.provider_code,
    error_source: error.error_source,
    provider_phase: error.provider_phase,
    upstream_status: error.upstream_status,
    error_location: error.error_location,
    error_log_id: error.error_log_id,
    path: error.path || "/api/v2/style-distill",
  };
}

// The deadline also covers authentication and reading the response body.
export async function requestDistill(path, options, request, timeoutMs = 180000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await request(path, { ...options, retry: false, signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = Object.assign(new Error(publicChatErrorMessage(data,
            LOCAL_ERRORS[data.code] || "提纯失败，请检查接口设置后重试。")), {
            status: response.status, code: data.code || "api_request_failed", path,
          });
          for (const key of ["provider_code", "error_source", "provider_phase", "upstream_status", "error_location", "error_log_id"]) {
            if (data[key] != null) error[key] = data[key];
          }
          throw error;
        }
        return data;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error("请求超时，材料仍然保留。请检查网络及接口后重试。"), { code: "request_timeout", path }));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
