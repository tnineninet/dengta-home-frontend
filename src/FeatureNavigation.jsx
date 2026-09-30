import { useState } from "react";
import "./feature-navigation.css";

import { FEATURE_GROUPS, FEATURE_LABELS, FEATURE_DETAILS, filterFeatures } from "./feature-navigation.js";

export default function FeatureNavigation({ items, activeView, onNavigate }) {
  const [search, setSearch] = useState("");
  const visible = filterFeatures(items, search);
  return <div className="feature-navigation">
    <label className="feature-navigation-search"><span>找个玩法</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="聊天、听歌、小棉花…" maxLength={60} /></label>
    <nav className="primary-nav" aria-label="主要功能">
      {FEATURE_GROUPS.map(group => {
        const entries = visible.filter(item => group.ids.includes(item.id));
        return entries.length ? <div className="feature-navigation-group" key={group.label}>
          <p>{group.label}</p>
          {entries.map(item => <button type="button" className={activeView === item.id ? "active" : ""} aria-current={activeView === item.id ? "page" : undefined} key={item.id} onClick={() => onNavigate(item.id)}><span aria-hidden="true">{item.icon}</span><span>{FEATURE_LABELS[item.id] || item.label}<small>{FEATURE_DETAILS[item.id]?.hint}</small></span></button>)}
        </div> : null;
      })}
      {!visible.length && <p className="feature-navigation-empty">没有找到这个玩法，换个词试试。</p>}
    </nav>
  </div>;
}
