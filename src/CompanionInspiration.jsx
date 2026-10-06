import { useState } from "react";
import { pickCompanionInspiration } from "./companion-inspiration.js";

export default function CompanionInspiration({ onUse, disabled = false }) {
  const [card, setCard] = useState(null);
  const [used, setUsed] = useState(false);
  return <section className="companion-inspiration" aria-labelledby="inspiration-title">
    <div className="companion-inspiration-heading"><div><h3 id="inspiration-title">陪伴灵感签</h3><p>想一起做点什么时，随手抽一张。</p></div>
      <button type="button" onClick={() => { setCard(previous => pickCompanionInspiration(previous?.id)); setUsed(false); }}>{card ? "换一张" : "抽一张"}</button>
    </div>
    {card && <div className="companion-inspiration-result" aria-live="polite"><span aria-hidden="true">{card.symbol}</span><div><strong>{card.title}</strong><p>{card.hint}</p></div>
      <button type="button" disabled={disabled || used} onClick={() => { onUse?.(card.draft); setUsed(true); }}>{used ? "已带入草稿" : "带到聊天"}</button>
    </div>}
    {card && <small>只放入草稿，由你决定是否发送。</small>}
  </section>;
}
