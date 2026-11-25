import { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  Lock,
  Pin,
  PinOff,
  Send,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  computeAchievementSummary,
  readPinnedAchievements,
  savePinnedAchievements,
  togglePinnedAchievement,
} from "./achievement-system.js";
import "./achievement-wall.css";

const FILTER_TABS = [
  { id: "all", label: "全部" },
  { id: "next", label: "推荐先玩" },
  { id: "unlocked", label: "已点亮" },
  { id: "locked", label: "待探索" },
  { id: "旅程", label: "旅程" },
  { id: "陪伴", label: "陪伴" },
  { id: "一起", label: "一起" },
  { id: "分享", label: "分享" },
  { id: "收藏", label: "收藏" },
  { id: "自定义", label: "自定义" },
];

function formatUnlockDate(value) {
  if (!value) return "";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function AchievementShowcaseWall({
  scopeKey = "",
  achievements = [],
  aiName = "伴侣",
  busy = false,
  onTriggerAction,
  onUnlockCustom,
  onRemoveCustom,
  onCelebrate,
  onShareToChat,
}) {
  const [filter, setFilter] = useState("all");
  const [pinnedCodes, setPinnedCodes] = useState(() => readPinnedAchievements(scopeKey));

  const summary = useMemo(() => computeAchievementSummary(achievements), [achievements]);

  const unlockedByCode = useMemo(
    () => new Map(summary.items.filter((it) => it.unlocked).map((it) => [it.code, it])),
    [summary.items],
  );

  const showcaseSlots = useMemo(() => {
    const validPinned = pinnedCodes.map((code) => unlockedByCode.get(code)).filter(Boolean);
    const autoFill = summary.items
      .filter((it) => it.unlocked && !pinnedCodes.includes(it.code))
      .sort((a, b) => b.points - a.points)
      .slice(0, Math.max(0, 3 - validPinned.length));
    const filled = [...validPinned, ...autoFill].slice(0, 3);
    while (filled.length < 3) filled.push(null);
    return filled;
  }, [pinnedCodes, summary.items, unlockedByCode]);

  const visibleItems = useMemo(() => {
    if (filter === "all") {
      return [...summary.items].sort((a, b) => {
        if (Boolean(a.unlocked) !== Boolean(b.unlocked)) return a.unlocked ? -1 : 1;
        return a.order - b.order;
      });
    }
    if (filter === "next") {
      return summary.items
        .filter((it) => !it.unlocked)
        .sort((a, b) => {
          const aP = a.progress?.percent ?? 0;
          const bP = b.progress?.percent ?? 0;
          if (aP !== bP) return bP - aP;
          if (Boolean(a.secret) !== Boolean(b.secret)) return a.secret ? 1 : -1;
          return a.order - b.order;
        });
    }
    if (filter === "unlocked") return summary.items.filter((it) => it.unlocked);
    if (filter === "locked") return summary.items.filter((it) => !it.unlocked);
    return summary.items.filter((it) => it.category === filter);
  }, [filter, summary.items]);

  const spotlight = summary.recommendedNext[0] || null;
  const { currentRank, nextRank, pointsToNextRank, rankProgressPercent } = summary.rank;

  function handlePinToggle(code) {
    const next = togglePinnedAchievement(pinnedCodes, code, 3);
    setPinnedCodes(next);
    savePinnedAchievements(scopeKey, next);
  }

  return (
    <div className="ach-wall-enhanced">
      <section className="ach-rank-hero" aria-label="伴侣星光段位与成就总览">
        <div className="ach-rank-top">
          <div className="ach-rank-emblem" aria-hidden="true">
            <span>{currentRank.badge}</span>
            <em>Lv.{currentRank.level}</em>
          </div>
          <div className="ach-rank-copy">
            <div className="ach-rank-title-row">
              <strong>{currentRank.title}</strong>
              <span className="ach-points-pill">
                <Sparkles size={12} aria-hidden="true" />
                {summary.totalPoints} 星光
              </span>
            </div>
            <p>{currentRank.vibe}</p>
            <div className="ach-rank-progress-wrap">
              <div className="ach-rank-bar" aria-hidden="true">
                <span style={{ width: `${rankProgressPercent}%` }} />
              </div>
              <small>
                {nextRank
                  ? `已点亮 ${summary.unlockedCount}/${summary.totalCount} 枚勋章（${summary.completionPercent}%）· 再攒 ${pointsToNextRank} 星光晋升「${nextRank.title}」`
                  : `已点亮 ${summary.unlockedCount}/${summary.totalCount} 枚勋章 · 已达最高灯塔段位！`}
              </small>
            </div>
          </div>
        </div>

        <div className="ach-trophy-shelf" aria-label="荣耀展柜">
          <div className="ach-shelf-head">
            <span>
              <Trophy size={13} aria-hidden="true" /> 荣耀展柜（点击下方已点亮勋章可置顶展示）
            </span>
            <small>{summary.unlockedCount} 枚已收藏</small>
          </div>
          <div className="ach-shelf-slots">
            {showcaseSlots.map((slot, idx) =>
              slot ? (
                <button
                  key={slot.code}
                  type="button"
                  className={`ach-shelf-slot is-filled is-${slot.rarityTone}`}
                  onClick={() => onCelebrate?.([slot])}
                  title={`点击重温「${slot.title}」庆贺动画`}
                >
                  <span className="ach-shelf-emoji" aria-hidden="true">{slot.emoji || "✧"}</span>
                  <strong>{slot.title}</strong>
                  <small>+{slot.points} 星光 · {slot.rarityLabel}</small>
                </button>
              ) : (
                <div key={`empty-${idx}`} className="ach-shelf-slot is-empty">
                  <span className="ach-shelf-emoji" aria-hidden="true">✦</span>
                  <strong>空置展位</strong>
                  <small>点亮勋章即可放入</small>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      {spotlight ? (
        <section className="ach-spotlight-card" aria-label="下一步推荐目标">
          <div className="ach-spotlight-copy">
            <span className="ach-spotlight-eyebrow">
              <Compass size={13} aria-hidden="true" /> 下一步最容易点亮
            </span>
            <div className="ach-spotlight-title">
              <span aria-hidden="true">{spotlight.emoji || "✧"}</span>
              <strong>{spotlight.secret ? "秘境彩蛋 · 待触发" : spotlight.title}</strong>
              <em className={`ach-rarity-tag is-${spotlight.rarityTone}`}>
                {spotlight.rarityLabel} +{spotlight.points}
              </em>
            </div>
            <p>{spotlight.hint || spotlight.description}</p>
            {spotlight.progress && spotlight.progress.target > 1 ? (
              <div className="ach-mini-progress">
                <div className="ach-mini-track" aria-hidden="true">
                  <span style={{ width: `${spotlight.progress.percent}%` }} />
                </div>
                <small>进度 {spotlight.progress.current} / {spotlight.progress.target}</small>
              </div>
            ) : null}
          </div>
          {spotlight.action ? (
            <button
              type="button"
              className="ach-spotlight-cta"
              onClick={() => onTriggerAction?.(spotlight.action.view)}
            >
              <span>{spotlight.action.label}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : spotlight.custom ? (
            <button
              type="button"
              className="ach-spotlight-cta"
              disabled={busy}
              onClick={() => onUnlockCustom?.(spotlight.code)}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>标记达成</span>
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="ach-filter-bar" role="tablist" aria-label="筛选成就分类">
        {FILTER_TABS.map((tab) => {
          const count =
            tab.id === "all"
              ? summary.totalCount
              : tab.id === "unlocked"
                ? summary.unlockedCount
                : tab.id === "locked" || tab.id === "next"
                  ? summary.lockedCount
                  : summary.categoryCounts[tab.id] || 0;
          if (count === 0 && !["all", "unlocked", "locked", "next"].includes(tab.id)) {
            return null;
          }
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`ach-filter-pill${filter === tab.id ? " is-active" : ""}`}
              onClick={() => setFilter(tab.id)}
            >
              <span>{tab.label}</span>
              <em>{count}</em>
            </button>
          );
        })}
      </div>

      {visibleItems.length === 0 ? (
        <p className="ach-empty-hint">
          {filter === "unlocked"
            ? "还没有点亮勋章，先从上面的「下一步推荐」试试吧！"
            : "这一分类下暂时没有更多待探索成就，换个标签看看吧。"}
        </p>
      ) : (
        <div className="fun-achievements-grid">
          {visibleItems.map((item) => {
            const isSecretLocked = item.secret && !item.unlocked;
            const isPinned = pinnedCodes.includes(item.code);
            const unlockDay = formatUnlockDate(item.unlocked_at);

            return (
              <div
                key={item.code || item.id}
                className={`fun-achievement-card is-rarity-${item.rarityTone}${
                  item.unlocked ? " is-unlocked" : ""
                }${isSecretLocked ? " is-secret-locked" : ""}`}
              >
                <div className="ach-card-top">
                  <span className={`ach-rarity-tag is-${item.rarityTone}`}>
                    {item.rarityLabel}
                  </span>
                  <span className="ach-points-tag">+{item.points}</span>
                </div>

                <span className="fun-achievement-emoji" aria-hidden="true">
                  {isSecretLocked ? "❔" : item.emoji || "✧"}
                </span>

                <strong>{isSecretLocked ? "秘境彩蛋" : item.title}</strong>
                <small className="ach-card-desc">
                  {isSecretLocked ? `线索：${item.hint}` : item.description}
                </small>

                {!item.unlocked && item.progress && item.progress.target > 1 ? (
                  <div className="ach-card-progress">
                    <div className="ach-mini-track" aria-hidden="true">
                      <span style={{ width: `${item.progress.percent}%` }} />
                    </div>
                    <small>{item.progress.current} / {item.progress.target}</small>
                  </div>
                ) : null}

                <small className="ach-card-status">
                  {item.unlocked
                    ? `✓ ${unlockDay ? `${unlockDay} 点亮` : "已留下这份纪念"}`
                    : item.hint && !isSecretLocked
                      ? item.hint
                      : "有兴趣时再试试"}
                </small>

                {!item.unlocked && !item.custom && item.action ? (
                  <button
                    type="button"
                    className="ach-card-go-btn"
                    onClick={() => onTriggerAction?.(item.action.view)}
                  >
                    {item.action.label} →
                  </button>
                ) : null}

                {item.unlocked ? (
                  <div className="fun-achievement-card-actions ach-unlocked-tools">
                    <button
                      type="button"
                      className={isPinned ? "is-pinned" : ""}
                      onClick={() => handlePinToggle(item.code)}
                      title={isPinned ? "从荣耀展柜取消置顶" : "置顶到荣耀展柜"}
                    >
                      {isPinned ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}
                      <span>{isPinned ? "已展柜" : "置顶"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onCelebrate?.([item])}
                      title="重温解锁庆贺动效"
                    >
                      <Sparkles size={12} aria-hidden="true" />
                      <span>重温</span>
                    </button>
                    {onShareToChat ? (
                      <button
                        type="button"
                        onClick={() =>
                          onShareToChat(
                            `快看！我们点亮了「${item.emoji || "✨"} ${item.title}」成就（+${item.points} 星光），现在已经攒了 ${summary.totalPoints} 点星光、升到「${currentRank.title}」啦！${aiName}快夸夸我们～`,
                          )
                        }
                        title="发到聊天里和伴侣炫耀一下"
                      >
                        <Send size={12} aria-hidden="true" />
                        <span>炫耀</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {item.custom && !item.unlocked ? (
                  <div className="fun-achievement-card-actions">
                    <button
                      type="button"
                      className="is-complete-btn"
                      disabled={busy}
                      onClick={() => onUnlockCustom?.(item.code)}
                    >
                      ✓ 完成
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRemoveCustom?.(item.id)}
                    >
                      删除
                    </button>
                  </div>
                ) : null}

                {isSecretLocked ? (
                  <span className="ach-secret-lock" aria-hidden="true">
                    <Lock size={11} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
