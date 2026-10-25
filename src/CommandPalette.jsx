import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CornerDownLeft, Search, X } from "lucide-react";
import "./command-palette.css";
import { FEATURE_DETAILS, FEATURE_LABELS } from "./feature-navigation.js";

function normalize(value) {
  return String(value || "").normalize("NFKC").toLowerCase().trim();
}

function matches(entry, terms) {
  return terms.every(term => entry.searchText.includes(term));
}

function focusTarget(selector) {
  const node = globalThis.document?.querySelector?.(selector);
  if (node && typeof node.focus === "function") node.focus({ preventScroll: true });
}

export default function CommandPalette({
  open,
  onClose,
  onNavigate,
  onCreateSession,
  onOpenSettings,
  onReturnActivity,
  features = [],
  settingsCategories = [],
  sessions = [],
  returnFocusRef = null,
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const previouslyFocused = useRef(null);
  const shouldRestoreRef = useRef(true);
  const titleId = useId();
  const listId = useId();

  const actions = useMemo(() => {
    const result = [{ id: "new-chat", label: "新建对话", hint: "打开一个新的聊天", kind: "action", run: onCreateSession, icon: "＋" }];
    result.push({ id: "open-settings", label: "打开设置", hint: "模型、外观、语音与数据", kind: "action", run: onOpenSettings, icon: "⚙" });
    if (onReturnActivity) result.push({ id: "return-activity", label: "回到本次活动", hint: "返回一起看或一起听", kind: "action", run: onReturnActivity, icon: "↩" });
    return result;
  }, [onCreateSession, onOpenSettings, onReturnActivity]);

  const entries = useMemo(() => {
    const rows = features.map(item => ({
      id: `view:${item.id}`,
      label: FEATURE_LABELS[item.id] || item.label || item.id,
      hint: FEATURE_DETAILS[item.id]?.hint || "打开页面",
      kind: "view",
      view: item.id,
      icon: item.icon || "•",
      searchText: normalize([FEATURE_LABELS[item.id], item.label, FEATURE_DETAILS[item.id]?.hint, FEATURE_DETAILS[item.id]?.keywords].filter(Boolean).join(" ")),
    }));
    for (const category of settingsCategories) {
      rows.push({
        id: `settings:${category.id}`,
        label: `设置 · ${category.label}`,
        hint: category.description || "打开设置分类",
        kind: "settings",
        category: category.id,
        icon: "⚙",
        searchText: normalize([category.label, category.description, category.keywords].filter(Boolean).join(" ")),
      });
    }
    for (const session of sessions) {
      rows.push({
        id: `session:${session.id}`,
        label: session.title || "未命名对话",
        hint: "打开最近对话",
        kind: "session",
        sessionId: session.id,
        icon: "◌",
        searchText: normalize(session.title || ""),
      });
    }
    for (const action of actions) {
      rows.push({ ...action, searchText: normalize([action.label, action.hint].join(" ")) });
    }
    return rows;
  }, [actions, features, sessions, settingsCategories]);

  const filtered = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return entries;
    return entries.filter(entry => matches(entry, terms));
  }, [entries, query]);

  useEffect(() => {
    if (!open) {
      const target = previouslyFocused.current;
      previouslyFocused.current = null;
      if (shouldRestoreRef.current && target && typeof target.focus === "function") target.focus({ preventScroll: true });
      shouldRestoreRef.current = true;
      return;
    }
    shouldRestoreRef.current = true;
    previouslyFocused.current = globalThis.document?.activeElement || returnFocusRef?.current || null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient search state when the dialog opens
    setQuery("");
    setHighlighted(0);
    const timer = globalThis.setTimeout(() => inputRef.current?.focus(), 0);
    return () => globalThis.clearTimeout(timer);
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };
    globalThis.document?.addEventListener?.("keydown", onKeyDown);
    return () => globalThis.document?.removeEventListener?.("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the highlighted row inside the filtered list
    setHighlighted(index => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  function closeAndRestore() {
    onClose?.();
  }

  function execute(entry) {
    if (!entry) return;
    if (entry.kind === "view") {
      shouldRestoreRef.current = false;
      onNavigate?.(entry.view);
      onClose?.({ navigate: true });
      globalThis.setTimeout(() => focusTarget("#main-content, .view-content"), 0);
    } else if (entry.kind === "settings") {
      shouldRestoreRef.current = false;
      onOpenSettings?.(entry.category);
      onClose?.({ navigate: true });
    } else if (entry.kind === "session") {
      shouldRestoreRef.current = false;
      onNavigate?.("chat", entry.sessionId);
      onClose?.({ navigate: true });
      globalThis.setTimeout(() => focusTarget("#main-content, .view-content"), 0);
    } else {
      entry.run?.();
      onClose?.({ navigate: entry.id !== "open-settings" });
    }
  }

  function onInputKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted(index => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted(index => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(filtered[highlighted]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestore();
    }
  }

  if (!open) return null;
  return (
    <div className="command-palette-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) closeAndRestore(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby={titleId} onPointerDown={event => event.stopPropagation()}>
        <header className="command-palette-header">
          <h2 id={titleId}>命令面板</h2>
          <button type="button" className="command-palette-close" aria-label="关闭命令面板" onClick={closeAndRestore}><X aria-hidden="true" /></button>
        </header>
        <div className="command-palette-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={event => { setQuery(event.target.value); setHighlighted(0); }}
            onKeyDown={onInputKeyDown}
            placeholder="搜索玩法、设置、最近对话…"
            aria-label="搜索命令"
            aria-controls={listId}
            aria-activedescendant={filtered[highlighted] ? `${listId}-${filtered[highlighted].id}` : undefined}
            autoComplete="off"
          />
        </div>
        <ul id={listId} className="command-palette-results" role="listbox" aria-label="命令结果">
          {filtered.length ? filtered.map((entry, index) => (
            <li key={entry.id}>
              <button
                type="button"
                id={`${listId}-${entry.id}`}
                className={`command-palette-row${index === highlighted ? " is-highlighted" : ""}`}
                aria-selected={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => execute(entry)}
              >
                <span className="command-palette-row-icon" aria-hidden="true">{entry.icon}</span>
                <span className="command-palette-row-copy"><strong>{entry.label}</strong><small>{entry.hint}</small></span>
                {index === highlighted ? <CornerDownLeft aria-hidden="true" /> : null}
              </button>
            </li>
          )) : <li className="command-palette-empty" role="status">没有找到匹配的入口，换个词试试</li>}
        </ul>
        <footer className="command-palette-footer"><span><ArrowUp aria-hidden="true" /><ArrowDown aria-hidden="true" />选择</span><span><CornerDownLeft aria-hidden="true" />确认</span><span>Esc 关闭</span></footer>
      </section>
    </div>
  );
}
