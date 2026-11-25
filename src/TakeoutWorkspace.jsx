import { useMemo, useState } from "react";
import {
  ArrowUpRight, Check, Coffee, ExternalLink, History, Pill, Receipt,
  Search, ShieldCheck, ShoppingBag, Soup, Sparkles, Store, UtensilsCrossed, Wallet, Wrench
} from "lucide-react";
import {
  buildTakeoutPlatformUrl,
  buildTakeoutRequest,
  formatTakeoutPrice,
  readTakeoutHistory,
  readTakeoutPlatformPref,
  recordTakeoutHistory,
  saveTakeoutPlatformPref,
  TAKEOUT_BUDGET_PRESETS,
  TAKEOUT_DIET_TAGS,
  TAKEOUT_PLATFORMS_META,
  TAKEOUT_PRESET_IDEAS,
  TAKEOUT_STEPS,
  takeoutPaymentReady,
  takeoutStepIndex,
  takeoutTaskLabel,
  toggleTakeoutDietTag,
} from "./takeout-assistant.js";
import { BudgetMeterBar } from "./DataVizPrimitives.jsx";
import "./takeout-assistant.css";

const IDEA_ICONS = {
  warm: Soup,
  light: UtensilsCrossed,
  drink: Coffee,
  fit: Sparkles,
  night: Store,
  care: Pill,
};

