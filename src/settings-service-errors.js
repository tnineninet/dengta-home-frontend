const SETTINGS_SERVICE_ERROR_MESSAGES = Object.freeze({
  AI_PROVIDER_CREDENTIAL_INVALID:
    "已保存的接口密钥无法由当前后端解密。请在对应接口卡片重新粘贴 API Key，保存修改后再检查模型目录 / The saved provider key cannot be decrypted by this backend. Re-enter the API key, save the profile, then check the model catalog.",
  AI_PROVIDER_CREDENTIAL_REQUIRED:
    "请先填写接口 API Key / Enter the provider API key before continuing.",
  AI_PROVIDER_MODEL_REQUIRED:
    "请先填写默认模型 / Enter a default model before enabling this provider.",
  AI_PROVIDER_MIGRATION_REQUIRED:
    "模型接口数据库尚未准备完成 / The provider database migration is not ready yet.",
  AI_PROVIDER_UPSTREAM_AUTH_FAILED:
    "供应商拒绝了接口凭据。请检查 API Key、账号权限和模型访问权限 / The provider rejected the credential. Check the API key, account permissions, and model access.",
  AI_PROVIDER_MODEL_CATALOG_UNAVAILABLE:
    "供应商没有提供可读取的模型目录。请核对 Base URL 和接口类型 / The provider model catalog is unavailable. Check the Base URL and protocol.",
  AI_PROVIDER_UPSTREAM_RATE_LIMITED:
    "供应商暂时限制请求。请检查额度或稍后重试 / The provider rate-limited the request. Check quota or retry later.",
  AI_PROVIDER_UPSTREAM_REJECTED:
    "供应商拒绝了模型目录检查。请核对接口配置和访问策略 / The provider rejected the model catalog probe. Check the endpoint configuration and access policy.",
  AI_PROVIDER_UPSTREAM_TIMEOUT:
    "供应商接口响应超时，请稍后重试 / The provider request timed out. Try again later.",
  AI_PROVIDER_UPSTREAM_UNAVAILABLE:
    "供应商接口暂时不可用，请稍后重试 / The provider is temporarily unavailable. Try again later.",
  MCP_CREDENTIAL_INVALID:
    "已保存的设备凭据无法由当前后端解密。请在对应 MCP 连接重新填写令牌并保存 / The saved device credential cannot be decrypted by this backend. Re-enter the token on that MCP connection and save it.",
  MCP_ENCRYPTION_NOT_CONFIGURED:
    "后端尚未配置凭据加密密钥；需要令牌的连接暂时不能保存 / The backend credential-encryption key is not configured, so token-protected connections cannot be saved yet.",
});

const MESSAGE_CODE_PATTERNS = Object.freeze([
  [
    /接口凭据无法解密|provider (?:credential|key).*(?:cannot|could not) be decrypted/i,
    "AI_PROVIDER_CREDENTIAL_INVALID",
  ],
  [
    /无法解密设备凭据|device credential.*(?:cannot|could not) be decrypted/i,
    "MCP_CREDENTIAL_INVALID",
  ],
]);

function inferredCode(source = {}) {
  const explicit = String(source?.code || "").trim();
  if (explicit) return explicit;
  const message = String(source?.message || source || "");
  return MESSAGE_CODE_PATTERNS.find(([pattern]) => pattern.test(message))?.[1] || "";
}

export function settingsServiceErrorMessage(source, fallback) {
  const mapped = SETTINGS_SERVICE_ERROR_MESSAGES[inferredCode(source)];
  if (mapped) return mapped;
  const message = String(source?.message || source || "").trim();
  return message || fallback;
}

function httpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

export function settingsServiceErrorDetail(source, fallback) {
  const message = settingsServiceErrorMessage(source, fallback);
  const code = inferredCode(source);
  const status = httpStatus(source?.status);
  const upstreamStatus = httpStatus(
    source?.upstream_status ?? source?.upstreamStatus,
  );
  const diagnostic = [
    code,
    status ? `后端 HTTP ${status}` : "",
    upstreamStatus ? `上游 HTTP ${upstreamStatus}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return diagnostic ? `${message}\n${diagnostic}` : message;
}

export function providerCredentialNeedsRecovery(profile = {}) {
  const detail = String(profile?.health?.detail || "");
  return MESSAGE_CODE_PATTERNS[0][0].test(detail);
}
