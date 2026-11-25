import { useEffect, useRef, useState } from "react";
import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  FloatingDelayGroup,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import "./smart-tooltip.css";

export function SmartTooltipProvider({ children, delay = { open: 180, close: 90 } }) {
  return <FloatingDelayGroup delay={delay}>{children}</FloatingDelayGroup>;
}

export function SmartTooltip({
  label,
  description = "",
  shortcut = "",
  status = "",
  placement = "top",
  children,
}) {
  const [open, setOpen] = useState(false);
  const [arrowEl, setArrowEl] = useState(null);
  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    strategy: "fixed",
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 }), arrow({ element: arrowEl })],
  });
  const hover = useHover(floating.context, { move: false, delay: { open: 180, close: 60 } });
  const focus = useFocus(floating.context);
  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  // eslint-disable-next-line react-hooks/refs -- Floating UI exposes callback ref setters on floating.refs
  const { setReference, setFloating } = floating.refs;

  return (
    <>
      <span ref={setReference} className="dt-tip-anchor" {...getReferenceProps()}>
        {children}
      </span>
      {open && label ? (
        <FloatingPortal>
          <div
            ref={setFloating}
            className="dt-smart-tooltip"
            style={floating.floatingStyles}
            {...getFloatingProps()}
          >
            <FloatingArrow ref={setArrowEl} context={floating.context} className="dt-smart-tooltip-arrow" width={10} height={5} />
            <div className="dt-smart-tooltip-head">
              <strong>{label}</strong>
              {shortcut ? <kbd>{shortcut}</kbd> : null}
              {status ? <span className="dt-smart-tooltip-status">{status}</span> : null}
            </div>
            {description ? <p>{description}</p> : null}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export function SmartHoverCard({
  trigger,
  content,
  placement = "top",
  openDelay = 200,
  closeDelay = 140,
}) {
  const [open, setOpen] = useState(false);
  const [arrowEl, setArrowEl] = useState(null);
  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    strategy: "fixed",
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(12), flip({ padding: 12 }), shift({ padding: 12 }), arrow({ element: arrowEl })],
  });
  const hover = useHover(floating.context, {
    delay: { open: openDelay, close: closeDelay },
    handleClose: safePolygon({ buffer: 4 }),
  });
  const focus = useFocus(floating.context);
  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  // eslint-disable-next-line react-hooks/refs -- Floating UI exposes callback ref setters on floating.refs
  const { setReference, setFloating } = floating.refs;

  return (
    <>
      <span ref={setReference} className="dt-hover-card-anchor" {...getReferenceProps()}>
        {trigger}
      </span>
      {open ? (
        <FloatingPortal>
          <div
            ref={setFloating}
            className="dt-smart-hover-card"
            style={floating.floatingStyles}
            {...getFloatingProps()}
          >
            <FloatingArrow ref={setArrowEl} context={floating.context} className="dt-smart-hover-arrow" width={12} height={6} />
            {content}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

/**
 * Global declarative hover layer powered by Floating UI.
 * Any button / interactive control across the entire DengTa app with
 * `data-dt-tip` (or `button[aria-label]` / `[data-feature-item]` on desktop fine pointers)
 * automatically shows an instant, viewport-aware floating glass popup on hover/focus!
 */
export function GlobalHoverTooltipLayer() {
  const [active, setActive] = useState(null);
  const [arrowEl, setArrowEl] = useState(null);
  const openTimerRef = useRef(0);
  const closeTimerRef = useRef(0);

  const floating = useFloating({
    open: Boolean(active),
    strategy: "fixed",
    placement: active?.placement || "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 }), arrow({ element: arrowEl })],
  });
  // eslint-disable-next-line react-hooks/refs -- Floating UI exposes callback ref setters on floating.refs
  const { setReference, setFloating } = floating.refs;

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches !== false;
    if (!finePointer) return undefined;

    function resolveTarget(node) {
      if (!(node instanceof Element)) return null;
      const explicit = node.closest("[data-dt-tip]");
      if (explicit) {
        return {
          el: explicit,
          title: explicit.getAttribute("data-dt-tip-title") || "",
          text: explicit.getAttribute("data-dt-tip") || "",
          shortcut: explicit.getAttribute("data-dt-tip-key") || "",
          status: explicit.getAttribute("data-dt-tip-status") || "",
          placement: explicit.getAttribute("data-dt-tip-place") || "top",
        };
      }
      const btn = node.closest("button[aria-label], a[data-dt-tip], [role='button'][aria-label]");
      if (!btn || btn.disabled) return null;
      const aria = String(btn.getAttribute("aria-label") || "").trim();
      const visibleText = String(btn.textContent || "").replace(/\s+/g, " ").trim();
      if (!aria || aria === visibleText) return null;
      return {
        el: btn,
        title: aria.slice(0, 64),
        text: btn.getAttribute("title") && btn.getAttribute("title") !== aria ? btn.getAttribute("title") : "",
        shortcut: btn.classList.contains("mobile-command-dock") ? "⌘K" : "",
        status: "",
        placement: "top",
      };
    }

    const clearTimers = () => {
      window.clearTimeout(openTimerRef.current);
      window.clearTimeout(closeTimerRef.current);
    };

    const showFor = (info, immediate = false) => {
      clearTimers();
      if (!info || (!info.title && !info.text)) {
        setActive(null);
        return;
      }
      const commit = () => {
        setReference(info.el);
        setActive(info);
      };
      if (immediate) commit();
      else openTimerRef.current = window.setTimeout(commit, 160);
    };

    const onPointerOver = (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const info = resolveTarget(event.target);
      if (!info) return;
      showFor(info, Boolean(active));
    };

    const onPointerOut = (event) => {
      const leaving = resolveTarget(event.target);
      if (!leaving) return;
      const entering = resolveTarget(event.relatedTarget);
      if (entering && entering.el === leaving.el) return;
      clearTimers();
      closeTimerRef.current = window.setTimeout(() => setActive(null), 90);
    };

    const onFocusIn = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(":focus-visible")) return;
      const info = resolveTarget(target);
      if (info) showFor(info, true);
    };

    const onHide = () => {
      clearTimers();
      setActive(null);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") onHide();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onHide, true);
    document.addEventListener("pointerdown", onHide, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onHide, true);

    return () => {
      clearTimers();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onHide, true);
      document.removeEventListener("pointerdown", onHide, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onHide, true);
    };
  }, [active, setReference]);

  if (!active) return null;

  return (
    <FloatingPortal>
      <div
        ref={setFloating}
        className="dt-smart-tooltip dt-smart-tooltip-global"
        role="tooltip"
        style={floating.floatingStyles}
      >
        <FloatingArrow ref={setArrowEl} context={floating.context} className="dt-smart-tooltip-arrow" width={10} height={5} />
        <div className="dt-smart-tooltip-head">
          <strong>{active.title || active.text}</strong>
          {active.shortcut ? <kbd>{active.shortcut}</kbd> : null}
          {active.status ? <span className="dt-smart-tooltip-status">{active.status}</span> : null}
        </div>
        {active.title && active.text ? <p>{active.text}</p> : null}
      </div>
    </FloatingPortal>
  );
}
