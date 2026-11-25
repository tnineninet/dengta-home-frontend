import { useEffect } from "react";
import { enrichAchievementItem } from "./achievement-system.js";
import "./achievement-guide.css";

export default function AchievementNotice({ items = [], onDismiss, onView }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [items, onDismiss]);

  const enriched = items.slice(0, 3).map(enrichAchievementItem);
  const earnedPoints = enriched.reduce((sum, item) => sum + item.points, 0);

  return (
    <aside className="achievement-notice is-celebrating" aria-label="成就小纪念">
      <span className="achievement-notice-sparkles" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </span>
      <div role="status" aria-live="polite">
        <div className="achievement-notice-head">
          <strong>✨ 恭喜点亮新勋章！</strong>
          {earnedPoints > 0 ? <em className="achievement-notice-points">+{earnedPoints} 星光</em> : null}
        </div>
        {enriched.map((item) => (
          <p key={item.code || item.id} className={`achievement-notice-item is-${item.rarityTone}`}>
            <span className="achievement-notice-emoji" aria-hidden="true">{item.emoji || "✧"}</span>
            <span>
              <b>{item.title}</b>
              <em className="achievement-notice-rarity">{item.rarityLabel}</em>
              <small>{item.description}</small>
            </span>
          </p>
        ))}
      </div>
      <div className="achievement-notice-actions">
        <button type="button" className="is-primary" onClick={onView}>看看勋章墙</button>
        <button type="button" onClick={onDismiss} aria-label="收起成就提示">收起</button>
      </div>
    </aside>
  );
}
