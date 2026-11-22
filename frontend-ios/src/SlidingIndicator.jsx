import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Decorative active-item backing. The host container must be position:relative.
 * `activeRef` points at the real active button; aria-current/aria-selected stays
 * on that button and remains the semantic source of truth.
 */
export default function SlidingIndicator({
  containerRef,
  activeRef,
  activeKey = "",
  revision = "",
  className = "",
}) {
  const indicatorRef = useRef(null);
  const placedRef = useRef(false);
  const frameRef = useRef(0);
  const lastRef = useRef("");
  const raf = globalThis.requestAnimationFrame || ((callback) => globalThis.setTimeout(callback, 16));
  const caf = globalThis.cancelAnimationFrame || globalThis.clearTimeout;

  const measure = useCallback(() => {
    const indicator = indicatorRef.current;
    const container = containerRef?.current;
    const target = activeRef?.current;
    if (!indicator || !container || !target) {
      if (indicator) indicator.style.opacity = "0";
      return;
    }
    if (
      typeof container.getBoundingClientRect !== "function" ||
      typeof target.getBoundingClientRect !== "function" ||
      !indicator.style
    ) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (
      targetRect.width < 1 ||
      targetRect.height < 1 ||
      containerRect.width < 1 ||
      containerRect.height < 1
    ) {
      indicator.style.opacity = "0";
      return;
    }
    const x = targetRect.left - containerRect.left + container.scrollLeft;
    const y = targetRect.top - containerRect.top + container.scrollTop;
    const next = `${x}|${y}|${targetRect.width}|${targetRect.height}`;
    const changed = next !== lastRef.current;
    lastRef.current = next;
    indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    indicator.style.width = `${targetRect.width}px`;
    indicator.style.height = `${targetRect.height}px`;
    indicator.style.opacity = "1";
    if (!placedRef.current) {
      placedRef.current = true;
      indicator.style.transition = "none";
      raf(() => {
        if (indicatorRef.current === indicator) indicator.style.transition = "";
      });
    }
    return changed;
  }, [activeRef, containerRef]);

  const scheduleMeasure = useCallback(() => {
    caf(frameRef.current);
    frameRef.current = raf(measure);
  }, [measure]);

  useLayoutEffect(() => {
    scheduleMeasure();
  }, [activeKey, revision, scheduleMeasure]);

  useEffect(() => {
    placedRef.current = false;
    lastRef.current = "";
    scheduleMeasure();
    const container = containerRef?.current;
    const target = activeRef?.current;
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(scheduleMeasure) : null;
    if (container) observer?.observe(container);
    if (target) observer?.observe(target);
    const mutation =
      typeof MutationObserver === "function" && container
        ? new MutationObserver(scheduleMeasure)
        : null;
    mutation?.observe(container, { attributes: true, childList: true, subtree: true });
    globalThis.window?.addEventListener?.("resize", scheduleMeasure, { passive: true });
    container?.addEventListener("scroll", scheduleMeasure, { passive: true });
    globalThis.document?.fonts?.ready?.then?.(scheduleMeasure).catch?.(() => {});
    return () => {
      caf(frameRef.current);
      observer?.disconnect();
      mutation?.disconnect();
      globalThis.window?.removeEventListener?.("resize", scheduleMeasure);
      container?.removeEventListener("scroll", scheduleMeasure);
    };
  }, [activeRef, containerRef, scheduleMeasure, activeKey]);

  return (
    <span
      ref={indicatorRef}
      className={`sliding-indicator${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    />
  );
}

