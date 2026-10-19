import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowDown, ArrowUpRight, BadgeCheck, Check, ChevronRight, Clock, Coffee,
  LoaderCircle, MapPin, Minus, Receipt, Search, ShoppingBag, Soup, Sparkles, Store,
  UtensilsCrossed, Wallet, X
} from "lucide-react";
import { useBackLayer } from "./useAppBackNavigation.js";
import {
  buildTakeoutRequest, formatTakeoutPrice, takeoutMenuChoices, takeoutPaymentReady, takeoutShopChoices,
  takeoutStepIndex, takeoutStopLabel, takeoutTaskLabel, TAKEOUT_STEPS
} from "./takeout-assistant.js";
import "./takeout-assistant.css";

const IDEAS = [
  { icon: Soup, text: "热乎的一人食", query: "想吃一份热乎的一人食" },
  { icon: UtensilsCrossed, text: "清淡一点", query: "想吃清淡的饭菜" },
  { icon: Coffee, text: "喝点好喝的", query: "帮我挑一杯饮品" }
];

function StatusChip({ task }) {
  const tone = task?.status === "awaiting_payment" ? "is-ready" : task?.status === "manual_review" ? "is-attention"
    : task?.status === "error" ? "is-error" : task ? "is-working" : "is-idle";
  return <span className={`takeout-status ${tone}`}><i aria-hidden="true" />{task ? takeoutTaskLabel(task) : "待开始"}</span>;
}

export function TakeoutTaskCard({ task, onOpen }) {
  if (!task) return null;
  const stepIndex = takeoutStepIndex(task);
  return <button type="button" className="takeout-task-card" onClick={onOpen} aria-label="查看外卖点餐进度">
    <span className="takeout-task-icon"><ShoppingBag size={19} aria-hidden="true" /></span>
    <span className="takeout-task-copy">
      <strong>{takeoutTaskLabel(task)}</strong>
      <small>{task.shop || "外卖小助手"}{task.product ? ` · ${task.product}` : " · 可以继续聊天"}</small>
      <span className="takeout-task-track" aria-hidden="true">{[0, 1, 2, 3].map(index => <i key={index} className={index <= stepIndex ? "is-on" : ""} />)}</span>
    </span>
    <ChevronRight size={18} aria-hidden="true" />
  </button>;
}

export default function TakeoutAssistant(props) {
  return <ScopedTakeoutAssistant key={props.scope} {...props} />;
}

