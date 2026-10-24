import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSearchHistory,
  readSearchHistory,
  rememberSearchTerm,
} from "./search-history.js";

function storageOrNull() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function useSearchHistory({ accountScope = "", area, enabled = true } = {}) {
  const [history, setHistory] = useState([]);
  const scopeRef = useRef(accountScope);
  const areaRef = useRef(area);
  const timerRef = useRef(0);

  const refresh = useCallback(() => {
    const storage = storageOrNull();
    const all = readSearchHistory(storage, scopeRef.current);
    setHistory(area ? all[area] || [] : []);
  }, [area]);

  useEffect(() => {
    scopeRef.current = accountScope;
    areaRef.current = area;
    refresh();
    return () => {
      if (timerRef.current) globalThis.clearTimeout(timerRef.current);
      timerRef.current = 0;
    };
  }, [accountScope, area, refresh]);

  const flush = useCallback((value) => {
    if (!enabled || !areaRef.current) return;
    const term = String(value || "").trim();
    if (!term) return;
    const next = rememberSearchTerm(storageOrNull(), scopeRef.current, areaRef.current, term);
    setHistory(next[areaRef.current] || []);
  }, [enabled]);

  const rememberSoon = useCallback((value) => {
    if (!enabled) return;
    const term = String(value || "").trim();
    if (timerRef.current) globalThis.clearTimeout(timerRef.current);
    timerRef.current = 0;
    if (!term) return;
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = 0;
      flush(term);
    }, 900);
  }, [enabled, flush]);

  const clear = useCallback(() => {
    if (timerRef.current) globalThis.clearTimeout(timerRef.current);
    timerRef.current = 0;
    const next = clearSearchHistory(storageOrNull(), scopeRef.current, areaRef.current);
    setHistory(areaRef.current ? next[areaRef.current] || [] : []);
  }, []);

  return { history, rememberSoon, flush, clear, refresh };
}
