import { accountStorageKey } from "./account-storage.js";

export const SEARCH_HISTORY_BASE_KEY = "dengta.search-history.v1";
export const SEARCH_HISTORY_LIMIT = 8;
export const SEARCH_HISTORY_MAX_CHARS = 60;
export const SEARCH_HISTORY_AREAS = Object.freeze(["features", "settings", "music"]);
const SEARCH_HISTORY_TOTAL_BYTES = 4096;

function cleanTerm(value) {
  return Array.from(String(value || "").replace(/\s+/g, " ").trim())
    .slice(0, SEARCH_HISTORY_MAX_CHARS)
    .join("")
    .trim();
}

function isSensitiveTerm(value) {
  return (
    !value ||
    /^https?:\/\//i.test(value) ||
    /^www\./i.test(value) ||
    /^@/.test(value) ||
    /^\d{6,}$/.test(value) ||
    /\b(?:sk-|bearer\s|eyJ[a-zA-Z0-9_-]{10,})/i.test(value)
  );
}

function normalizeHistory(value) {
  const source = value && typeof value === "object" ? value : {};
  const history = { version: 1 };
  for (const area of SEARCH_HISTORY_AREAS) {
    const seen = new Set();
    const entries = [];
    for (const item of Array.isArray(source[area]) ? source[area] : []) {
      const term = cleanTerm(item);
      const key = term.normalize("NFKC").toLocaleLowerCase();
      if (isSensitiveTerm(term) || seen.has(key)) continue;
      seen.add(key);
      entries.push(term);
      if (entries.length >= SEARCH_HISTORY_LIMIT) break;
    }
    history[area] = entries;
  }
  return history;
}

export function searchHistoryStorageKey(accountScope = "") {
  return accountStorageKey(SEARCH_HISTORY_BASE_KEY, accountScope);
}

export function readSearchHistory(storage, accountScope = "") {
  try {
    const raw = storage?.getItem(searchHistoryStorageKey(accountScope));
    return raw ? normalizeHistory(JSON.parse(raw)) : normalizeHistory({});
  } catch {
    return normalizeHistory({});
  }
}

export function writeSearchHistory(storage, accountScope, history) {
  const normalized = normalizeHistory(history);
  let serialized = JSON.stringify(normalized);
  if (serialized.length > SEARCH_HISTORY_TOTAL_BYTES) {
    for (const area of SEARCH_HISTORY_AREAS) {
      while (normalized[area].length && serialized.length > SEARCH_HISTORY_TOTAL_BYTES) {
        normalized[area].pop();
        serialized = JSON.stringify(normalized);
      }
    }
  }
  try {
    storage?.setItem(searchHistoryStorageKey(accountScope), serialized);
  } catch {
    // Storage can be full/disabled; search still works without history.
  }
  return normalized;
}

export function rememberSearchTerm(storage, accountScope, area, value) {
  if (!SEARCH_HISTORY_AREAS.includes(area)) return readSearchHistory(storage, accountScope);
  const term = cleanTerm(value);
  if (isSensitiveTerm(term)) return readSearchHistory(storage, accountScope);
  const history = readSearchHistory(storage, accountScope);
  const key = term.normalize("NFKC").toLocaleLowerCase();
  history[area] = [
    term,
    ...history[area].filter((item) => item.normalize("NFKC").toLocaleLowerCase() !== key),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  return writeSearchHistory(storage, accountScope, history);
}

export function clearSearchHistory(storage, accountScope, area = "") {
  const history = readSearchHistory(storage, accountScope);
  if (area && SEARCH_HISTORY_AREAS.includes(area)) history[area] = [];
  else for (const item of SEARCH_HISTORY_AREAS) history[item] = [];
  return writeSearchHistory(storage, accountScope, history);
}

// Every typed character is matched as a substring; history itself is only
// written after the user pauses, so IME/pinyin fragments are never stored.
export function filterSearchHistory(entries, query) {
  const needle = cleanTerm(query).normalize("NFKC").toLocaleLowerCase();
  const list = Array.isArray(entries) ? entries : [];
  if (!needle) return [...list];
  return list.filter((item) =>
    cleanTerm(item).normalize("NFKC").toLocaleLowerCase().includes(needle)
  );
}