function ScopedTakeoutAssistant({ open, onClose, scope, aiName = "小灯", initialQuery = "", task = null, busy = false, available = false, onStart, onStop, onReview, loginPanel }) {
  const [query, setQuery] = useState(initialQuery);
  const [querySeed, setQuerySeed] = useState(initialQuery);
  const [budget, setBudget] = useState("35");
  const [people, setPeople] = useState("1");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [starting, setStarting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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

  async function start() {
    if (pending.current || busy || !scope || !available) return;
    const request = buildTakeoutRequest({ query, budget, people, note });
    if (!request.ok) { setFeedback(request.message); return; }
    pending.current = true; setStarting(true); setFeedback("");
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

  if (!open) return null;
  const current = task?.scope === scope ? task : null;
  const activeIndex = takeoutStepIndex(current);
  const working = current?.status === "working";
  const paymentReady = takeoutPaymentReady(current);
  const shops = takeoutShopChoices(current);
  const menu = takeoutMenuChoices(current);
  const chosen = current?.product || "";

  return <div className="takeout-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="takeout-sheet" ref={panel} role="dialog" aria-modal="true" aria-labelledby="takeout-title">
      <div className="takeout-sheet-handle" aria-hidden="true" />
      <header className="takeout-header">
        <div className="takeout-brand">
          <span><ShoppingBag size={22} aria-hidden="true" /></span>
          <div><small>灯塔 · 一起吃点好的</small><h2 id="takeout-title">今天吃什么</h2></div>
        </div>
        <div className="takeout-header-side"><StatusChip task={current} /><button ref={close} type="button" className="takeout-icon-button" onClick={onClose} aria-label="收起外卖弹窗"><Minus size={20} aria-hidden="true" /></button></div>
      </header>
      <div className="takeout-sheet-body">
        {!current && <div className="takeout-intro"><span className="takeout-spark"><Sparkles size={18} aria-hidden="true" /></span><p><strong>选餐这件小事，交给{aiName}。</strong><span>找店、看菜单、挑好吃的，一路准备到付款前。最后一步，你来决定。</span></p><span className="takeout-bowl" aria-hidden="true">🍜</span></div>}
        {!available && <p className="takeout-platform-note" role="status">自动选餐在 Android App 中执行。网页端可以整理需求，或到外卖平台手动点餐。</p>}

        <label className="takeout-query"><span><Search size={16} aria-hidden="true" />想吃什么，随便说说</span><textarea value={query} rows={2} maxLength={800} onChange={event => setQuery(event.target.value)} placeholder="想吃热乎的，别太辣，最好快一点…" /></label>
        {!current && <div className="takeout-ideas" aria-label="选餐灵感">{IDEAS.map(({ icon: Icon, text, query: idea }) => <button type="button" key={text} onClick={() => setQuery(idea)}><Icon size={15} aria-hidden="true" />{text}</button>)}</div>}
        <details className="takeout-more" open={!current || moreOpen} onToggle={event => { if (current) setMoreOpen(event.currentTarget.open); }}>
          <summary><Wallet size={14} aria-hidden="true" /><span>预算、人数与口味</span>{current ? <small>可调整，不影响当前这一单</small> : null}</summary>
          <div className="takeout-preferences"><label><span><Wallet size={15} aria-hidden="true" />总预算</span><div><span>¥</span><input aria-label="含配送费的总预算" type="number" inputMode="decimal" min="0.01" max="100000" step="0.01" value={budget} onChange={event => setBudget(event.target.value)} placeholder="先比较" /></div></label><label><span><UtensilsCrossed size={15} aria-hidden="true" />几个人吃</span><select value={people} onChange={event => setPeople(event.target.value)} aria-label="用餐人数">{[1, 2, 3, 4, 5, 6].map(number => <option key={number} value={number}>{number} 人</option>)}</select></label></div>
          <label className="takeout-note"><span>口味与忌口 <small>可选</small></span><input value={note} maxLength={300} onChange={event => setNote(event.target.value)} placeholder="比如：不要香菜、少冰，或希望吃饱一点" /></label>
        </details>
        {!current && <ol className="takeout-flow" aria-label="AI 会怎么做">{TAKEOUT_STEPS.map((step, index) => <li key={step.id}><span>{index + 1}</span>{step.label}</li>)}</ol>}

        {current && <section className="takeout-live" aria-label="外卖实时进度">
          <div className="takeout-agent">
            <span className="takeout-agent-face" aria-hidden="true">🛵</span>
            <div className="takeout-agent-bubble"><strong>{takeoutTaskLabel(current)}</strong><p role="status" aria-live="polite">{current.message}</p></div>
            <small>本机执行</small>
          </div>
          <ol className="takeout-steps" aria-label="点餐步骤">{TAKEOUT_STEPS.map((step, index) => <li key={step.id} className={current.completed?.includes(step.id) ? "is-complete" : activeIndex === index ? "is-current" : ""}><span>{current.completed?.includes(step.id) ? <Check size={13} aria-hidden="true" /> : index + 1}</span>{step.label}</li>)}</ol>

          {(current.shop || current.product) && <div className="takeout-selection"><span className="takeout-selection-icon" aria-hidden="true">🥡</span><div><strong>{current.shop || "正在挑选店铺"}</strong><small>{current.product || "正在比较实际菜单与价格"}</small></div>{Number.isFinite(current.total) && <strong className="takeout-total">¥{current.total.toFixed(2)}</strong>}</div>}

          {paymentReady && <div className="takeout-payment" aria-label="待付款订单">
            <div className="takeout-payment-head"><span><Receipt size={15} aria-hidden="true" />已经核对的这一单</span><strong>¥{current.total.toFixed(2)}</strong></div>
            <ul>{current.lines.map((line, index) => <li key={index}><span>{line.name}</span><small>× {line.quantity}</small></li>)}</ul>
            <p><Clock size={13} aria-hidden="true" />金额和商品已核对；请亲自确认收货地址并付款，DengTa 不会替你付款。</p>
            {typeof onReview === "function" && <button type="button" className="takeout-review" onClick={onReview}>回到平台页面付款<ArrowUpRight size={15} aria-hidden="true" /></button>}
          </div>}

          {working && shops.length > 0 && !current.shop && <div className="takeout-pick"><div className="takeout-pick-heading"><Store size={14} aria-hidden="true" />AI 正在比较这 {shops.length} 家店</div>{shops.map((shop, index) => <div className="takeout-pick-row" key={index}><span>{shop.name}</span><small>{Number.isFinite(shop.rating) ? <><BadgeCheck size={12} aria-hidden="true" />{shop.rating} 分</> : <><MapPin size={12} aria-hidden="true" />真实结果</>}</small></div>)}</div>}

          {menu.length > 0 && <div className="takeout-menu"><div className="takeout-pick-heading"><UtensilsCrossed size={14} aria-hidden="true" />{current.shop ? `${current.shop} 的真实菜单` : "这家的真实菜单"}</div>{menu.map((item, index) => {
            const active = chosen && item.name.replace(/\s+/g, "") === chosen.replace(/\s+/g, "");
            return <div className={`takeout-menu-row${active ? " is-chosen" : ""}`} key={index}><span>{item.name}</span>{item.price !== null ? <strong>{formatTakeoutPrice(item.price)}</strong> : <small>价格待确认</small>}{active && <em><Check size={11} aria-hidden="true" />AI 选中</em>}{!item.available && <small>售罄</small>}</div>;
          })}</div>}

          {!paymentReady && current.status === "error" && <p className="takeout-live-error"><AlertCircle size={14} aria-hidden="true" />{current.message}</p>}
          {current.code && <code className="takeout-code">{current.code}</code>}
          {working && typeof onStop === "function" && <button type="button" className="takeout-stop" onClick={onStop}><X size={14} aria-hidden="true" />{takeoutStopLabel()}</button>}
        </section>}

        <details className="takeout-login-details"><summary><span>平台登录与连接</span><ChevronRight size={16} aria-hidden="true" /></summary>{loginPanel}</details>
        {feedback && <p className="takeout-feedback" role="alert">{feedback}</p>}
      </div>
      <footer className="takeout-footer">
        {paymentReady && typeof onReview === "function"
          ? <button className="takeout-start" type="button" onClick={onReview}><Receipt size={18} aria-hidden="true" />回到平台付款<ArrowUpRight size={18} aria-hidden="true" /></button>
          : <button className="takeout-start" type="button" disabled={!available || !scope || busy || starting || working} onClick={() => void start()}>{starting || (busy && working) ? <LoaderCircle className="takeout-spinning" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}{working ? "正在帮你挑选" : "让 AI 帮我挑"}<ArrowUpRight size={18} aria-hidden="true" /></button>}
        <small><ArrowDown size={12} aria-hidden="true" />自动准备到付款前 · 收起弹窗可以继续聊天</small>
      </footer>
    </section>
  </div>;
}