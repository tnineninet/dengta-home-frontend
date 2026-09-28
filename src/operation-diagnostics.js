const rows = new Map();
const listeners = new Set();
let sequence = 0;
export const DIAGNOSTIC_OPERATIONS = [
  { prefix: "/api/v2/fun-labs/achievements", code: "DT-ACHIEVEMENTS", label: "成就", source: "App.jsx · refreshFunLabs / 成就操作" },
  { prefix: "/api/v2/fun-labs/onboarding", code: "DT-GUIDE", label: "入门纪念", source: "App.jsx · completeOnboarding" },
  { prefix: "/api/v2/sessions", code: "DT-SESSIONS", label: "聊天记录", source: "App.jsx · 会话加载" },
  { prefix: "/api/v2/settings", code: "DT-SETTINGS", label: "设置", source: "App.jsx · 设置读写" },
  { prefix: "/api/v2/moments", code: "DT-MOMENTS", label: "动态", source: "App.jsx · 动态操作" },
  { prefix: "/api/mcp", code: "DT-MCP", label: "外部连接", source: "McpDeviceCenter.jsx / ExternalMemoryConnections.jsx" },
  { prefix: "/api/v2/co-watch", code: "DT-WATCH", label: "一起看", source: "co-watch.js" },
  { prefix: "/api/external-memory", code: "DT-MCP", label: "外部记忆", source: "ExternalMemoryConnections.jsx" },
  { prefix: "/api/v2/music", code: "DT-MUSIC", label: "音乐", source: "music-listening.js" },
];
const FALLBACK = { code: "DT-API", label: "接口请求", source: "api.js · apiRequest" };
const EMPTY = Object.freeze([]);
export const diagnosticScopeKey = (account, companion) => account && companion ? JSON.stringify([account, companion]) : "";
export function recordOperationFailure(scope, endpoint, error, now = Date.now()) {
  if (!scope || error?.name === "AbortError") return null;
  const route = String(endpoint).split("?")[0];
  const operation = DIAGNOSTIC_OPERATIONS.find(item => route === item.prefix || route.startsWith(item.prefix + "/")) || FALLBACK;
  const status = Number(error?.status);
  const record = {
    id: ++sequence, code: operation.code, label: operation.label, source: operation.source, at: now,
    status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : null,
    kind: error?.code === "request_timeout" ? "等待超时" : status >= 400 ? "接口返回错误" : "网络或请求异常",
    logId: /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(error?.error_log_id || "") ? error.error_log_id : null,
  };
  rows.set(scope, Object.freeze([record, ...(rows.get(scope) || [])].slice(0, 50)));
  if (rows.size > 4) rows.delete(rows.keys().next().value);
  listeners.forEach(listener => listener());
  return record;
}
export function readOperationFailures(scope) { return rows.get(scope) || EMPTY; }
export function clearOperationFailures(scope) { rows.delete(scope); listeners.forEach(listener => listener()); }
export function subscribeOperationFailures(listener) { listeners.add(listener); return () => listeners.delete(listener); }
