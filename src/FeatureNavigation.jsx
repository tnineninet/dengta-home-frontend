import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import "./feature-navigation.css";
import SearchHistoryChips from "./SearchHistoryChips.jsx";
import { filterSearchHistory } from "./search-history.js";
import { useSearchHistory } from "./useSearchHistory.js";
import SlidingIndicator from "./SlidingIndicator.jsx";
import { FEATURE_GROUPS, FEATURE_LABELS, FEATURE_DETAILS, filterFeatures } from "./feature-navigation.js";

const groupedFeatureIds = new Set(FEATURE_GROUPS.flatMap(group => group.ids));
const COLLAPSED_KEY = "dengta_feature_groups_collapsed";

function readCollapsedGroups(scope) {
  try {
    const value = JSON.parse(window.localStorage.getItem(`${COLLAPSED_KEY}:${scope || "guest"}`) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeCollapsedGroups(scope, value) {
  try {
    window.localStorage.setItem(`${COLLAPSED_KEY}:${scope || "guest"}`, JSON.stringify(value));
  } catch {
    // Private storage can be unavailable; the in-memory state still works.
  }
}

function badgeText(badge) {
  const count = Number(badge?.count) || 0;
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

export default function FeatureNavigation({ items = [], activeView, onNavigate, historyScope = "", badges = {} }) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(() => readCollapsedGroups(historyScope));
  const searchRef = useRef(null);
  const groupsRef = useRef(null);
  const activeItemRef = useRef(null);
  const searchId = useId();
  const searchHistory = useSearchHistory({ accountScope: historyScope, area: "features" });
  const visible = filterFeatures(items, search);
  const isSearching = search.trim().length > 0;
  const matchingHistory = filterSearchHistory(searchHistory.history, search);
  const otherEntries = visible.filter(item => !groupedFeatureIds.has(item.id));
  const groups = FEATURE_GROUPS.map(group => ({ ...group, entries: visible.filter(item => group.ids.includes(item.id)) }));
  if (otherEntries.length) groups.push({ label: "更多功能", entries: otherEntries });

  const activeGroup = groups.find(group => group.entries.some(item => item.id === activeView));
  const lastActiveViewRef = useRef(activeView);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate UI-only collapse state from storage
    setCollapsed(readCollapsedGroups(historyScope));
  }, [historyScope]);

  useEffect(() => {
    if (lastActiveViewRef.current === activeView) return;
    lastActiveViewRef.current = activeView;
    if (!activeGroup || isSearching) return;
    if (collapsed[activeGroup.label]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- expand the destination group on a real view change
      setCollapsed(previous => {
        if (!previous[activeGroup.label]) return previous;
        const next = { ...previous, [activeGroup.label]: false };
        writeCollapsedGroups(historyScope, next);
        return next;
      });
    }
    // Only a real view change expands the destination group; manually
    // collapsing the current group must remain possible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  function clearSearch() {
    setSearch("");
    searchRef.current?.focus();
  }

  function pickSearch(term) {
    setSearch(term);
    searchHistory.flush(term);
    searchRef.current?.focus();
  }

  function handleSearchChange(event) {
    const value = event.target.value;
    setSearch(value);
    if (!event.nativeEvent?.isComposing) searchHistory.rememberSoon(value);
  }

  function handleSearchKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape" && search) {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
    } else if (event.key === "Enter" && isSearching && visible.length === 1) {
      event.preventDefault();
      searchHistory.flush(search);
      onNavigate?.(visible[0].id);
    }
  }

  function toggleGroup(label) {
    setCollapsed(previous => {
      const next = { ...previous, [label]: !previous[label] };
      writeCollapsedGroups(historyScope, next);
      return next;
    });
  }

  return <div className="feature-navigation">
    <div className="feature-navigation-search">
      <label htmlFor={searchId}>找个玩法</label>
      <div className="feature-navigation-search-field">
        <Search aria-hidden="true" />
        <input id={searchId} ref={searchRef} type="search" value={search} onChange={handleSearchChange} onCompositionEnd={event => searchHistory.rememberSoon(event.currentTarget.value)} onKeyDown={handleSearchKeyDown} placeholder="聊天、听歌、小棉花…" maxLength={60} autoComplete="off" aria-describedby={isSearching ? `${searchId}-results` : undefined} />
        {search ? <button type="button" aria-label="清空玩法搜索" onClick={clearSearch}><X aria-hidden="true" /></button> : null}
      </div>
      <SearchHistoryChips
        history={isSearching ? matchingHistory : searchHistory.history}
        label={isSearching ? "搜索历史匹配" : "最近搜索"}
        onPick={pickSearch}
        onClear={searchHistory.clear}
      />
    </div>
    {isSearching ? <p id={`${searchId}-results`} className="feature-navigation-results" role="status">{visible.length ? `找到 ${visible.length} 个玩法` : "没有找到匹配的玩法"}</p> : null}
    <nav className="primary-nav" aria-label="主要功能">
      <div className="feature-navigation-groups" ref={groupsRef}>
        <SlidingIndicator containerRef={groupsRef} activeRef={activeItemRef} activeKey={activeView} revision={`${search}|${JSON.stringify(collapsed)}`} className="feature-navigation-indicator" />
        {groups.map((group, index) => {
          if (!group.entries.length) return null;
          const isCollapsed = !isSearching && Boolean(collapsed[group.label]);
          const toggleId = `${searchId}-group-toggle-${index}`;
          const itemsId = `${searchId}-group-items-${index}`;
          return <section className={`feature-navigation-group${isCollapsed ? " is-collapsed" : ""}${activeGroup?.label === group.label ? " is-current-group" : ""}`} key={group.label} role="group" aria-labelledby={toggleId}>
            <button type="button" id={toggleId} className="feature-navigation-group-toggle" aria-expanded={!isCollapsed} aria-controls={itemsId} onClick={() => toggleGroup(group.label)}>
              <span>{group.label}</span>
              <ChevronDown aria-hidden="true" className={isCollapsed ? "is-collapsed" : ""} />
            </button>
            <div id={itemsId} className="feature-navigation-group-items" inert={isCollapsed ? true : undefined}>
              {group.entries.map(item => {
                const isActive = activeView === item.id;
                const badge = badges[item.id];
                const countText = badgeText(badge);
                return <button type="button" data-feature-item={item.id} data-dt-tip={`${FEATURE_LABELS[item.id] || item.label}${FEATURE_DETAILS[item.id]?.hint ? ` · ${FEATURE_DETAILS[item.id].hint}` : ""}`} ref={isActive ? activeItemRef : undefined} className={`${isActive ? "active" : ""}${badge?.action ? " is-action" : ""}`} aria-current={isActive ? "page" : undefined} aria-haspopup={badge?.action ? "dialog" : undefined} key={item.id} onClick={() => onNavigate?.(item.id)}>
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{FEATURE_LABELS[item.id] || item.label}{FEATURE_DETAILS[item.id]?.hint ? <small>{FEATURE_DETAILS[item.id].hint}</small> : null}</span>
                  {countText ? <span key={countText} className="feature-navigation-badge" aria-label={badge?.label || `未读 ${countText} 条`}>{countText}</span> : badge?.dot ? <span className="feature-navigation-badge is-dot" aria-label={badge?.label || "有新内容"}>•</span> : null}
                </button>;
              })}
            </div>
          </section>;
        })}
        {!visible.length && <p className="feature-navigation-empty">{isSearching ? "换个词试试，或清空搜索查看全部玩法。" : "暂时没有可用玩法。"}</p>}
      </div>
    </nav>
  </div>;
}
