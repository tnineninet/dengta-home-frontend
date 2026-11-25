import { recordOperationFailure } from "./operation-diagnostics.js";

const BREADCRUMB_LIMIT = 40;
const breadcrumbStore = new Map();
const breadcrumbListeners = new Set();
const EMPTY_BREADCRUMBS = Object.freeze([]);
const SECRET_SCRUB = /(?:bearer\s+[a-z0-9._-]{10,}|sk-[a-z0-9_-]{10,}|sb_secret_[a-z0-9_-]+|ghp_[a-z0-9_-]+|eyJ[a-zA-Z0-9_-]{10,})/gi;
const TRACE_ID_PATTERN = /^(?:dt-[a-z0-9]{4,16}-[a-f0-9]{6,16}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

let breadcrumbSeq = 0;
let installed = false;
let lastRuntimeKey = "";
let lastRuntimeAt = 0;

function randomHex(length = 8) {
  try {
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(Math.ceil(length / 2));
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
    }
  } catch {
    // Fallback to Math.random below.
  }
  return Math.random().toString(16).slice(2, 2 + length).padEnd(length, "0");
}

export function createTraceId() {
  return `dt-${Date.now().toString(36)}-${randomHex(8)}`;
}

export function sanitizeTraceId(value) {
  const raw = String(value || "").trim();
  return TRACE_ID_PATTERN.test(raw) ? raw : "";
}

export function sanitizeDiagnosticRoute(endpoint) {
  const path = String(endpoint || "").split("?")[0].split("#")[0];
  return path
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment) || /^\d{3,}$/.test(segment)) return ":id";
      return segment.slice(0, 48);
    })
    .join("/")
    .slice(0, 160) || "/";
}

