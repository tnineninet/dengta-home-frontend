import { useEffect, useId, useRef, useState } from "react";

// 模型目录弹层：不使用 <datalist>（Android WebView 与部分浏览器不渲染），
// 而是真正的可点击 listbox；键盘（↑↓ Home End Enter/Escape）与手机点选都可用。
function normalizedModels(models) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(models) ? models : []) {
    const name = String(item ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    list.push(name);
  }
  return list;
}

function optionDomId(baseId, index) {
  return `${baseId}-option-${index}`;
}

export default function ProviderModelPicker({
  value = "",
  models = [],
  onChange,
  busy = false,
  loading = false,
  describedBy,
  placeholder = "例如：gpt-5.5",
}) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const inputId = `${baseId}-input`;
  const filterId = `${baseId}-filter`;
  const listboxRef = useRef(null);
  const toggleRef = useRef(null);
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const catalog = normalizedModels(models);
  const selected = String(value ?? "").trim();
  const query = filter.trim().toLowerCase();
  const filtered = query
    ? catalog.filter((model) => model.toLowerCase().includes(query))
    : catalog;
  const safeActiveIndex = filtered.length
    ? Math.min(Math.max(activeIndex, 0), filtered.length - 1)
    : 0;
  const activeModel = filtered[safeActiveIndex] || "";

  useEffect(() => {
    if (!open) return;
    const listbox = listboxRef.current;
    listbox?.focus?.();
    const active = listbox?.querySelector?.(`[data-active="true"]`);
    active?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (typeof document === "undefined") return undefined;
    function closeOnOutsidePointer(event) {
      const root = rootRef.current;
      if (root && typeof root.contains === "function" && root.contains(event.target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const listbox = listboxRef.current;
    const active = listbox?.querySelector?.(`[data-active="true"]`);
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  function openList() {
    setFilter("");
    const nextIndex = catalog.indexOf(selected);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
    setOpen(true);
  }

  function choose(model) {
    if (!model) return;
    setOpen(false);
    onChange?.(model);
    toggleRef.current?.focus?.();
  }

  function handleListKeyDown(event) {
    const key = event?.key;
    if (!key) return;
    if (key === "Escape") {
      event.preventDefault?.();
      setOpen(false);
      toggleRef.current?.focus?.();
      return;
    }
    if (key === "Tab") {
      setOpen(false);
      return;
    }
    if (!filtered.length) return;
    if (key === "ArrowDown") {
      event.preventDefault?.();
      setActiveIndex((current) => (Math.min(current, filtered.length - 1) + 1) % filtered.length);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault?.();
      setActiveIndex((current) => {
        const bounded = Math.min(current, filtered.length - 1);
        return (bounded <= 0 ? filtered.length : bounded) - 1;
      });
      return;
    }
    if (key === "Home") {
      event.preventDefault?.();
      setActiveIndex(0);
      return;
    }
    if (key === "End") {
      event.preventDefault?.();
      setActiveIndex(filtered.length - 1);
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault?.();
      choose(filtered[safeActiveIndex]);
    }
  }

  return (
    <div className="provider-model-field" ref={rootRef}>
      <span className="provider-field-label" id={labelId}>
        默认模型（自动选择）
      </span>
      <div className="provider-model-row">
        <button
          type="button"
          ref={toggleRef}
          className="provider-model-toggle"
          aria-label={catalog.length
            ? `选择模型（已发现 ${catalog.length} 个）`
            : "选择模型（还没有模型目录）"}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${baseId}-listbox`}
          disabled={Boolean(busy)}
          onClick={() => (open ? setOpen(false) : openList())}
        >
          <span className="provider-model-toggle-icon" aria-hidden="true">
            {open ? "▴" : "▾"}
          </span>
          <span>选择模型</span>
          {catalog.length > 0 && (
            <span className="provider-model-count" aria-hidden="true">{catalog.length}</span>
          )}
        </button>
        <input
          id={inputId}
          className="provider-model-input"
          value={value || ""}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          autoCapitalize="none"
          spellCheck="false"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
        />
      </div>
      {open && (
        <div className="provider-model-popover">
          {catalog.length > 6 && (
            <input
              id={filterId}
              className="provider-model-filter"
              type="search"
              value={filter}
              placeholder="筛选模型…"
              aria-label="筛选模型"
              autoCapitalize="none"
              spellCheck="false"
              onChange={(event) => {
                setFilter(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleListKeyDown}
            />
          )}
          <ul
            id={`${baseId}-listbox`}
            ref={listboxRef}
            className="provider-model-list"
            role="listbox"
            aria-labelledby={labelId}
            tabIndex={0}
            aria-activedescendant={activeModel
              ? optionDomId(baseId, safeActiveIndex)
              : undefined}
            onKeyDown={handleListKeyDown}
          >
            {filtered.map((model, index) => {
              const isSelected = model === selected;
              const isActive = index === safeActiveIndex;
              return (
                <li
                  key={model}
                  id={optionDomId(baseId, index)}
                  role="option"
                  aria-selected={isSelected}
                  data-model={model}
                  data-active={isActive ? "true" : "false"}
                  className={`provider-model-option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                  onClick={() => choose(model)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="provider-model-name">{model}</span>
                  {isSelected && <span className="provider-model-selected" aria-hidden="true">已选</span>}
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 && (
            <p className="provider-model-empty" role="status">
              {loading
                ? "正在读取模型目录…"
                : catalog.length > 0
                  ? "没有匹配的模型；可以直接关掉列表后手动输入。"
                  : "还没有模型目录：请先填好 Base URL 和 API Key（会自动读取），或直接手动输入服务商文档里的模型名。"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
