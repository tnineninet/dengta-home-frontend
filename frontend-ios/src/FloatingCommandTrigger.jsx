import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import "./floating-command-trigger.css";

const SIZE = 48;
const EDGE_MARGIN = 10;
const EDGE_SNAP = 26;
const HIDDEN = 24;
const DRAG_THRESHOLD = 5;
const STORAGE_KEY = "dengta.command-dock.v1";

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function viewportBounds() {
  return {
    width: Math.max(320, window.innerWidth || 320),
    height: Math.max(320, window.innerHeight || 320),
  };
}

function expandedPosition(edge, x, y, width, height) {
  const maxX = width - SIZE - EDGE_MARGIN;
  const maxY = height - SIZE - EDGE_MARGIN;
  if (edge === "left") return { x: EDGE_MARGIN, y: clamp(y, EDGE_MARGIN, maxY) };
  if (edge === "right") return { x: maxX, y: clamp(y, EDGE_MARGIN, maxY) };
  if (edge === "top") return { x: clamp(x, EDGE_MARGIN, maxX), y: EDGE_MARGIN };
  if (edge === "bottom") return { x: clamp(x, EDGE_MARGIN, maxX), y: maxY };
  return { x: clamp(x, EDGE_MARGIN, maxX), y: clamp(y, EDGE_MARGIN, maxY) };
}

function collapsedPosition(edge, x, y, width, height) {
  const expanded = expandedPosition(edge, x, y, width, height);
  if (edge === "left") return { x: -HIDDEN, y: expanded.y, edge };
  if (edge === "right") return { x: width - SIZE + HIDDEN, y: expanded.y, edge };
  if (edge === "top") return { x: expanded.x, y: -HIDDEN, edge };
  if (edge === "bottom") return { x: expanded.x, y: height - SIZE + HIDDEN, edge };
  return { ...expanded, edge: "" };
}

function detectEdge(x, y, width, height) {
  const distances = {
    left: x,
    right: width - SIZE - x,
    top: y,
    bottom: height - SIZE - y,
  };
  let edge = "";
  let nearest = EDGE_SNAP;
  for (const [name, distance] of Object.entries(distances)) {
    if (distance < nearest) {
      nearest = distance;
      edge = name;
    }
  }
  return edge;
}

function readStoredPosition() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return {
      x: parsed.x,
      y: parsed.y,
      collapsed: parsed.collapsed === true,
      edge: typeof parsed.edge === "string" ? parsed.edge : "",
    };
  } catch {
    return null;
  }
}

function savePosition(position) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // A blocked localStorage must not stop the dock from moving.
  }
}

function initialDockState() {
  if (typeof window === "undefined") return { x: 0, y: 0, collapsed: false, edge: "" };
  const { width, height } = viewportBounds();
  const stored = readStoredPosition();
  if (stored) {
    if (stored.collapsed && stored.edge) {
      return { ...collapsedPosition(stored.edge, stored.x, stored.y, width, height), collapsed: true };
    }
    const restored = expandedPosition("", stored.x, stored.y, width, height);
    return { ...restored, y: Math.max(220, restored.y), collapsed: false, edge: "" };
  }
  return {
    x: width - SIZE - EDGE_MARGIN,
    y: Math.min(height - 110, Math.max(220, height * 0.52)),
    collapsed: false,
    edge: "",
  };
}

const FloatingCommandTrigger = forwardRef(function FloatingCommandTrigger({ open = false, onOpen }, forwardedRef) {
  const buttonRef = useRef(null);
  const initialRef = useRef(null);
  if (initialRef.current === null) initialRef.current = initialDockState();
  const initial = initialRef.current;
  const positionRef = useRef({ x: initial.x, y: initial.y });
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [position, setPosition] = useState({ x: initial.x, y: initial.y });
  const [collapsed, setCollapsed] = useState(initial.collapsed);
  const [edge, setEdge] = useState(initial.edge);
  const [ready, setReady] = useState(false);

  useImperativeHandle(forwardedRef, () => buttonRef.current, []);

  const applyTransform = (node, x, y) => {
    if (node) node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const commitPosition = (next) => {
    positionRef.current = { x: next.x, y: next.y };
    setPosition({ x: next.x, y: next.y });
    setCollapsed(next.collapsed === true);
    setEdge(next.edge || "");
    applyTransform(buttonRef.current, next.x, next.y);
    savePosition(next);
  };

  const settle = (x, y) => {
    const { width, height } = viewportBounds();
    const edgeName = detectEdge(x, y, width, height);
    if (edgeName) {
      commitPosition({ ...collapsedPosition(edgeName, x, y, width, height), collapsed: true });
      return;
    }
    commitPosition({ ...expandedPosition("", x, y, width, height), collapsed: false, edge: "" });
  };

  const expandFromEdge = () => {
    const { width, height } = viewportBounds();
    const current = positionRef.current;
    const next = expandedPosition(edge, current.x, current.y, width, height);
    commitPosition({ ...next, collapsed: false, edge: "" });
  };

  useEffect(() => {
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      applyTransform(buttonRef.current, positionRef.current.x, positionRef.current.y);
      secondFrame = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (dragRef.current) return;
      const { width, height } = viewportBounds();
      const current = positionRef.current;
      if (collapsed && edge) {
        commitPosition({ ...collapsedPosition(edge, current.x, current.y, width, height), collapsed: true });
      } else {
        commitPosition({ ...expandedPosition("", current.x, current.y, width, height), collapsed: false, edge: "" });
      }
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [collapsed, edge]);

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.isPrimary === false) return;
    const node = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: positionRef.current.x,
      originY: positionRef.current.y,
      moved: false,
    };
    node.setPointerCapture?.(event.pointerId);
    node.classList.add("is-pressed");
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const node = event.currentTarget;
    node.classList.add("is-dragging");
    const { width, height } = viewportBounds();
    const x = clamp(drag.originX + dx, -HIDDEN, width - SIZE + HIDDEN);
    const y = clamp(drag.originY + dy, -HIDDEN, height - SIZE + HIDDEN);
    positionRef.current = { x, y };
    applyTransform(node, x, y);
    event.preventDefault();
  };

  const finishPointer = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.classList.remove("is-dragging", "is-pressed");
    if (!drag.moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 360);
    settle(positionRef.current.x, positionRef.current.y);
  };

  const onPointerCancel = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.classList.remove("is-dragging", "is-pressed");
    settle(positionRef.current.x, positionRef.current.y);
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (collapsed) {
      expandFromEdge();
      return;
    }
    onOpen?.();
  };

  const style = {
    "--dock-size": `${SIZE}px`,
    transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={[
        "mobile-command-dock",
        ready ? "is-ready" : "",
        collapsed ? "is-collapsed" : "",
        open ? "is-palette-open" : "",
      ].filter(Boolean).join(" ")}
      data-edge={collapsed ? edge : ""}
      style={style}
      aria-label={collapsed ? "展开命令面板按钮" : "打开命令面板"}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={collapsed ? "点一下展开命令按钮" : "命令面板"}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={onPointerCancel}
    >
      <span className="mobile-command-dock-halo" aria-hidden="true" />
      <span className="mobile-command-dock-content">
        <span className="mobile-command-dock-key" aria-hidden="true">⌘K</span>
        <span className="mobile-command-dock-grip" aria-hidden="true"><i /><i /><i /></span>
      </span>
    </button>
  );
});

export default FloatingCommandTrigger;
