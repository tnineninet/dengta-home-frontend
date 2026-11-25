import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowDown, ArrowUpRight, BadgeCheck, Check, ChevronRight, Clock, Coffee,
  ExternalLink, History, LoaderCircle, MapPin, Minus, Pill, Receipt, RotateCcw, Search,
  ShoppingBag, Soup, Sparkles, Store, UtensilsCrossed, Wallet, Wrench, X
} from "lucide-react";
import { useBackLayer } from "./useAppBackNavigation.js";
import { BudgetMeterBar } from "./DataVizPrimitives.jsx";
import {
  buildTakeoutPlatformUrl,
  buildTakeoutRequest,
  formatTakeoutPrice,
  parseShopMetaTags,
  readTakeoutHistory,
  readTakeoutPlatformPref,
  recordTakeoutHistory,
  saveTakeoutPlatformPref,
  TAKEOUT_BUDGET_PRESETS,
  TAKEOUT_DIET_TAGS,
  TAKEOUT_PLATFORMS_META,
  TAKEOUT_PRESET_IDEAS,
  TAKEOUT_STEPS,
  takeoutMenuChoices,
  takeoutPaymentReady,
  takeoutRecoverySuggestion,
  takeoutShopChoices,
  takeoutStepIndex,
  takeoutStopLabel,
  takeoutTaskLabel,
  toggleTakeoutDietTag,
} from "./takeout-assistant.js";
import "./takeout-assistant.css";

const IDEA_ICONS = {
  warm: Soup,
  light: UtensilsCrossed,
  drink: Coffee,
  fit: Sparkles,
  night: Store,
  care: Pill,
};

function StatusChip({ task }) {
  const tone = task?.status === "awaiting_payment" ? "is-ready" : task?.status === "manual_review" ? "is-attention"
    : task?.status === "error" ? "is-error" : task ? "is-working" : "is-idle";
  return <span className={`takeout-status ${tone}`}><i aria-hidden="true" />{task ? takeoutTaskLabel(task) : "待开始"}</span>;
}

export function TakeoutTaskCard({ task, onOpen, onDismiss }) {
  if (!task) return null;
  const stepIndex = takeoutStepIndex(task);
  const step = TAKEOUT_STEPS[stepIndex] || null;
  const price = formatTakeoutPrice(task.total);
  const budget = formatTakeoutPrice(task.budget);
  const tone = task.status === "awaiting_payment" ? "is-ready"
    : task.status === "manual_review" ? "is-attention"
      : task.status === "error" ? "is-error" : "is-working";
  const subtitle = [task.shop, task.product].filter(Boolean).join(" · ")
    || (task.requirement ? `想点：${task.requirement}` : "点一下查看进度");
  const amount = price ? `实付 ${price}` : budget ? `预算 ${budget}` : "";
  const activate = (event) => {
    if (event?.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    event?.preventDefault?.();
    onOpen?.();
  };
  return <div
    role="button"
    tabIndex={0}
    className="takeout-task-card"
    data-dt-tip="点击展开外卖实时进度面板与核对清单"
    onClick={activate}
    onKeyDown={activate}
    aria-label={`查看外卖点餐进度：${takeoutTaskLabel(task)}${subtitle ? `，${subtitle}` : ""}${amount ? `，${amount}` : ""}`}
  >
    <span className={`takeout-task-icon ${tone}`}><ShoppingBag size={19} aria-hidden="true" /></span>
    <span className="takeout-task-copy">
      <span className="takeout-task-title-row">
        <strong>{takeoutTaskLabel(task)}</strong>
        {price ? <em>{price}</em> : budget ? <em className="is-budget">预算 {budget}</em> : null}
      </span>
      <small>{subtitle}</small>
      <span className="takeout-task-meta">
        {step ? `${stepIndex + 1}/4 · ${step.label}` : "等待开始"}
        {task.status === "manual_review" ? " · 需要你接手" : ""}
      </span>
      <span className="takeout-task-track" aria-hidden="true">{[0, 1, 2, 3].map(index => <i key={index} className={index <= stepIndex ? "is-on" : ""} />)}</span>
    </span>
    <ChevronRight size={18} aria-hidden="true" />
    {typeof onDismiss === "function" && <button
      type="button"
      className="takeout-task-dismiss"
      aria-label="关闭外卖任务卡片"
      data-dt-tip="隐藏任务提示卡（不影响正在进行的选餐）"
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onDismiss(); }}
    ><X size={14} aria-hidden="true" /></button>}
  </div>;
}

