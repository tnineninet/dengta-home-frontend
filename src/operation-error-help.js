import { CHAT_ERROR_FEEDBACK } from "./chat-error-feedback.js";

export function describeOperationError(source = {}) {
  const raw = String(source.code || source.error_code || "");
  const code = /^[a-z0-9_:-]{1,80}$/i.test(raw) && !/^(?:sk-|sb_secret_|ghp_|eyJ)/.test(raw) ? raw : "unknown";
  const known = Object.hasOwn(CHAT_ERROR_FEEDBACK, code) ? CHAT_ERROR_FEEDBACK[code] : null;
  if (known) return { code, ...known, settingsCategory: code.startsWith("provider_") || code === "context_budget_exceeded" ? "services" : null };
  const status = Number(source.status);
  if (status === 401) return { code, reason: "当前请求没有有效的灯塔登录状态。", action: "重新登录后，再刷新这项数据。", settingsCategory: null };
  if (status === 403) return { code, reason: "当前账号没有读取这项数据的权限。", action: "核对当前账号和伴侣；不要重复提交，确认权限后再刷新。", settingsCategory: null };
  if (status === 413) return { code, reason: "本次请求超过了服务允许的大小。", action: "保留原文，检查接口的请求大小限制，或更换能接收更大请求的服务后重试。", settingsCategory: "services" };
  if (code === "private_media_refresh_failed") return { code, reason: "图片操作已经提交，但目录刷新没有成功。", action: "点击刷新核对结果，避免重复上传或删除。", settingsCategory: "appearance" };
  return { code, reason: "这次操作没有完成确认，现有日志尚未指出具体原因。", action: "先刷新核对结果；若仍失败，展开技术详情，使用错误代码和请求阶段排查。", settingsCategory: null };
}
