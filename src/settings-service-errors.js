const SETTINGS_SERVICE_ERROR_MESSAGES = Object.freeze({
  AI_PROVIDER_CREDENTIAL_INVALID:
    "已保存的接口密钥无法由当前后端解密。请在对应接口卡片重新粘贴 API Key，保存修改后再检查模型目录 / The saved provider key cannot be decrypted by this backend. Re-enter the API key, save the profile, then check the model catalog.",
  AI_PROVIDER_CREDENTIAL_REQUIRED:
    "请先填写接口 API Key / Enter the provider API key before continuing.",
  AI_PROVIDER_MODEL_REQUIRED:
    "请先填写默认模型 / Enter a default model before enabling this provider.",
  AI_PROVIDER_MIGRATION_REQUIRED:
    "模型接口数据库尚未准备完成 / The provider database migration is not ready yet.",
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

export function providerCredentialNeedsRecovery(profile = {}) {
  const detail = String(profile?.health?.detail || "");
  return MESSAGE_CODE_PATTERNS[0][0].test(detail);
}
