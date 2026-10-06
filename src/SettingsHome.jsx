import { useId, useState } from "react";
import { ArrowRight, ChevronDown, Search, X } from "lucide-react";
import {
  buildSettingsGroups,
  SETTINGS_QUICK_LINKS,
  SETTINGS_STARTER_STEPS,
} from "./settings-navigation.js";
import "./settings-home.css";

export default function SettingsHome({ categories = [], onSelectCategory }) {
  const [query, setQuery] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const searchId = useId();
  const guideId = useId();
  const groups = buildSettingsGroups(categories, query);
  const isSearching = query.trim().length > 0;
  const resultCount = groups.reduce((total, group) => total + group.categories.length, 0);
  const availableIds = new Set(categories.map((category) => category.id));
  const quickLinks = SETTINGS_QUICK_LINKS.filter((link) => availableIds.has(link.categoryId));
  const guideSteps = SETTINGS_STARTER_STEPS.filter((step) => availableIds.has(step.categoryId));

  return (
    <div className="settings-home">
      <div className="settings-home-search">
        <label htmlFor={searchId}>查找设置</label>
        <div className="settings-home-search-field">
          <Search aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="试试“记忆”“语音”或“备份”"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" aria-label="清空设置搜索" onClick={() => setQuery("")}>
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {!isSearching && quickLinks.length > 0 ? (
        <nav className="settings-home-quick-links" aria-label="常用设置入口">
          {quickLinks.map((link) => (
            <button key={link.categoryId} type="button" onClick={() => onSelectCategory?.(link.categoryId)}>
              {link.label}<ArrowRight aria-hidden="true" />
            </button>
          ))}
        </nav>
      ) : null}

      {isSearching ? (
        <p className="settings-home-results" role="status" aria-live="polite">
          {resultCount > 0 ? `找到 ${resultCount} 个入口` : "没有找到匹配的设置，换个关键词试试。"}
        </p>
      ) : null}

      <div className="settings-home-groups" aria-label="设置分类">
        {groups.map((group) => (
          <section className="settings-home-group" key={group.id} aria-labelledby={`${searchId}-${group.id}`}>
            <div className="settings-home-group-heading">
              <h3 id={`${searchId}-${group.id}`}>{group.label}</h3>
              <p>{group.description}</p>
            </div>
            <div className="settings-home-entries">
              {group.categories.map(({ id, label, description, Icon }) => (
                <button
                  className="settings-home-entry"
                  key={id}
                  type="button"
                  data-settings-category={id}
                  onClick={() => onSelectCategory?.(id)}
                >
                  {Icon ? <span className="settings-home-entry-icon" aria-hidden="true"><Icon /></span> : null}
                  <span className="settings-home-entry-text"><strong>{label}</strong><small>{description}</small></span>
                  <ArrowRight className="settings-home-entry-arrow" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {isSearching && resultCount === 0 ? (
        <button type="button" className="settings-home-reset" onClick={() => setQuery("")}>查看全部设置</button>
      ) : null}

      {!isSearching && guideSteps.length > 0 ? (
        <aside className="settings-home-guide">
          <button
            className="settings-home-guide-toggle"
            type="button"
            aria-expanded={showGuide}
            aria-controls={guideId}
            onClick={() => setShowGuide((current) => !current)}
          >
            <span><strong>从哪里开始？</strong><small>按需查看的上手建议</small></span>
            <ChevronDown aria-hidden="true" />
          </button>
          {showGuide ? (
            <div id={guideId} className="settings-home-guide-content">
              <p>挑一项你现在需要的设置，其他功能可以随时回来看看。</p>
              <ol>
                {guideSteps.map((step) => (
                  <li key={step.categoryId}>
                    <button type="button" onClick={() => onSelectCategory?.(step.categoryId)}>{step.label}<ArrowRight aria-hidden="true" /></button>
                    <p>{step.description}</p>
                  </li>
                ))}
              </ol>
              <button type="button" className="settings-home-guide-close" onClick={() => setShowGuide(false)}>收起建议</button>
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
