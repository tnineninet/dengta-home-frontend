const KEY_PREFIX = "dengta_moments_cache_v2:";
const MAX_ENTRIES = 20;

function cacheKey(scope) {
  return KEY_PREFIX + String(scope || "");
}

export function readMomentsCache(scope) {
  try {
    const raw = globalThis.localStorage?.getItem(cacheKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.available !== "boolean" || !Array.isArray(parsed.entries)) return null;
    return {
      available: parsed.available,
      entries: parsed.entries.filter((entry) => entry?.id && Array.isArray(entry.images) && Array.isArray(entry.comments)).slice(0, MAX_ENTRIES),
    };
  } catch {
    return null;
  }
}

export function writeMomentsCache(scope, { available, entries }) {
  try {
    if (typeof available !== "boolean" || !Array.isArray(entries)) return;
    const validEntries = entries
      .filter((entry) => entry?.id && Array.isArray(entry.images) && Array.isArray(entry.comments))
      .slice(0, MAX_ENTRIES);
    globalThis.localStorage?.setItem(cacheKey(scope), JSON.stringify({
      available,
      entries: validEntries,
      saved_at: new Date().toISOString(),
    }));
  } catch {
    // 本地缓存失败不影响动态刷新。
  }
}
