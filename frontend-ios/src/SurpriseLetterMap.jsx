import { useEffect, useRef, useState } from "react";
import { mountSurpriseMap } from "./surprise-map-display.js";

const MESSAGES = {
  loading: "正在加载地图…",
  ready: "可拖动地图、双指缩放，点击圆圈查看来信。圆圈是模糊范围，不是精确落点。",
  unavailable: "部分地图未能加载，可重试。信件与领取仍可使用。（map_tiles_unavailable）",
  timeout: "地图加载超时，可重试；也能直接从卡片领取来信。（map_tiles_timeout）",
  failed: "地图组件未能加载，可重试。来信仍保留。（map_display_failed）",
};
export default function SurpriseLetterMap({ items, position, selectedId, onSelect, onViewport, picker = false, pickerPoint = null, onPick, tileSource = null, tiles = true, mount = mountSurpriseMap, onTilesUnavailable = null }) {
  const host = useRef(null), runtime = useRef(null), select = useRef(onSelect), viewport = useRef(onViewport), pick = useRef(onPick), source = useRef(tileSource), fallback = useRef(onTilesUnavailable);
  const [status, setStatus] = useState("loading"), [attempt, setAttempt] = useState(0);
  const unavailableNotified = useRef(false);
  const reportStatus = value => {
    setStatus(value);
    if (["unavailable", "timeout"].includes(value) && !unavailableNotified.current) {
      unavailableNotified.current = true;
      fallback.current?.();
    }
  };
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => { fallback.current = onTilesUnavailable; }, [onTilesUnavailable]);
  useEffect(() => { unavailableNotified.current = false; }, [tileSource]);
  useEffect(() => { viewport.current = onViewport; }, [onViewport]);
  useEffect(() => { pick.current = onPick; }, [onPick]);
  useEffect(() => { source.current = tileSource; }, [tileSource]);
  const tileSourceKey = JSON.stringify(tileSource || null);
  useEffect(() => {
    const controller = mount(host.current, { onStatus: reportStatus, onSelect: id => select.current?.(id), onViewport: bounds => viewport.current?.(bounds), picker, onPick: point => pick.current?.(point), tileSource: source.current, tiles });
    runtime.current = controller;
    // Radar↔street or fallback-source switches remount the runtime; replay the
    // current letters immediately or the new map stays empty until a feed change.
    controller.update({ items, position, selectedId, pickerPoint });
    return () => { controller.destroy(); if (runtime.current === controller) runtime.current = null; };
  }, [mount, attempt, picker, tileSourceKey, tiles]);
  useEffect(() => { runtime.current?.update({ items, position, selectedId, pickerPoint }); }, [items, position, selectedId, pickerPoint, attempt]);
  return <section className={`surprise-map-interactive${tiles ? "" : " is-radar"}`} data-status={status} aria-label={picker ? "选择公共落点的地图" : "沿途信件地图"}>
    <div className="surprise-map-canvas" ref={host} role="region" aria-label={picker ? "拖动或点击选择公共落点" : "可拖动缩放的地理地图"} />
    {tiles && status === "loading" && <div className="surprise-map-loading-veil" aria-hidden="true"><span>正在加载街道地图…</span></div>}
    <p role="status" className={`surprise-map-map-status ${status === "ready" && tiles ? "is-ready" : ""}`}>{picker && status === "ready" ? "拖动地图或点击公共地点，选择后仍需按确认按钮。也可使用地图方向键移动和加减号缩放。" : !tiles && status === "ready" ? "雷达图只显示模糊范围；需要真实街区时再打开街道地图。" : MESSAGES[status] || MESSAGES.failed}</p>
    {tiles && ["unavailable", "timeout", "failed"].includes(status) ? <button type="button" className="surprise-map-fit" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>重试地图</button> : !picker && items.length > 0 && <button type="button" className="surprise-map-fit" onClick={() => runtime.current?.fit()}>查看全部信件范围</button>}
  </section>;
}
