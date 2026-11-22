import { History, Trash2 } from "lucide-react";
import "./search-history.css";

export default function SearchHistoryChips({ history = [], onPick, onClear, label = "最近搜索", emptyLabel = "" }) {
  if (!Array.isArray(history) || history.length === 0) return emptyLabel ? <p className="search-history-empty">{emptyLabel}</p> : null;
  return (
    <div className="search-history" role="group" aria-label={label}>
      <div className="search-history-heading">
        <span><History aria-hidden="true" /> {label}</span>
        {onClear ? (
          <button type="button" className="search-history-clear" onClick={onClear} aria-label="清空搜索历史">
            <Trash2 aria-hidden="true" /> 清空
          </button>
        ) : null}
      </div>
      <div className="search-history-chips">
        {history.map((term) => (
          <button key={term} type="button" className="search-history-chip" onClick={() => onPick?.(term)} title={`搜索：${term}`}>
            {term}
          </button>
        ))}
      </div>
    </div>
  );
}
