import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CircleDot,
  Compass,
  Droplets,
  Heart,
  Home,
  MessageCircle,
  Moon,
  Music,
  Palette,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Sun,
  Timer,
  Utensils,
  X,
} from 'lucide-react';
import { petLocalStorage, petStorageKey, readPetState, savePetState } from './cotton/pet-state.js';
import { EXPRESSION_LABELS } from './cotton/expressions.js';
import { createGyroController, isGyroSupported } from './cotton/gyro-controller.js';
import './cotton-desktop-pet.css';

const POS_STORAGE_PREFIX = 'dengta:cotton-desktop-pet:v1:';
const EXPRESSION_CYCLE = ['auto', 'Happy', 'Excited', 'Surprised', 'Sleepy'];
const TAP_INTERACTIONS = [
  { id: 'pet', line: '汪呜～被摸头最舒服啦，耳朵都在晃呢！' },
  { id: 'nod', line: '小棉花收到啦！摇尾巴陪着你～' },
  { id: 'paw', line: '伸出小左爪和你击个掌！' },
  { id: 'greet', line: '贴贴！今天也要开心呀～' },
  { id: 'pawRight', line: '再伸小右爪！你今天超棒的！' },
];

const ACTION_BUBBLES = {
  pet: '汪呜～软乎乎地蹭蹭你！',
  dance: '开启音乐律动舞步！闪光粒子全开 ✨',
  feed: '咔哧咔哧～饭碗里的骨头饼干好香呀！',
  drink: '咕嘟咕嘟喝口水，凉凉的好解渴！',
  brush: '梳毛好舒服，蓬松博美变身～',
  ball: '追小球！快拖起小球甩出去给我接！',
  paw: '举起小左爪打招呼～',
  pawRight: '举起小右爪握手！',
  greet: '小棉花一直在你屏幕边陪着你哦～',
  nod: '嗯嗯！听你的！',
  rest: '趴在边缘打个小盹…随时点我醒来',
};

function readDesktopPrefs(scope) {
  const storage = petLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${POS_STORAGE_PREFIX}${scope || 'default'}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDesktopPrefs(scope, patch) {
  const storage = petLocalStorage();
  if (!storage) return;
  try {
    const prev = readDesktopPrefs(scope) || {};
    storage.setItem(`${POS_STORAGE_PREFIX}${scope || 'default'}`, JSON.stringify({ ...prev, ...patch }));
  } catch {
    // Ignore storage quota errors
  }
}

function clampPosition(x, y, size) {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - size - pad);
  const maxY = Math.max(pad, window.innerHeight - size - 78);
  return {
    x: Math.round(Math.max(pad, Math.min(maxX, x))),
    y: Math.round(Math.max(pad, Math.min(maxY, y))),
  };
}

function defaultCornerPosition(size) {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  return clampPosition(window.innerWidth - size - 20, window.innerHeight - size - 138, size);
}

