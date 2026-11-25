// Zero-secret login failure diagnostics & troubleshooting helper (P0 from AI-HANDOVER §9.2).
// Never includes passwords, tokens, cookies, or raw full email addresses in diagnostic receipts.

export const DEPRECATED_LEGACY_EMAILS = new Set([
  "tnineninet@gmail.com",
  "buyaocaowo555@gmail.com",
]);

export function normalizeEmailInput(email = "") {
  return String(email || "").trim().toLowerCase();
}

export function isDeprecatedLegacyEmail(email = "") {
  return DEPRECATED_LEGACY_EMAILS.has(normalizeEmailInput(email));
}

export function maskEmailForReceipt(email = "") {
  const clean = normalizeEmailInput(email);
  if (!clean) return "(未填写)";
  const at = clean.indexOf("@");
  if (at <= 0) return "***";
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function classifyAuthFailureHint({
  errorCode = "",
  email = "",
  authCheck = null,
  isOnline = true,
} = {}) {
  const cleanEmail = normalizeEmailInput(email);
  const code = String(errorCode || "").trim().toLowerCase();

  if (isDeprecatedLegacyEmail(cleanEmail)) {
    return {
      tone: "warn",
      title: "检测到已停用的旧邮箱",
      detail: "该旧 Gmail 邮箱已停用，无法接收登录验证或重置密码邮件。请改用当前有效的主邮箱账号登录，或直接注册新邮箱。",
    };
  }

  if (isOnline === false || code === "auth_network_unavailable" || code === "auth_timeout" || authCheck?.status === "error") {
    return {
      tone: "network",
      title: "网络链路受阻（并非密码错误）",
      detail: "当前网络暂未连上登录认证服务。请切换 Wi-Fi/移动网络，或在中国大陆网络下开启网络加速后重试，无需反复重置密码。",
    };
  }

  if (code === "invalid_credentials") {
    return {
      tone: "credentials",
      title: "账号或密码未匹配",
      detail: "服务端连接正常；请核对：1) 邮箱拼写是否准确（目前仅启用邮箱+密码登录，未开启 Google 第三方登录）；2) 是否曾用新邮箱重新注册；3) 若忘记密码可点下方「忘记密码」。",
    };
  }

  if (["email_not_confirmed", "email_not_verified", "otp_expired", "access_denied"].includes(code)) {
    return {
      tone: "verification",
      title: "需完成邮箱验证",
      detail: "请打开最新验证邮件完成确认；若链接打不开，可点击「没收到邮箱验证邮件」粘贴原始链接直接在站内完成验证。",
    };
  }

  if (code === "auth_rate_limited" || code === "over_email_send_rate_limit") {
    return {
      tone: "warn",
      title: "触发频控保护",
      detail: "短时间内尝试次数过多，请等待 2–5 分钟后再试，避免连续点击导致冷却时间延长。",
    };
  }

  return null;
}

export function buildSanitizedAuthReceipt({
  mode = "login",
  email = "",
  errorCode = "",
  feedback = "",
  authCheck = null,
  isOnline = true,
  origin = "",
  nativePlatform = false,
} = {}) {
  const safeOrigin = String(origin || "").replace(/\?.*$/, "").slice(0, 120);
  const safeFeedback = String(feedback || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (m) => maskEmailForReceipt(m))
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .slice(0, 240);

  return JSON.stringify(
    {
      kind: "dengta_auth_diagnostic_receipt_v1",
      privacy: "Zero-Secret (无密码/无Token/邮箱已脱敏)",
      capturedAt: new Date().toISOString(),
      mode: String(mode || "login"),
      emailMasked: maskEmailForReceipt(email),
      deprecatedLegacyEmail: isDeprecatedLegacyEmail(email),
      errorCode: String(errorCode || "none"),
      feedback: safeFeedback || "none",
      connectivityCheck: authCheck
        ? { status: authCheck.status || "idle", message: String(authCheck.message || "").slice(0, 160) }
        : { status: "idle" },
      navigatorOnline: isOnline !== false,
      platform: nativePlatform ? "capacitor_native" : "web",
      origin: safeOrigin || "unknown",
    },
    null,
    2,
  );
}