function scrubText(value, maxLen = 120) {
  return String(value || "")
    .replace(SECRET_SCRUB, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function extractSafeClientLocation(rawFilename = "", line = 0, col = 0) {
  const file = String(rawFilename || "").split("?")[0].split("#")[0];
  const segment = file.match(/(?:assets\/|src\/)[\w.-]+\.(?:js|jsx|mjs|ts|tsx)/i)?.[0]
    || file.split("/").filter(Boolean).pop()
    || "";
  const safeFile = /^[A-Za-z0-9_./-]{1,80}$/.test(segment) ? segment : "";
  if (!safeFile) return "";
  const row = Number.isInteger(Number(line)) && Number(line) > 0 ? Number(line) : 0;
  const column = Number.isInteger(Number(col)) && Number(col) > 0 ? Number(col) : 0;
  return row ? `${safeFile}:${row}${column ? `:${column}` : ""}` : safeFile;
}

export function recordBreadcrumb(scope, entry = {}, now = Date.now()) {
  const key = scope || "global";
  const record = Object.freeze({
    id: ++breadcrumbSeq,
    at: now,
    kind: ["nav", "action", "api", "runtime", "takeout", "knowledge", "medication"].includes(entry.kind)
      ? entry.kind
      : "action",
    target: scrubText(entry.target || "", 96),
    detail: scrubText(entry.detail || "", 120),
    status: Number.isInteger(Number(entry.status)) ? Number(entry.status) : null,
    durationMs: Number.isFinite(Number(entry.durationMs)) && Number(entry.durationMs) >= 0
      ? Math.round(Number(entry.durationMs))
      : null,
    traceId: sanitizeTraceId(entry.traceId),
    ok: entry.ok !== false,
  });
  const next = Object.freeze([record, ...(breadcrumbStore.get(key) || [])].slice(0, BREADCRUMB_LIMIT));
  breadcrumbStore.set(key, next);
  if (breadcrumbStore.size > 6) {
    breadcrumbStore.delete(breadcrumbStore.keys().next().value);
  }
  breadcrumbListeners.forEach((listener) => listener());
  return record;
}

export function readBreadcrumbs(scope) {
  if (!scope) return breadcrumbStore.get("global") || EMPTY_BREADCRUMBS;
  const scoped = breadcrumbStore.get(scope);
  if (scoped?.length) return scoped;
  return breadcrumbStore.get("global") || EMPTY_BREADCRUMBS;
}

export function clearBreadcrumbs(scope) {
  if (scope) breadcrumbStore.delete(scope);
  breadcrumbStore.delete("global");
  breadcrumbListeners.forEach((listener) => listener());
}

export function subscribeBreadcrumbs(listener) {
  breadcrumbListeners.add(listener);
  return () => breadcrumbListeners.delete(listener);
}

export function installClientDiagnostics({ getScope = () => "global" } = {}) {
  if (installed || typeof window === "undefined") return () => {};
  installed = true;

  const captureRuntime = (code, location, name) => {
    const now = Date.now();
    const dedupeKey = `${code}|${location}|${name}`;
    if (dedupeKey === lastRuntimeKey && now - lastRuntimeAt < 2000) return;
    lastRuntimeKey = dedupeKey;
    lastRuntimeAt = now;
    const scope = String(getScope?.() || "global") || "global";
    const traceId = createTraceId();
    recordBreadcrumb(scope, {
      kind: "runtime",
      target: location || "client-runtime",
      detail: `${code} (${name || "Error"})`,
      traceId,
      ok: false,
    }, now);
    recordOperationFailure(scope, "/runtime/client", {
      code,
      trace_id: traceId,
      error_location: location,
      subsystem: "runtime",
    }, now);
  };

  const onError = (event) => {
    const location = extractSafeClientLocation(event?.filename, event?.lineno, event?.colno);
    const errorName = scrubText(event?.error?.name || "RuntimeError", 48);
    captureRuntime("client_uncaught_error", location, errorName);
  };

  const onRejection = (event) => {
    const reason = event?.reason;
    if (reason?.name === "AbortError") return;
    const stackLine = String(reason?.stack || "").split(/\r?\n/).find((line) => /\.(?:js|jsx|mjs):\d+:\d+/.test(line)) || "";
    const match = stackLine.match(/([^\s()]+\.(?:js|jsx|mjs)):(\d+):(\d+)/);
    const location = match ? extractSafeClientLocation(match[1], Number(match[2]), Number(match[3])) : "";
    const errorName = scrubText(reason?.code || reason?.name || "UnhandledRejection", 48);
    captureRuntime("client_unhandled_rejection", location, errorName);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    installed = false;
  };
}

export function buildAiFixDiagnosticBundle({
  log = null,
  localEntry = null,
  breadcrumbs = [],
  summary = null,
} = {}) {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const win = typeof window !== "undefined" ? window : null;
  const env = {
    platform: win?.Capacitor?.isNativePlatform?.() ? "android-capacitor" : "web",
    viewport: win ? `${win.innerWidth || 0}x${win.innerHeight || 0}` : "unknown",
    online: nav ? nav.onLine !== false : true,
    language: nav?.language || "zh-CN",
    captured_at: new Date().toISOString(),
  };

  const primary = {
    log_id: log?.id || localEntry?.logId || null,
    error_code: log?.error_code || localEntry?.reasonCode || localEntry?.code || "unknown",
    fingerprint: log?.fingerprint || log?.request_summary?.fingerprint || localEntry?.fingerprint || null,
    trace_id: log?.request_id || log?.request_summary?.request_id || localEntry?.traceId || null,
    subsystem: log?.subsystem || log?.request_summary?.subsystem || localEntry?.subsystem || localEntry?.label || "unknown",
    severity: log?.severity || log?.request_summary?.severity || null,
    method: log?.method || null,
    path: log?.path || localEntry?.route || null,
    status: log?.request_summary?.status || localEntry?.status || null,
    upstream_status: log?.upstream_status ?? null,
    provider_code: log?.provider_code || null,
    provider_phase: log?.provider_phase || null,
    error_source: log?.error_source || localEntry?.source || null,
    error_location: log?.error_location || localEntry?.location || null,
    duration_ms: log?.duration_ms ?? log?.request_summary?.duration_ms ?? localEntry?.durationMs ?? null,
    backend_version: log?.request_summary?.version || null,
    backend_revision: log?.request_summary?.revision || null,
    context_budget: log?.request_summary?.context_budget || null,
    fix_hint: log?.fix_hint || null,
    stack_trace: log?.stack_trace || null,
  };

  const recentCrumbs = (Array.isArray(breadcrumbs) ? breadcrumbs : [])
    .slice(0, 12)
    .map((item) => ({
      t: new Date(item.at).toISOString(),
      kind: item.kind,
      target: item.target,
      detail: item.detail,
      status: item.status,
      ms: item.durationMs,
      trace: item.traceId || undefined,
      ok: item.ok,
    }));

  const lines = [
    "# DengTa 精准故障定位诊断包（已脱敏，不含聊天内容与密钥）",
    `- **错误码 / Code**: \`${primary.error_code}\``,
    primary.fingerprint ? `- **故障指纹 / Fingerprint**: \`${primary.fingerprint}\`` : "",
    primary.trace_id ? `- **链路追踪 / Trace ID**: \`${primary.trace_id}\`` : "",
    primary.log_id ? `- **服务端日志编号 / Log ID**: \`${primary.log_id}\`` : "",
    `- **子系统 / Subsystem**: \`${primary.subsystem}\`${primary.severity ? ` (${primary.severity})` : ""}`,
    primary.path ? `- **接口路径 / Route**: \`${primary.method ? `${primary.method} ` : ""}${primary.path}\`` : "",
    primary.error_location ? `- **精准代码位置 / Location**: \`${primary.error_location}\`` : "",
    primary.status || primary.upstream_status
      ? `- **HTTP 状态**: client=${primary.status ?? "-"} / upstream=${primary.upstream_status ?? "-"}${primary.provider_code ? ` / provider=${primary.provider_code}` : ""}`
      : "",
    primary.duration_ms !== null ? `- **请求耗时**: ${primary.duration_ms} ms` : "",
    primary.backend_version ? `- **后端版本**: ${primary.backend_version} (${primary.backend_revision || "local"})` : "",
    primary.fix_hint ? `- **定位建议**: ${primary.fix_hint}` : "",
    primary.stack_trace ? `\n## 业务调用栈\n\`\`\`\n${primary.stack_trace}\n\`\`\`` : "",
    recentCrumbs.length ? `\n## 最近操作与接口面包屑 (${recentCrumbs.length} 条)\n\`\`\`json\n${JSON.stringify(recentCrumbs, null, 2)}\n\`\`\`` : "",
    summary ? `\n## 本机错误聚类摘要\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`` : "",
    `\n## 运行环境\n\`\`\`json\n${JSON.stringify(env, null, 2)}\n\`\`\``,
  ].filter(Boolean);

  return {
    markdown: lines.join("\n"),
    payload: { primary, breadcrumbs: recentCrumbs, summary, environment: env },
  };
}

export async function copyDiagnosticText(text) {
  if (!text) return false;
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
    if (typeof document !== "undefined") {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return Boolean(copied);
    }
  } catch {
    return false;
  }
  return false;
}
