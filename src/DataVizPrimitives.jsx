import { useId } from "react";

export function HorizontalBarChart({ items = [], emptyText = "暂无统计数据", unit = "", maxBars = 6, accent = "default" }) {
  const safeItems = (Array.isArray(items) ? items : []).filter((item) => item && Number(item.value ?? item.count) > 0).slice(0, maxBars);
  if (!safeItems.length) {
    return <p className="dt-viz-empty">{emptyText}</p>;
  }
  const maxValue = Math.max(1, ...safeItems.map((item) => Number(item.value ?? item.count) || 0));
  return (
    <div className={`dt-viz-bars is-${accent}`} role="list">
      {safeItems.map((item) => {
        const numeric = Number(item.value ?? item.count) || 0;
        const pct = Math.max(6, Math.min(100, Math.round((numeric / maxValue) * 100)));
        return (
          <div className="dt-viz-bar-row" role="listitem" key={item.key || item.label}>
            <span className="dt-viz-bar-label" title={item.label}>{item.label}</span>
            <span className="dt-viz-bar-track" aria-hidden="true">
              <span className="dt-viz-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <strong className="dt-viz-bar-value">{numeric}{unit}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function BudgetMeterBar({ used = 0, total = 100, reserved = 0, label = "容量占比", unit = "" }) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeUsed = Math.max(0, Number(used) || 0);
  const safeReserved = Math.max(0, Number(reserved) || 0);
  const usedPct = Math.min(100, Math.round((safeUsed / safeTotal) * 100));
  const reservedPct = Math.min(100 - usedPct, Math.round((safeReserved / safeTotal) * 100));
  const over = safeUsed + safeReserved > safeTotal;
  const tone = over ? "is-danger" : usedPct + reservedPct >= 82 ? "is-warn" : "is-ok";

  return (
    <div className={`dt-viz-meter ${tone}`} aria-label={`${label}：${safeUsed}${unit} / ${safeTotal}${unit}`}>
      <div className="dt-viz-meter-head">
        <span>{label}</span>
        <strong>
          {safeUsed.toLocaleString("zh-CN")}{unit} / {safeTotal.toLocaleString("zh-CN")}{unit}
          {safeReserved > 0 ? `（含预留 ${safeReserved.toLocaleString("zh-CN")}${unit}）` : ""}
        </strong>
      </div>
      <div className="dt-viz-meter-track" role="progressbar" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100}>
        <span className="dt-viz-meter-used" style={{ width: `${usedPct}%` }} />
        {reservedPct > 0 && <span className="dt-viz-meter-reserved" style={{ width: `${reservedPct}%` }} />}
      </div>
    </div>
  );
}

export function ScoreTripletBars({ bm25 = 0, semantic = 0, rrf = 0 }) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) * 100)));
  const rows = [
    { key: "bm25", label: "BM25", pct: clamp(bm25), tone: "is-bm25" },
    { key: "semantic", label: "语义", pct: clamp(semantic), tone: "is-semantic" },
    { key: "rrf", label: "融合", pct: clamp(rrf), tone: "is-rrf" },
  ];
  return (
    <div className="dt-viz-triplet" aria-label={`检索评分：BM25 ${rows[0].pct}%，语义 ${rows[1].pct}%，融合 ${rows[2].pct}%`}>
      {rows.map((row) => (
        <div className={`dt-viz-triplet-item ${row.tone}`} key={row.key}>
          <span>{row.label}</span>
          <i aria-hidden="true"><b style={{ width: `${Math.max(4, row.pct)}%` }} /></i>
          <em>{row.pct}%</em>
        </div>
      ))}
    </div>
  );
}

export function MiniSparkline({ points = [], label = "趋势", width = 180, height = 42 }) {
  const gradId = useId();
  const values = (Array.isArray(points) ? points : []).map((p) => Number(typeof p === "number" ? p : p?.count ?? p?.value ?? 0));
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const padX = 4;
  const padY = 5;
  const stepX = (width - padX * 2) / Math.max(1, values.length - 1);
  const coords = values.map((v, idx) => ({
    x: padX + idx * stepX,
    y: height - padY - (v / max) * (height - padY * 2),
  }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords.at(-1).x.toFixed(1)},${(height - padY).toFixed(1)} L${coords[0].x.toFixed(1)},${(height - padY).toFixed(1)} Z`;

  return (
    <svg className="dt-viz-sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={coords.at(-1).x} cy={coords.at(-1).y} r="2.8" fill="currentColor" />
    </svg>
  );
}