export default function TakeoutWorkspace({
  scope = "",
  aiName = "小灯",
  task = null,
  available = false,
  onOpenSheet,
  onStartQuick,
  onSendPlanToChat,
  onReviewPlatform,
  onOpenMedicineHub,
  onOpenDiagnostics,
  loginPanel = null,
}) {
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState("35");
  const [people, setPeople] = useState("1");
  const [note, setNote] = useState("");
  const [platform, setPlatform] = useState(() => readTakeoutPlatformPref(scope));
  const [history, setHistory] = useState(() => readTakeoutHistory(scope));
  const [statusMessage, setStatusMessage] = useState("");

  const current = task?.scope === scope ? task : null;
  const stepIndex = takeoutStepIndex(current);
  const paymentReady = takeoutPaymentReady(current);
  const activePlatform = useMemo(
    () => TAKEOUT_PLATFORMS_META.find((item) => item.id === platform) || TAKEOUT_PLATFORMS_META[0],
    [platform],
  );

  function choosePlatform(nextId) {
    setPlatform(nextId);
    saveTakeoutPlatformPref(scope, nextId);
  }

  function handleLaunch() {
    const request = buildTakeoutRequest({ query, budget, people, note, platform });
    if (!request.ok) {
      setStatusMessage(request.message);
      return;
    }
    setStatusMessage("");
    setHistory(recordTakeoutHistory(scope, {
      query: request.query,
      budget: request.budget === null ? "" : String(request.budget),
      people: String(request.people),
      note: request.note,
      platform,
    }));
    if (available && typeof onStartQuick === "function") {
      onStartQuick(request);
      return;
    }
    if (typeof onSendPlanToChat === "function") {
      onSendPlanToChat(request.text);
      return;
    }
    onOpenSheet?.(request.query);
  }

  const budgetNumber = Number(budget);
  const estimatedPerPerson = Number.isFinite(budgetNumber) && budgetNumber > 0
    ? (budgetNumber / Math.max(1, Number(people) || 1)).toFixed(1)
    : "—";

  return (
    <section className="takeout-workspace" aria-label="外卖点单工作台">
      <header className="takeout-ws-hero">
        <div className="takeout-ws-hero-copy">
          <span className="takeout-ws-eyebrow">灯塔生活代理 · 支付前强人工确认</span>
          <h2>🛵 外卖点单工作台</h2>
          <p>
            告诉 {aiName} 想吃什么、预算和忌口，自动完成「搜店 → 读真实菜单 → 加购核对」，永远停在付款前等你确认。
          </p>
        </div>
        <div className="takeout-ws-hero-actions">
          <button
            type="button"
            className="takeout-ws-primary"
            data-dt-tip="打开聊天内悬浮外卖助手抽屉"
            onClick={() => onOpenSheet?.(query)}
          >
            <ShoppingBag size={16} aria-hidden="true" />
            打开实时选餐抽屉
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
          {typeof onOpenMedicineHub === "function" && (
            <button
              type="button"
              className="takeout-ws-secondary"
              data-dt-tip="身体不适？先查阅常见 OTC 药品表与药物冲突检测，再决定是否买药"
              onClick={onOpenMedicineHub}
            >
              <Pill size={15} aria-hidden="true" />
              应急查药 / 药箱
            </button>
          )}
          {typeof onOpenDiagnostics === "function" && (
            <button
              type="button"
              className="takeout-ws-secondary"
              data-dt-tip="查看外卖执行回执、Trace ID 与精准定位诊断日志"
              onClick={onOpenDiagnostics}
            >
              <Wrench size={15} aria-hidden="true" />
              外卖错误诊断
            </button>
          )}
        </div>
      </header>

      {current && (
        <div className="takeout-ws-live-card">
          <div className="takeout-ws-live-head">
            <div>
              <strong>{takeoutTaskLabel(current)}</strong>
              <p>{current.message}</p>
            </div>
            <div className="takeout-ws-live-right">
              {Number.isFinite(current.total) ? (
                <span className="takeout-ws-price">{formatTakeoutPrice(current.total)}</span>
              ) : null}
              <button
                type="button"
                className="takeout-ws-secondary"
                onClick={() => (paymentReady ? onReviewPlatform?.(platform) : onOpenSheet?.(""))}
              >
                {paymentReady ? <><Receipt size={14} aria-hidden="true" />去平台核对付款</> : "查看实时进度"}
              </button>
            </div>
          </div>
          <ol className="takeout-steps" aria-label="当前点餐步骤">
            {TAKEOUT_STEPS.map((step, index) => (
              <li
                key={step.id}
                className={current.completed?.includes(step.id) ? "is-complete" : stepIndex === index ? "is-current" : ""}
              >
                <span>{current.completed?.includes(step.id) ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
                {step.label}
              </li>
            ))}
          </ol>
          {Number.isFinite(current.total) && Number.isFinite(current.budget || budgetNumber) && (current.budget || budgetNumber) > 0 && (
            <BudgetMeterBar
              label="当前订单预算水位"
              used={Number(current.total.toFixed(2))}
              total={Number((current.budget || budgetNumber).toFixed(2))}
              unit=" 元"
            />
          )}
        </div>
      )}

      <div className="takeout-ws-grid">
        <div className="takeout-ws-card">
          <div className="takeout-ws-card-head">
            <h3><Sparkles size={16} aria-hidden="true" />智能选餐规划</h3>
            <span className="takeout-ws-badge">
              {available ? "Android 自动执行就绪" : "网页规划 + 平台直达模式"}
            </span>
          </div>

          <div className="takeout-platform-switcher" role="group" aria-label="选择偏好外卖平台">
            {TAKEOUT_PLATFORMS_META.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`takeout-platform-pill${platform === item.id ? " is-active" : ""}`}
                data-dt-tip={`切换偏好平台为 ${item.label}`}
                onClick={() => choosePlatform(item.id)}
              >
                <span>{item.label}</span>
                <small>{item.badge}</small>
              </button>
            ))}
          </div>

          <label className="takeout-query">
            <span><Search size={15} aria-hidden="true" />今天想吃点什么？</span>
            <textarea
              rows={2}
              maxLength={800}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：想吃一碗热乎的鲜虾馄饨，或者清淡少油的蒸菜便当…"
            />
          </label>

          <div className="takeout-ideas" aria-label="场景灵感">
            {TAKEOUT_PRESET_IDEAS.map((idea) => {
              const Icon = IDEA_ICONS[idea.id] || Soup;
              return (
                <button
                  key={idea.id}
                  type="button"
                  data-dt-tip={`填充「${idea.text}」默认预算 ¥${idea.budget}`}
                  onClick={() => { setQuery(idea.query); setBudget(idea.budget); }}
                >
                  <Icon size={14} aria-hidden="true" />
                  {idea.text}
                </button>
              );
            })}
          </div>

          <div className="takeout-preferences">
            <label>
              <span><Wallet size={15} aria-hidden="true" />总预算（人均约 ¥{estimatedPerPerson}）</span>
              <div>
                <span>¥</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="100000"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  aria-label="工作台总预算"
                />
              </div>
            </label>
            <label>
              <span><UtensilsCrossed size={15} aria-hidden="true" />用餐人数</span>
              <select value={people} onChange={(event) => setPeople(event.target.value)} aria-label="工作台用餐人数">
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} 人</option>)}
              </select>
            </label>
          </div>

          <div className="takeout-budget-presets" role="group" aria-label="工作台快捷预算">
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
            <span>口味与忌口标签</span>
            <input
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
              placeholder="不要香菜、微辣、少冰…"
            />
          </label>
          <div className="takeout-diet-tags" role="group" aria-label="工作台快捷忌口">
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

          {statusMessage && <p className="takeout-feedback" role="alert">{statusMessage}</p>}

          <div className="takeout-ws-submit-row">
            <button
              type="button"
              className="takeout-ws-primary"
              data-dt-tip={available ? "立即派发 AI 外卖自动选餐任务" : "发送结构化点餐计划给 AI 伴侣一起挑菜"}
              onClick={handleLaunch}
            >
              <Sparkles size={16} aria-hidden="true" />
              {available ? "立即让 AI 帮我挑" : `发给 ${aiName} 参谋并生成清单`}
            </button>
            <a
              className="takeout-ws-secondary"
              href={buildTakeoutPlatformUrl(platform, query.trim() ? "search" : "home", query)}
              target="_blank"
              rel="noopener noreferrer"
              data-dt-tip={`在新窗口打开 ${activePlatform.label} 搜索对应关键词`}
            >
              <ExternalLink size={15} aria-hidden="true" />
              直达 {activePlatform.label}
            </a>
          </div>
        </div>

        <div className="takeout-ws-side">
          <div className="takeout-ws-card">
            <div className="takeout-ws-card-head">
              <h3><History size={16} aria-hidden="true" />最近点餐偏好复用</h3>
              <small>{history.length} 条记录</small>
            </div>
            {!history.length ? (
              <p className="takeout-ws-muted">还没有点餐历史，选择上方灵感或发起一次选餐后会自动记住你的口味偏好。</p>
            ) : (
              <div className="takeout-ws-history-list">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="takeout-ws-history-item"
                    data-dt-tip="一键回填这条历史点餐偏好"
                    onClick={() => {
                      setQuery(item.query);
                      if (item.budget !== undefined) setBudget(String(item.budget));
                      if (item.people) setPeople(String(item.people));
                      if (item.note !== undefined) setNote(item.note);
                      if (item.platform) choosePlatform(item.platform);
                    }}
                  >
                    <div>
                      <strong>{item.query}</strong>
                      <small>
                        {item.people || 1} 人{item.budget ? ` · 预算 ¥${item.budget}` : ""}{item.note ? ` · ${item.note}` : ""}
                      </small>
                    </div>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="takeout-ws-card">
            <div className="takeout-ws-card-head">
              <h3><ShieldCheck size={16} aria-hidden="true" />四重安全护栏</h3>
            </div>
            <ul className="takeout-ws-guardrails">
              <li><strong>真实菜单校验</strong>：必须先搜店并读取真实菜单，禁止 AI 猜测商品名或价格。</li>
              <li><strong>预算与份数锁定</strong>：预算上限与份数跨步骤强制继承，超预算自动拦截加购。</li>
              <li><strong>幂等防重复加购</strong>：每轮命令绑定唯一重试键与崩溃恢复标记，异常中断绝不重复加购。</li>
              <li><strong>付款前人工接管</strong>：永远停在结算页之前，账号 Cookie 仅保存在本机 WebView 不上传服务器。</li>
            </ul>
          </div>

          {loginPanel}
        </div>
      </div>
    </section>
  );
}
