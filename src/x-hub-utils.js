// Clean-room helpers aligned with yxiy171866-boop/x-twikit-mcp (MIT, ec842b1):
// support full x.com / twitter.com tweet URLs in addition to numeric IDs, and
// format UTC ISO timestamps into Asia/Shanghai (UTC+8) for readable inspection.
export const X_MCP_TOOL_NAMES = Object.freeze([
  "post_tweet",
  "reply_tweet",
  "get_tweet_replies",
  "search_tweets",
  "get_tweet_by_id",
  "get_user_info",
  "get_user_tweets",
  "read_direct_messages",
  "send_direct_message",
  "favorite_tweet",
  "retweet",
  "delete_tweet",
]);

const X_TOOL_SET = new Set(X_MCP_TOOL_NAMES);

export function normalizeXConnection(connection) {
  const tools = Array.isArray(connection?.tools)
    ? connection.tools
    : Array.isArray(connection?.discovered_tools)
      ? connection.discovered_tools
      : [];
  const names = tools.map((tool) => tool?.name).filter(Boolean);
  const xTools = names.filter((name) => X_TOOL_SET.has(name));
  return {
    ...connection,
    tools,
    names,
    xTools,
  };
}

/**
 * Strictly resolve X / Twitter MCP connection state so XHub NEVER falsely
 * claims "已连接" when no real X MCP is connected, enabled, and healthy.
 *
 * Returns:
 *  - { state: "none", connection: null, reason: string }
 *  - { state: "disabled", connection, reason: string }
 *  - { state: "disconnected", connection, reason: string }
 *  - { state: "connected", connection, reason: string }
 */
export function resolveXConnectionState(rawConnections = []) {
  const normalized = (Array.isArray(rawConnections) ? rawConnections : []).map(normalizeXConnection);

  // Priority 1: Connections that genuinely expose at least one X / Twitter MCP tool
  const withXTools = normalized.filter((item) => item.xTools.length > 0);
  if (withXTools.length > 0) {
    const ready = withXTools.find((item) => item.enabled === true && item.last_status === "connected");
    if (ready) {
      return {
        state: "connected",
        connection: ready,
        reason: `已启用且最近连通检测通过，已发现 ${ready.xTools.length} 个 X 工具。`,
      };
    }
    const enabledButNotConnected = withXTools.find((item) => item.enabled === true);
    if (enabledButNotConnected) {
      return {
        state: "disconnected",
        connection: enabledButNotConnected,
        reason:
          enabledButNotConnected.last_error ||
          "该 X MCP 网关尚未通过连通测试或当前离线，请点击「实测连通性」或在电脑检查网关服务。",
      };
    }
    const disabled = withXTools[0];
    return {
      state: "disabled",
      connection: disabled,
      reason: "已保存 X MCP 连接，但目前处于关闭状态（默认禁用）；请先开启并测试连通性。",
    };
  }

  // Priority 2: Explicit X/Twitter named connection (never match bare letter "x" like "A x B"!)
  // Even if matched by name, it has 0 X tools so it can NEVER report "connected".
  const namedCandidate = normalized.find((item) => {
    const hay = `${item.name || ""} ${item.endpoint || ""}`;
    return /twitter|twikit|x\s*\/\s*twitter|x-mcp|\/x-mcp\b/i.test(hay);
  });
  if (namedCandidate) {
    if (namedCandidate.enabled !== true) {
      return {
        state: "disabled",
        connection: namedCandidate,
        reason: "找到名为 X/Twitter 的连接，但未启用且尚未读取到任何 X 工具，请启用并重测。",
      };
    }
    return {
      state: "disconnected",
      connection: namedCandidate,
      reason:
        namedCandidate.last_error ||
        "该连接没有发现任何 X/Twitter 工具（post_tweet / search_tweets），可能地址填错或网关未就绪。",
    };
  }

  return {
    state: "none",
    connection: null,
    reason: "尚未添加 X / Twitter MCP 连接。",
  };
}

export function extractTweetId(rawInput) {
  const text = String(rawInput || "").trim();
  if (!text) return "";
  if (/^\d{5,25}$/.test(text)) return text;
  const match = text.match(/(?:x\.com|twitter\.com)\/(?:[^/\s]+\/status|i\/web\/status)\/(\d{5,25})/i);
  return match ? match[1] : "";
}

export function formatXResultTimestamps(rawText) {
  const text = String(rawText || "");
  if (!text) return "";
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return text.replace(
    /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\b/g,
    (match) => {
      const date = new Date(match);
      if (Number.isNaN(date.getTime())) return match;
      return `${formatter.format(date)} (UTC+8)`;
    },
  );
}
