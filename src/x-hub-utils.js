// Clean-room helpers aligned with yxiy171866-boop/x-twikit-mcp (MIT, ec842b1):
// support full x.com / twitter.com tweet URLs in addition to numeric IDs, and
// format UTC ISO timestamps into Asia/Shanghai (UTC+8) for readable inspection.
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