export default function TakeoutAssistant(props) {
  return <ScopedTakeoutAssistant key={props.scope} {...props} />;
}

function ScopedTakeoutAssistant({
  open,
  onClose,
  scope,
  aiName = "小灯",
  initialQuery = "",
  task = null,
  busy = false,
  available = false,
  onStart,
  onStop,
  onReview,
  onSendPlanToChat,
  onOpenDiagnostics,
  loginPanel,
}) {
  const [query, setQuery] = useState(initialQuery);
  const [querySeed, setQuerySeed] = useState(initialQuery);
  const [budget, setBudget] = useState("35");
  const [people, setPeople] = useState("1");
  const [note, setNote] = useState("");
  const [platform, setPlatform] = useState(() => readTakeoutPlatformPref(scope));
  const [history, setHistory] = useState(() => readTakeoutHistory(scope));
  const [feedback, setFeedback] = useState("");
  const [starting, setStarting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const pending = useRef(false), panel = useRef(null), close = useRef(null), mounted = useRef(false);
  useBackLayer(open, onClose, 150);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (initialQuery !== querySeed) {
    setQuerySeed(initialQuery);
    if (initialQuery) setQuery(initialQuery);
  }
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    close.current?.focus();
    const onKey = event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const nodes = [...(panel.current?.querySelectorAll("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary") || [])];
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
      if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus?.({ preventScroll: true }); };
  }, [open, onClose]);

  function selectPlatform(nextId) {
    setPlatform(nextId);
    saveTakeoutPlatformPref(scope, nextId);
  }

  async function start(override = null) {
    if (pending.current || busy || !scope || !available) return;
    const reqArgs = override || { query, budget, people, note, platform };
    const request = buildTakeoutRequest(reqArgs);
    if (!request.ok) { setFeedback(request.message); return; }
    pending.current = true; setStarting(true); setFeedback("");
    setHistory(recordTakeoutHistory(scope, {
      query: request.query,
      budget: request.budget === null ? "" : String(request.budget),
      people: String(request.people),
      note: request.note,
      platform,
    }));
    try {
      const result = await onStart?.(request);
      if (mounted.current && result?.ok !== true) setFeedback(result?.message || "暂时没能开始，请检查聊天连接后再试。");
    } catch {
      if (mounted.current) setFeedback("暂时没能确认任务是否开始，请查看聊天和平台页面，避免重复操作。");
    } finally {
      pending.current = false;
      if (mounted.current) setStarting(false);
    }
  }

  function sendWebPlan() {
    const request = buildTakeoutRequest({ query, budget, people, note, platform });
    if (!request.ok) { setFeedback(request.message); return; }
    setHistory(recordTakeoutHistory(scope, {
      query: request.query,
      budget: request.budget === null ? "" : String(request.budget),
      people: String(request.people),
      note: request.note,
      platform,
    }));
    onSendPlanToChat?.(request.text);
    onClose?.();
  }

  function applyRecoveryAction(actionId) {
    if (actionId === "raise_budget") {
      const nextBudget = String(Math.min(100000, Math.max(15, (Number(budget) || 35) + 10)));
      setBudget(nextBudget);
      setMoreOpen(true);
      setFeedback("");
      if (available && !busy) void start({ query, budget: nextBudget, people, note, platform });
      return;
    }
    if (actionId === "simplify_query") {
      const trimmed = query.replace(/[，。！？、,.!?；;：:]/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");
      if (trimmed) setQuery(trimmed);
      setFeedback("");
      return;
    }
    if (actionId === "switch_platform") {
      const idx = TAKEOUT_PLATFORMS_META.findIndex((p) => p.id === platform);
      const next = TAKEOUT_PLATFORMS_META[(idx + 1) % TAKEOUT_PLATFORMS_META.length];
      selectPlatform(next.id);
      setFeedback("");
      return;
    }
    if (actionId === "open_login") {
      setLoginOpen(true);
      return;
    }
    if (actionId === "review_cart") {
      onReview?.(platform);
      return;
    }
    if (actionId === "open_diagnostics") {
      onClose?.();
      onOpenDiagnostics?.();
    }
  }

  if (!open) return null;
  const current = task?.scope === scope ? task : null;
  const activeIndex = takeoutStepIndex(current);
  const working = current?.status === "working";
  const paymentReady = takeoutPaymentReady(current);
  const shops = takeoutShopChoices(current);
  const menu = takeoutMenuChoices(current);
  const chosen = current?.product || "";
  const recovery = takeoutRecoverySuggestion(current);
  const numericBudget = Number(budget);
  const activePlatformMeta = TAKEOUT_PLATFORMS_META.find((p) => p.id === platform) || TAKEOUT_PLATFORMS_META[0];

  return <div className="takeout-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="takeout-sheet" ref={panel} role="dialog" aria-modal="true" aria-labelledby="takeout-title">
      <div className="takeout-sheet-handle" aria-hidden="true" />
      <header className="takeout-header">
        <div className="takeout-brand">
          <span><ShoppingBag size={22} aria-hidden="true" /></span>
          <div><small>灯塔 · 一起吃点好的</small><h2 id="takeout-title">今天吃什么</h2></div>
        </div>
        <div className="takeout-header-side">
          <StatusChip task={current} />
          <button
            ref={close}
            type="button"
            className="takeout-icon-button"
            onClick={onClose}
            aria-label="收起外卖弹窗"
            data-dt-tip="收起外卖抽屉，保留草稿与后台进度 (Esc)"
          >
            <Minus size={20} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="takeout-sheet-body">
        {!current && <div className="takeout-intro"><span className="takeout-spark"><Sparkles size={18} aria-hidden="true" /></span><p><strong>选餐这件小事，交给{aiName}。</strong><span>找店、看菜单、挑好吃的，一路准备到付款前。最后一步，你来决定。</span></p><span className="takeout-bowl" aria-hidden="true">🍜</span></div>}
        {!available && <p className="takeout-platform-note" role="status">自动选餐在 Android App 中执行。网页端可整理结构化选餐需求发给 {aiName}，或直达外卖平台 H5 手动下单。</p>}

        <div className="takeout-platform-switcher" role="group" aria-label="选择偏好外卖平台">
          {TAKEOUT_PLATFORMS_META.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`takeout-platform-pill${platform === item.id ? " is-active" : ""}`}
              data-dt-tip={`切换偏好平台为 ${item.label}（${item.badge}）`}
              onClick={() => selectPlatform(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.badge}</small>
            </button>
          ))}
        </div>

        <label className="takeout-query">
          <span><Search size={16} aria-hidden="true" />想吃什么，随便说说</span>
          <textarea value={query} rows={2} maxLength={800} onChange={event => setQuery(event.target.value)} placeholder="想吃热乎的，别太辣，最好快一点…" />
        </label>

        {!current && (
          <div className="takeout-ideas" aria-label="选餐灵感">
            {TAKEOUT_PRESET_IDEAS.map((idea) => {
              const Icon = IDEA_ICONS[idea.id] || Soup;
              return (
                <button
                  type="button"
                  key={idea.id}
                  data-dt-tip={`一键填入「${idea.text}」建议预算 ¥${idea.budget}`}
                  onClick={() => { setQuery(idea.query); setBudget(idea.budget); }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {idea.text}
                </button>
              );
            })}
          </div>
        )}

        {!current && history.length > 0 && (
          <div className="takeout-history-row" aria-label="最近点餐草稿">
            <span className="takeout-history-label"><History size={13} aria-hidden="true" />最近常点</span>
            <div className="takeout-history-chips">
              {history.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-dt-tip={`复用历史草稿：${item.query}${item.budget ? ` · ¥${item.budget}` : ""}`}
                  onClick={() => {
                    setQuery(item.query);
                    if (item.budget !== undefined) setBudget(String(item.budget));
                    if (item.people) setPeople(String(item.people));
                    if (item.note !== undefined) setNote(item.note);
                    if (item.platform) selectPlatform(item.platform);
                  }}
                >
                  {item.query.slice(0, 14)}{item.query.length > 14 ? "…" : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        <details className="takeout-more" open={!current || moreOpen} onToggle={event => { if (current) setMoreOpen(event.currentTarget.open); }}>
          <summary><Wallet size={14} aria-hidden="true" /><span>预算、人数与口味</span>{current ? <small>可调整，不影响当前这一单</small> : null}</summary>
          <div className="takeout-preferences">
            <label>
              <span><Wallet size={15} aria-hidden="true" />总预算</span>
              <div><span>¥</span><input aria-label="含配送费的总预算" type="number" inputMode="decimal" min="0.01" max="100000" step="0.01" value={budget} onChange={event => setBudget(event.target.value)} placeholder="先比较" /></div>
            </label>
            <label>
              <span><UtensilsCrossed size={15} aria-hidden="true" />几个人吃</span>
              <select value={people} onChange={event => setPeople(event.target.value)} aria-label="用餐人数">{[1, 2, 3, 4, 5, 6].map(number => <option key={number} value={number}>{number} 人</option>)}</select>
            </label>
          </div>
          <div className="takeout-budget-presets" role="group" aria-label="快捷预算">
            {TAKEOUT_BUDGET_PRESETS.map((amount) => (
              <button
                key={amount}
                type="button"
                className={Number(budget) === amount ? "is-active" : ""}
                onClick={() => setBudget(String(amount))}
              >
                ¥{amount}
              </button>
            ))}
          </div>
          <label className="takeout-note">
            <span>口味与忌口 <small>可选 · 点标签快选</small></span>
            <input value={note} maxLength={300} onChange={event => setNote(event.target.value)} placeholder="比如：不要香菜、少冰，或希望吃饱一点" />
          </label>
          <div className="takeout-diet-tags" role="group" aria-label="快捷忌口标签">
            {TAKEOUT_DIET_TAGS.map((tag) => {
              const active = note.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={active ? "is-active" : ""}
                  onClick={() => setNote((prev) => toggleTakeoutDietTag(prev, tag))}
                >
                  {active ? "✓ " : "+ "}{tag}
                </button>
              );
            })}
          </div>
        </details>

        {!current && <ol className="takeout-flow" aria-label="AI 会怎么做">{TAKEOUT_STEPS.map((step, index) => <li key={step.id}><span>{index + 1}</span>{step.label}</li>)}</ol>}

        {current && <section className="takeout-live" aria-label="外卖实时进度">
          <div className="takeout-agent">
            <span className="takeout-agent-face" aria-hidden="true">🛵</span>
            <div className="takeout-agent-bubble"><strong>{takeoutTaskLabel(current)}</strong><p role="status" aria-live="polite">{current.message}</p></div>
            <small>{activePlatformMeta.label} · 本机</small>
          </div>
          <ol className="takeout-steps" aria-label="点餐步骤">{TAKEOUT_STEPS.map((step, index) => <li key={step.id} className={current.completed?.includes(step.id) ? "is-complete" : activeIndex === index ? "is-current" : ""}><span>{current.completed?.includes(step.id) ? <Check size={13} aria-hidden="true" /> : index + 1}</span>{step.label}</li>)}</ol>

          {(current.shop || current.product) && <div className="takeout-selection"><span className="takeout-selection-icon" aria-hidden="true">🥡</span><div><strong>{current.shop || "正在挑选店铺"}</strong><small>{current.product || "正在比较实际菜单与价格"}</small></div>{Number.isFinite(current.total) && <strong className="takeout-total">¥{current.total.toFixed(2)}</strong>}</div>}

          {Number.isFinite(current.total) && Number.isFinite(current.budget || numericBudget) && (current.budget || numericBudget) > 0 && (
            <BudgetMeterBar
              label="实付金额 / 预算水位"
              used={Number(current.total.toFixed(2))}
              total={Number((current.budget || numericBudget).toFixed(2))}
              unit=" 元"
            />
          )}

          {paymentReady && <div className="takeout-payment" aria-label="待付款订单">
            <div className="takeout-payment-head"><span><Receipt size={15} aria-hidden="true" />已经核对的这一单</span><strong>¥{current.total.toFixed(2)}</strong></div>
            <ul>{current.lines.map((line, index) => <li key={index}><span>{line.name}</span><small>× {line.quantity}</small></li>)}</ul>
            <p><Clock size={13} aria-hidden="true" />金额和商品已核对；请亲自确认收货地址并付款，DengTa 不会替你付款。</p>
            {typeof onReview === "function" && <button type="button" className="takeout-review" data-dt-tip={`切回 ${activePlatformMeta.label} 结算页人工核对并付款`} onClick={() => onReview(platform)}>回到平台页面付款<ArrowUpRight size={15} aria-hidden="true" /></button>}
          </div>}

          {working && shops.length > 0 && !current.shop && <div className="takeout-pick"><div className="takeout-pick-heading"><Store size={14} aria-hidden="true" />AI 正在比较这 {shops.length} 家店</div>{shops.map((shop, index) => {
            const metaTags = parseShopMetaTags(shop.meta);
            return <div className="takeout-pick-row" key={index}>
              <div className="takeout-pick-main">
                <span>{shop.name}</span>
                {metaTags.length > 0 && <div className="takeout-shop-tags">{metaTags.map((t) => <em key={t}>{t}</em>)}</div>}
              </div>
              <small>{Number.isFinite(shop.rating) ? <><BadgeCheck size={12} aria-hidden="true" />{shop.rating} 分</> : <><MapPin size={12} aria-hidden="true" />真实结果</>}</small>
            </div>;
          })}</div>}

          {menu.length > 0 && <div className="takeout-menu"><div className="takeout-pick-heading"><UtensilsCrossed size={14} aria-hidden="true" />{current.shop ? `${current.shop} 的真实菜单` : "这家的真实菜单"}</div>{menu.map((item, index) => {
            const active = chosen && item.name.replace(/\s+/g, "") === chosen.replace(/\s+/g, "");
            const overBudget = Number.isFinite(item.price) && Number.isFinite(numericBudget) && numericBudget > 0 && item.price > numericBudget;
            return <div className={`takeout-menu-row${active ? " is-chosen" : ""}${overBudget ? " is-over-budget" : ""}`} key={index}>
              <span>{item.name}</span>
              {item.price !== null ? <strong>{formatTakeoutPrice(item.price)}</strong> : <small>价格待确认</small>}
              {active && <em><Check size={11} aria-hidden="true" />AI 选中</em>}
              {overBudget && !active && <small className="takeout-over-tag">超预算</small>}
              {!item.available && <small>售罄</small>}
            </div>;
          })}</div>}

          {!paymentReady && current.status === "error" && <p className="takeout-live-error"><AlertCircle size={14} aria-hidden="true" />{current.message}</p>}
          {current.code && <code className="takeout-code">{current.code}</code>}

          {recovery && !paymentReady && (
            <div className="takeout-recovery-box" aria-label="快捷纠偏建议">
              <strong>{recovery.title}</strong>
              <p>{recovery.hint}</p>
              <div className="takeout-recovery-actions">
                {recovery.actions.includes("raise_budget") && (
                  <button type="button" onClick={() => applyRecoveryAction("raise_budget")}>
                    <RotateCcw size={13} aria-hidden="true" />预算 +¥10 重试
                  </button>
                )}
                {recovery.actions.includes("simplify_query") && (
                  <button type="button" onClick={() => applyRecoveryAction("simplify_query")}>
                    <Search size={13} aria-hidden="true" />精简关键词
                  </button>
                )}
                {recovery.actions.includes("switch_platform") && (
                  <button type="button" onClick={() => applyRecoveryAction("switch_platform")}>
                    <Store size={13} aria-hidden="true" />切换外卖平台
                  </button>
                )}
                {recovery.actions.includes("open_login") && (
                  <button type="button" onClick={() => applyRecoveryAction("open_login")}>
                    去检查平台登录
                  </button>
                )}
                {recovery.actions.includes("review_cart") && typeof onReview === "function" && (
                  <button type="button" onClick={() => applyRecoveryAction("review_cart")}>
                    切回平台看购物车
                  </button>
                )}
                {recovery.actions.includes("open_diagnostics") && typeof onOpenDiagnostics === "function" && (
                  <button type="button" onClick={() => applyRecoveryAction("open_diagnostics")}>
                    <Wrench size={13} aria-hidden="true" />查看外卖错误日志
                  </button>
                )}
              </div>
            </div>
          )}

          {working && typeof onStop === "function" && <button type="button" className="takeout-stop" data-dt-tip="立即暂停自动操作，保留当前网页与购物车" onClick={onStop}><X size={14} aria-hidden="true" />{takeoutStopLabel()}</button>}
        </section>}

        <details className="takeout-login-details" open={loginOpen} onToggle={(event) => setLoginOpen(event.currentTarget.open)}><summary><span>平台登录与连接</span><ChevronRight size={16} aria-hidden="true" /></summary>{loginPanel}</details>
        {feedback && <p className="takeout-feedback" role="alert">{feedback}</p>}
      </div>
      <footer className="takeout-footer">
        {paymentReady && typeof onReview === "function"
          ? <button className="takeout-start" type="button" onClick={() => onReview(platform)}><Receipt size={18} aria-hidden="true" />回到平台付款<ArrowUpRight size={18} aria-hidden="true" /></button>
          : <button className="takeout-start" type="button" disabled={!available || !scope || busy || starting || working} onClick={() => void start()}>{starting || (busy && working) ? <LoaderCircle className="takeout-spinning" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}{working ? "正在帮你挑选" : "让 AI 帮我挑"}<ArrowUpRight size={18} aria-hidden="true" /></button>}
        {!available && (
          <div className="takeout-web-bridge">
            {typeof onSendPlanToChat === "function" && (
              <button
                type="button"
                className="takeout-web-action"
                data-dt-tip="把整理好的口味、预算与忌口发给 AI 伴侣一起参谋菜单"
                onClick={sendWebPlan}
              >
                <Sparkles size={14} aria-hidden="true" />发给 {aiName} 参谋选餐
              </button>
            )}
            <a
              className="takeout-web-action"
              href={buildTakeoutPlatformUrl(platform, query.trim() ? "search" : "home", query)}
              target="_blank"
              rel="noopener noreferrer"
              data-dt-tip={`在新标签页打开 ${activePlatformMeta.label} 搜索页`}
            >
              <ExternalLink size={14} aria-hidden="true" />打开 {activePlatformMeta.label}
            </a>
          </div>
        )}
        <small><ArrowDown size={12} aria-hidden="true" />自动准备到付款前 · 收起弹窗可以继续聊天</small>
      </footer>
    </section>
  </div>;
}