function formatCountdown(secondsLeft) {
  const safe = Math.max(0, Math.floor(secondsLeft));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function CottonDesktopPet({
  accountScope = '',
  companionScope = '',
  enabled = false,
  suppressed = false,
  hideLauncher = false,
  onSetEnabled,
  onOpenHouse,
  onShareToChat,
}) {
  const storageKey = petStorageKey(accountScope, companionScope);
  const prefScope = storageKey || 'guest';
  const savedPrefs = readDesktopPrefs(prefScope);
  const [scale, setScale] = useState(() =>
    Number.isFinite(savedPrefs?.scale) ? Math.max(0.72, Math.min(1.45, savedPrefs.scale)) : 0.94,
  );
  const stageSize = Math.round(204 * scale);

  // Use GPU transform (translate3d) via ref so dragging & gyro roaming are 100% 60fps zero-stutter!
  const initialPos =
    Number.isFinite(savedPrefs?.x) && Number.isFinite(savedPrefs?.y)
      ? clampPosition(savedPrefs.x, savedPrefs.y, stageSize)
      : defaultCornerPosition(stageSize);
  const posRef = useRef(initialPos);
  const [status, setStatus] = useState('idle');
  const [actionLabel, setActionLabel] = useState('博美桌宠陪伴中');
  const [style, setStyle] = useState(() => ({
    toon: savedPrefs?.toon !== false,
    outline: savedPrefs?.outline !== false,
    night: savedPrefs?.night === true,
    bigHead: savedPrefs?.bigHead === true,
    skeleton: false,
  }));
  const [expression, setExpression] = useState('auto');
  const [menuOpen, setMenuOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [gyroEnabled, setGyroEnabled] = useState(false);
  const [bubble, setBubble] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pomodoroSec, setPomodoroSec] = useState(0);
  const [stats, setStats] = useState(() => readPetState(petLocalStorage(), storageKey).stats || {});

  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const wrapRef = useRef(null);
  const stageElRef = useRef(null);
  const tapIndexRef = useRef(0);
  const bubbleTimerRef = useRef(0);
  const dragRef = useRef(null);
  const styleRef = useRef(style);
  const gyroRef = useRef(null);
  const gyroTiltRef = useRef({ x: 0, z: 0 });
  const latestVisitRef = useRef(readPetState(petLocalStorage(), storageKey));

  const applyWidgetTransform = useCallback((x, y) => {
    posRef.current = { x, y };
    if (wrapRef.current) {
      wrapRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }
  }, []);

  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  const showBubble = useCallback((text, ms = 3200) => {
    setBubble(text);
    window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => setBubble(''), ms);
  }, []);

  const active = Boolean(enabled) && !suppressed;

  // Apply initial GPU transform before first paint whenever active or stageSize changes
  useLayoutEffect(() => {
    if (!active) return;
    const clamped = clampPosition(posRef.current.x, posRef.current.y, stageSize);
    applyWidgetTransform(clamped.x, clamped.y);
  }, [active, stageSize, applyWidgetTransform]);

  // Mount & dispose Three.js Pomeranian runtime cleanly when active
  useEffect(() => {
    if (!active) return undefined;
    const abort = new AbortController();
    const visit = latestVisitRef.current;
    let instance = null;
    const loadingTimer = window.setTimeout(() => {
      if (!abort.signal.aborted) setStatus('loading');
    }, 0);

    import('./cotton/pet-runtime.js')
      .then(({ createPetRuntime }) => {
        if (abort.signal.aborted || !canvasRef.current) return null;
        return createPetRuntime(canvasRef.current, {
          signal: abort.signal,
          initial: visit,
          onChange(value) {
            if (abort.signal.aborted) return;
            visit.stats = value.stats;
            setStats(value.stats);
            savePetState(petLocalStorage(), storageKey, value.stats, visit.quiet);
          },
          onError() {
            if (!abort.signal.aborted) setStatus('error');
          },
        });
      })
      .then((value) => {
        if (!value) return;
        instance = value;
        if (abort.signal.aborted) {
          instance.dispose();
          return;
        }
        runtimeRef.current = instance;
        instance.setVisualStyle?.(styleRef.current);
        setStatus('ready');
        showBubble('汪！拖我身体任意部位拎着玩、甩小球或开陀螺仪让我满屏跑吧～', 4200);
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus('error');
      });

    return () => {
      window.clearTimeout(loadingTimer);
      window.clearTimeout(bubbleTimerRef.current);
      abort.abort();
      if (instance) {
        savePetState(petLocalStorage(), storageKey, instance.snapshot().stats, visit.quiet);
        instance.dispose();
      }
      runtimeRef.current = null;
    };
  }, [active, storageKey, showBubble]);

  // Gyroscope roaming across the screen + rolling 3D ball (zero React re-renders!)
  useEffect(() => {
    if (!active || !gyroEnabled) {
      gyroRef.current?.stop();
      gyroRef.current = null;
      gyroTiltRef.current = { x: 0, z: 0 };
      runtimeRef.current?.setGyroTilt?.(0, 0);
      return undefined;
    }

    const ctrl = createGyroController({
      onTilt: ({ x, z }) => {
        gyroTiltRef.current = { x, z };
        runtimeRef.current?.setGyroTilt?.(x, z);
      },
      onShake: (imp) => {
        runtimeRef.current?.applyShake?.(imp);
        showBubble('哇哦！晃得好开心，接球！', 2200);
      },
    });
    gyroRef.current = ctrl;
    void ctrl.start().then((res) => {
      if (!res.ok) {
        setGyroEnabled(false);
        showBubble(res.reason || '当前设备无法开启陀螺仪', 2600);
      }
    });

    let rafId = 0;
    let lastTs = 0;
    let vx = 0;
    let vy = 0;
    const step = (ts) => {
      rafId = window.requestAnimationFrame(step);
      if (dragRef.current) {
        lastTs = ts;
        return;
      }
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
      lastTs = ts;
      const { x: tx, z: tz } = gyroTiltRef.current;
      if (Math.hypot(tx, tz) > 0.08) {
        vx = vx * 0.88 + tx * 240 * 0.12;
        vy = vy * 0.88 + tz * 220 * 0.12;
      } else {
        vx *= Math.exp(-6 * dt);
        vy *= Math.exp(-6 * dt);
      }
      if (Math.hypot(vx, vy) > 4) {
        const pad = 8;
        const maxX = Math.max(pad, window.innerWidth - stageSize - pad);
        const maxY = Math.max(pad, window.innerHeight - stageSize - 78);
        let nx = posRef.current.x + vx * dt;
        let ny = posRef.current.y + vy * dt;
        if (nx <= pad || nx >= maxX) {
          nx = Math.max(pad, Math.min(maxX, nx));
          vx *= -0.55;
        }
        if (ny <= pad || ny >= maxY) {
          ny = Math.max(pad, Math.min(maxY, ny));
          vy *= -0.55;
        }
        applyWidgetTransform(nx, ny);
      }
    };
    rafId = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(rafId);
      ctrl.stop();
      gyroRef.current = null;
      runtimeRef.current?.setGyroTilt?.(0, 0);
    };
  }, [active, gyroEnabled, stageSize, applyWidgetTransform, showBubble]);

  // Global silky 60fps drag + ball throw + gaze tracking
  useEffect(() => {
    if (!active) return undefined;

    function getStageNdc(clientX, clientY) {
      const rect = stageElRef.current?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return { nx: 0, ny: 0 };
      return {
        nx: ((clientX - rect.left) / rect.width) * 2 - 1,
        ny: ((clientY - rect.top) / rect.height) * 2 - 1,
      };
    }

    function onWindowPointerMove(event) {
      const drag = dragRef.current;
      if (drag) {
        const now = performance.now();
        const dtSec = Math.max(0.008, (now - drag.lastTime) / 1000);
        const stepDx = event.clientX - drag.lastX;
        const stepDy = event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        drag.lastTime = now;

        if (drag.mode === 'ball') {
          const { nx, ny } = getStageNdc(event.clientX, event.clientY);
          runtimeRef.current?.dragBall?.(nx, ny);
          return;
        }

        const totalDx = event.clientX - drag.startX;
        const totalDy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(totalDx, totalDy) > 5) {
          drag.moved = true;
          setDragging(true);
          setMenuOpen(false);
          setStyleOpen(false);
        }
        if (drag.moved) {
          const next = clampPosition(drag.origX + totalDx, drag.origY + totalDy, stageSize);
          applyWidgetTransform(next.x, next.y);
          const vx = (stepDx / dtSec) / 260;
          const vy = (stepDy / dtSec) / 260;
          runtimeRef.current?.setBodyDrag?.({ active: true, zone: drag.zone, vx, vy });
        }
        return;
      }

      if (!wrapRef.current || !runtimeRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.45;
      const nx = Math.max(-1, Math.min(1, (event.clientX - cx) / 360));
      const ny = Math.max(-1, Math.min(1, (event.clientY - cy) / 280));
      runtimeRef.current.setGaze?.(nx, ny, true);
    }

    function onWindowPointerUp() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;

      if (drag.mode === 'ball') {
        runtimeRef.current?.releaseBall?.();
        setActionLabel('追球中');
        showBubble('嗖——我来接球啦！', 2200);
        return;
      }

      runtimeRef.current?.setBodyDrag?.({ active: false });
      if (drag.moved) {
        setDragging(false);
        const cur = posRef.current;
        const snapped = { ...cur };
        const rightDist = window.innerWidth - (cur.x + stageSize);
        if (cur.x < 24) snapped.x = 8;
        else if (rightDist < 24) snapped.x = Math.max(8, window.innerWidth - stageSize - 10);
        applyWidgetTransform(snapped.x, snapped.y);
        saveDesktopPrefs(prefScope, { x: snapped.x, y: snapped.y });
        showBubble(
          drag.zone === 'head'
            ? '呀！被拎着脑袋兜了一圈，耳朵都晃晕啦～'
            : drag.zone === 'paw'
              ? '牵着我的小爪子飞起来啦！'
              : '软乎乎落地～贴着你好舒服！',
          2200,
        );
      } else {
        const nextTap = TAP_INTERACTIONS[tapIndexRef.current % TAP_INTERACTIONS.length];
        tapIndexRef.current += 1;
        const result = runtimeRef.current?.command?.(nextTap.id);
        if (result?.accepted) {
          setActionLabel(nextTap.id === 'pet' ? '摸摸头中' : '开心互动');
          showBubble(nextTap.line, 2600);
        }
      }
    }

    function onResize() {
      const clamped = clampPosition(posRef.current.x, posRef.current.y, stageSize);
      applyWidgetTransform(clamped.x, clamped.y);
    }

    window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
      window.removeEventListener('resize', onResize);
    };
  }, [active, prefScope, stageSize, applyWidgetTransform, showBubble]);

  // Pomodoro focus timer
  useEffect(() => {
    if (pomodoroSec <= 0) return undefined;
    const id = window.setInterval(() => {
      setPomodoroSec((prev) => {
        if (prev <= 1) {
          runtimeRef.current?.command?.('dance');
          showBubble('25 分钟专注完成！小棉花跳支舞庆祝一下 ✨', 5200);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [pomodoroSec, showBubble]);

  function runAction(actionId, label) {
    setMenuOpen(false);
    setStyleOpen(false);
    const res = runtimeRef.current?.command?.(actionId);
    if (res?.accepted) {
      setActionLabel(label || actionId);
      showBubble(ACTION_BUBBLES[actionId] || '汪呜～', 3200);
    } else if (res?.reason) {
      showBubble(res.reason, 2200);
    }
  }

  function toggleStyle(key, label) {
    setStyle((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      runtimeRef.current?.setVisualStyle?.(next);
      saveDesktopPrefs(prefScope, { [key]: next[key] });
      showBubble(`${label}${next[key] ? '已开启' : '已关闭'}`, 2200);
      return next;
    });
  }

  function cycleExpression() {
    const idx = EXPRESSION_CYCLE.indexOf(expression);
    const next = EXPRESSION_CYCLE[(idx + 1) % EXPRESSION_CYCLE.length];
    setExpression(next);
    runtimeRef.current?.setExpression?.(next);
    showBubble(`表情：${EXPRESSION_LABELS[next] || next}`, 2200);
  }

  function toggleGyro() {
    if (!isGyroSupported()) {
      showBubble('当前电脑或浏览器不支持陀螺仪，手机上可随倾斜满屏跑哦！', 2800);
      return;
    }
    setGyroEnabled((prev) => {
      const next = !prev;
      showBubble(next ? '🧭 陀螺仪已开！倾斜手机就能让小棉花和小球满屏跑～' : '已关闭陀螺仪，小棉花安静待在这里', 2800);
      return next;
    });
  }

  function togglePomodoro() {
    setStyleOpen(false);
    if (pomodoroSec > 0) {
      setPomodoroSec(0);
      showBubble('已结束番茄钟，随时再喊我一起专注～', 2200);
    } else {
      setPomodoroSec(25 * 60);
      runtimeRef.current?.command?.('nod');
      showBubble('25 分钟番茄钟开始！小棉花在角落陪你专注 ⏱', 3000);
    }
  }

  function handleStagePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button, a')) return;
    event.preventDefault();
    const rect = stageElRef.current?.getBoundingClientRect();
    let nx = 0;
    let ny = 0;
    if (rect && rect.width && rect.height) {
      nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    }
    const picked = runtimeRef.current?.pickTarget?.(nx, ny);
    if (picked?.hit === 'ball') {
      runtimeRef.current?.grabBall?.(nx, ny);
      dragRef.current = {
        mode: 'ball',
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        moved: true,
      };
      return;
    }
    const fallbackZone = ny < -0.15 ? 'head' : ny > 0.35 ? 'paw' : 'body';
    const zone = picked?.hit === 'pet' ? picked.zone : fallbackZone;
    dragRef.current = {
      mode: 'pet',
      zone,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      origX: posRef.current.x,
      origY: posRef.current.y,
      moved: false,
    };
  }

  function handleStageWheel(event) {
    event.preventDefault();
    setScale((prev) => {
      const next = Math.max(0.72, Math.min(1.45, Number((prev - Math.sign(event.deltaY) * 0.08).toFixed(2))));
      saveDesktopPrefs(prefScope, { scale: next });
      return next;
    });
  }

  if (suppressed) return null;

  if (!enabled) {
    if (hideLauncher) return null;
    return (
      <div className="cotton-float-launcher-wrap">
        <button
          type="button"
          className="cotton-float-launcher"
          onClick={() => onSetEnabled?.(true)}
          title="召唤 3D 博美犬小棉花悬浮桌宠"
        >
          <span className="cotton-paw-dot" aria-hidden="true">🐾</span>
          <span>召唤小棉花桌宠</span>
        </button>
      </div>
    );
  }

  return (
    <div className="cotton-desktop-pet-layer" aria-label="博美犬小棉花悬浮桌宠">
      <div
        ref={wrapRef}
        className={`cotton-desktop-pet-widget${dragging ? ' is-dragging' : ''}${style.night ? ' is-night' : ''}${menuOpen ? ' is-menu-open' : ''}`}
        style={{
          left: '0px',
          top: '0px',
          width: `${stageSize}px`,
        }}
      >
        {pomodoroSec > 0 && (
          <button
            type="button"
            className="cotton-pomo-pill"
            onClick={togglePomodoro}
            title="点击停止番茄钟"
          >
            <Timer size={12} aria-hidden="true" />
            <span>{formatCountdown(pomodoroSec)}</span>
          </button>
        )}

        {bubble && (
          <div className="cotton-desktop-bubble" role="status">
            {bubble}
          </div>
        )}

        <div
          ref={stageElRef}
          className="cotton-desktop-stage"
          style={{ width: `${stageSize}px`, height: `${stageSize}px` }}
          onPointerDown={handleStagePointerDown}
          onWheel={handleStageWheel}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen((prev) => !prev);
          }}
          title="按住身体任意部位丝滑拎走 · 拖住小球甩飞 · 单击摸摸头"
        >
          <canvas ref={canvasRef} aria-label="3D 博美犬小棉花桌宠画布" />
          {status === 'loading' && <span className="cotton-desktop-status">小棉花跑来中…</span>}
          {status === 'error' && <span className="cotton-desktop-status is-err">3D 渲染暂不可用</span>}
          {status === 'ready' && (
            <span className="cotton-desktop-mood-tag">
              {actionLabel} · {Math.round(stats.mood ?? 80)}
            </span>
          )}
          <button
            type="button"
            className={`cotton-desktop-menu-trigger${menuOpen ? ' is-open' : ''}`}
            aria-label={menuOpen ? '收起桌宠菜单' : '打开桌宠快捷菜单'}
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((prev) => !prev);
              if (menuOpen) setStyleOpen(false);
            }}
          >
            {menuOpen ? <X size={13} aria-hidden="true" /> : <SlidersHorizontal size={13} aria-hidden="true" />}
          </button>
        </div>

        {menuOpen && (
          <div className="cotton-desktop-dock" role="toolbar" aria-label="小棉花快捷互动栏">
            <button type="button" onClick={() => runAction('pet', '摸摸头')} title="摸摸头">
              <Heart size={15} aria-hidden="true" />
              <span>摸头</span>
            </button>
            <button type="button" onClick={() => runAction('feed', '吃零食')} title="端饭碗喂食">
              <Utensils size={15} aria-hidden="true" />
              <span>喂食</span>
            </button>
            <button type="button" onClick={() => runAction('drink', '喝水水')} title="端水碗喝水">
              <Droplets size={15} aria-hidden="true" />
              <span>喝水</span>
            </button>
            <button type="button" onClick={() => runAction('ball', '逗球玩')} title="抛球玩耍">
              <CircleDot size={15} aria-hidden="true" />
              <span>逗球</span>
            </button>
            <button type="button" onClick={() => runAction('brush', '梳梳毛')} title="梳梳毛">
              <Sparkles size={15} aria-hidden="true" />
              <span>梳毛</span>
            </button>
            <button type="button" onClick={() => runAction('dance', '起舞')} title="开心跳舞">
              <Music size={15} aria-hidden="true" />
              <span>跳舞</span>
            </button>
            <button
              type="button"
              className={gyroEnabled ? 'is-active' : ''}
              onClick={toggleGyro}
              title="开启手机陀螺仪，倾斜手机让小棉花与小球满屏跑动"
            >
              <Compass size={15} aria-hidden="true" />
              <span>陀螺</span>
            </button>
            <button
              type="button"
              className={styleOpen ? 'is-active' : ''}
              onClick={() => setStyleOpen((prev) => !prev)}
              title="外观、表情与番茄钟"
            >
              <Palette size={15} aria-hidden="true" />
              <span>更多</span>
            </button>
          </div>
        )}

        {menuOpen && styleOpen && (
          <div className="cotton-desktop-subdock" role="group" aria-label="外观与更多功能">
            <button type="button" className={style.toon ? 'is-active' : ''} onClick={() => toggleStyle('toon', '卡通渲染')}>
              卡通
            </button>
            <button type="button" className={style.bigHead ? 'is-active' : ''} onClick={() => toggleStyle('bigHead', '大头萌态')}>
              大头
            </button>
            <button type="button" className={style.night ? 'is-active' : ''} onClick={() => toggleStyle('night', '夜间柔光')}>
              {style.night ? <Sun size={12} /> : <Moon size={12} />}
            </button>
            <button type="button" onClick={cycleExpression} title="切换表情">
              <Smile size={12} /> {EXPRESSION_LABELS[expression] || '表情'}
            </button>
            <button type="button" className={pomodoroSec > 0 ? 'is-active' : ''} onClick={togglePomodoro} title="25分钟专注">
              <Timer size={12} />
            </button>
            {onOpenHouse && (
              <button type="button" onClick={() => { setMenuOpen(false); onOpenHouse(); }} title="进入小棉花小屋">
                <Home size={12} /> 小屋
              </button>
            )}
            {onShareToChat && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onShareToChat('我刚和博美小棉花玩了抛球和陀螺仪奔跑，它摇着尾巴可开心了！');
                }}
                title="带去聊天"
              >
                <MessageCircle size={12} />
              </button>
            )}
            <button
              type="button"
              className="is-danger"
              onClick={() => onSetEnabled?.(false)}
              title="收起悬浮桌宠"
            >
              收起
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
