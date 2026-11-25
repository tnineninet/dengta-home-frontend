import { useCallback, useEffect, useRef, useState } from 'react';
import { petLocalStorage, petStorageKey, readPetState, savePetState } from './cotton/pet-state.js';
import { EXPRESSION_LABELS } from './cotton/expressions.js';
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
  feed: '咔哧咔哧～最喜欢小零食啦！',
  drink: '咕嘟咕嘟喝口水，元气满满！',
  brush: '梳毛好舒服，蓬松博美变身～',
  ball: '追小球！看我接住它！',
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
  const pad = 12;
  const maxX = Math.max(pad, window.innerWidth - size - pad);
  const maxY = Math.max(pad, window.innerHeight - size - 88);
  return {
    x: Math.round(Math.max(pad, Math.min(maxX, x))),
    y: Math.round(Math.max(pad, Math.min(maxY, y))),
  };
}

function defaultCornerPosition(size) {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  return clampPosition(window.innerWidth - size - 28, window.innerHeight - size - 148, size);
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
  onSetEnabled,
  onOpenHouse,
  onShareToChat,
}) {
  const storageKey = petStorageKey(accountScope, companionScope);
  const prefScope = storageKey || 'guest';
  const savedPrefs = readDesktopPrefs(prefScope);
  const [scale, setScale] = useState(() =>
    Number.isFinite(savedPrefs?.scale) ? Math.max(0.75, Math.min(1.5, savedPrefs.scale)) : 1,
  );
  const stageSize = Math.round(216 * scale);
  const [pos, setPos] = useState(() =>
    Number.isFinite(savedPrefs?.x) && Number.isFinite(savedPrefs?.y)
      ? clampPosition(savedPrefs.x, savedPrefs.y, stageSize)
      : defaultCornerPosition(stageSize),
  );
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
  const [pieOpen, setPieOpen] = useState(false);
  const [bubble, setBubble] = useState('');
  const [dragging, setDragging] = useState(false);
  const [perchedEdge, setPerchedEdge] = useState(savedPrefs?.edge || 'bottom-right');
  const [pomodoroSec, setPomodoroSec] = useState(0);
  const [stats, setStats] = useState(() => readPetState(petLocalStorage(), storageKey).stats || {});

  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const wrapRef = useRef(null);
  const tapIndexRef = useRef(0);
  const bubbleTimerRef = useRef(0);
  const dragRef = useRef(null);
  const styleRef = useRef(style);
  const latestVisitRef = useRef(readPetState(petLocalStorage(), storageKey));

  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  const showBubble = useCallback((text, ms = 3200) => {
    setBubble(text);
    window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => setBubble(''), ms);
  }, []);

  const active = Boolean(enabled) && !suppressed;

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
        showBubble('汪！博美小棉花来桌面陪你啦～左键拖动、单击摸头、右键开轮盘！', 4200);
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

  // Global cursor gaze tracking across DengTa viewport (Lesson 4/5 gaze responsiveness)
  useEffect(() => {
    if (!active) return undefined;
    function onWindowPointerMove(event) {
      if (dragRef.current) {
        const dx = event.clientX - dragRef.current.startX;
        const dy = event.clientY - dragRef.current.startY;
        if (!dragRef.current.moved && Math.hypot(dx, dy) > 6) {
          dragRef.current.moved = true;
          setDragging(true);
          setPieOpen(false);
        }
        if (dragRef.current.moved) {
          const next = clampPosition(dragRef.current.origX + dx, dragRef.current.origY + dy, stageSize);
          setPos(next);
          runtimeRef.current?.setCameraOrbit?.(dx * -0.0004, 0, null);
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
      if (drag.moved) {
        setDragging(false);
        setPos((current) => {
          const snapped = { ...current };
          let edge = 'free';
          const rightDist = window.innerWidth - (current.x + stageSize);
          const bottomDist = window.innerHeight - (current.y + stageSize);
          if (current.x < 36) {
            snapped.x = 12;
            edge = 'left';
          } else if (rightDist < 42) {
            snapped.x = Math.max(12, window.innerWidth - stageSize - 16);
            edge = 'right';
          }
          if (bottomDist < 68) {
            snapped.y = Math.max(12, window.innerHeight - stageSize - 56);
            edge = edge === 'free' ? 'bottom' : `${edge}-bottom`;
          }
          setPerchedEdge(edge);
          saveDesktopPrefs(prefScope, { x: snapped.x, y: snapped.y, edge });
          if (edge !== 'free') {
            showBubble('趴在窗口边缘休息好舒服～', 2200);
          }
          return snapped;
        });
      } else {
        // Short click = direct pet/interact!
        const nextTap = TAP_INTERACTIONS[tapIndexRef.current % TAP_INTERACTIONS.length];
        tapIndexRef.current += 1;
        const result = runtimeRef.current?.command?.(nextTap.id);
        if (result?.accepted) {
          setActionLabel(nextTap.id === 'pet' ? '摸摸头中' : '开心互动');
          showBubble(nextTap.line, 2800);
        }
      }
    }

    function onResize() {
      setPos((current) => clampPosition(current.x, current.y, stageSize));
    }

    window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('resize', onResize);
    };
  }, [active, prefScope, stageSize, showBubble]);

  // Pomodoro focus timer (Lesson 8 Mate Engine companion timer)
  useEffect(() => {
    if (pomodoroSec <= 0) return undefined;
    const id = window.setInterval(() => {
      setPomodoroSec((prev) => {
        if (prev <= 1) {
          runtimeRef.current?.command?.('dance');
          showBubble('25 分钟专注完成！小棉花跳支舞庆祝一下，起来活动喝口水吧 ✨', 5200);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [pomodoroSec, showBubble]);

  function runAction(actionId, label) {
    setPieOpen(false);
    const res = runtimeRef.current?.command?.(actionId);
    if (res?.accepted) {
      setActionLabel(label || actionId);
      showBubble(ACTION_BUBBLES[actionId] || '汪呜～', 3200);
    } else if (res?.reason) {
      showBubble(res.reason, 2200);
    }
  }

  function toggleStyle(key, label) {
    setPieOpen(false);
    setStyle((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      runtimeRef.current?.setVisualStyle?.(next);
      saveDesktopPrefs(prefScope, { [key]: next[key] });
      showBubble(`${label}${next[key] ? '已开启' : '已关闭'}`, 2200);
      return next;
    });
  }

  function cycleExpression() {
    setPieOpen(false);
    const idx = EXPRESSION_CYCLE.indexOf(expression);
    const next = EXPRESSION_CYCLE[(idx + 1) % EXPRESSION_CYCLE.length];
    setExpression(next);
    runtimeRef.current?.setExpression?.(next);
    showBubble(`形态键表情：${EXPRESSION_LABELS[next] || next}`, 2400);
  }

  function snapToCorner() {
    setPieOpen(false);
    const corner = defaultCornerPosition(stageSize);
    setPos(corner);
    setPerchedEdge('bottom-right');
    saveDesktopPrefs(prefScope, { x: corner.x, y: corner.y, edge: 'bottom-right' });
    runtimeRef.current?.resetCamera?.();
    showBubble('小棉花已贴回右下角安静陪伴～', 2200);
  }

  function togglePomodoro() {
    setPieOpen(false);
    if (pomodoroSec > 0) {
      setPomodoroSec(0);
      showBubble('已结束番茄钟，随时再喊我一起专注～', 2200);
    } else {
      setPomodoroSec(25 * 60);
      runtimeRef.current?.command?.('nod');
      showBubble('25 分钟番茄钟开始！小棉花在角落陪你一起专注 ⏱', 3200);
    }
  }

  function handleStagePointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest('button, a')) return;
    event.preventDefault();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    };
  }

  function handleStageWheel(event) {
    event.preventDefault();
    setScale((prev) => {
      const next = Math.max(0.75, Math.min(1.5, Number((prev - Math.sign(event.deltaY) * 0.08).toFixed(2))));
      saveDesktopPrefs(prefScope, { scale: next });
      return next;
    });
  }

  function handleContextMenu(event) {
    event.preventDefault();
    setPieOpen((prev) => !prev);
  }

  if (suppressed) return null;

  if (!enabled) {
    return (
      <div className="cotton-float-launcher-wrap">
        <button
          type="button"
          className="cotton-float-launcher"
          onClick={() => onSetEnabled?.(true)}
          title="召唤 3D 博美犬小棉花悬浮桌宠（支持拖拽、摸头、喂食、跳舞与右键轮盘）"
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
        className={`cotton-desktop-pet-widget${dragging ? ' is-dragging' : ''}${style.night ? ' is-night' : ''}${pieOpen ? ' is-pie-open' : ''}`}
        style={{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          width: `${stageSize}px`,
        }}
        data-edge={perchedEdge}
      >
        {pomodoroSec > 0 && (
          <button
            type="button"
            className="cotton-pomo-pill"
            onClick={togglePomodoro}
            title="点击停止番茄钟"
          >
            ⏱ 专注 {formatCountdown(pomodoroSec)}
          </button>
        )}

        {bubble && (
          <div className="cotton-desktop-bubble" role="status">
            {bubble}
          </div>
        )}

        <div
          className="cotton-desktop-stage"
          style={{ width: `${stageSize}px`, height: `${stageSize}px` }}
          onPointerDown={handleStagePointerDown}
          onWheel={handleStageWheel}
          onContextMenu={handleContextMenu}
          title="左键单击摸摸头 · 按住拖动贴边 · 滚轮缩放 · 右键打开径向轮盘"
        >
          <canvas ref={canvasRef} aria-label="3D 博美犬小棉花桌宠画布" />
          {status === 'loading' && <span className="cotton-desktop-status">小棉花跑来中…</span>}
          {status === 'error' && <span className="cotton-desktop-status is-err">3D 渲染暂不可用</span>}
          {status === 'ready' && (
            <span className="cotton-desktop-mood-tag">
              {actionLabel} · 心情 {Math.round(stats.mood ?? 80)}
            </span>
          )}
          <button
            type="button"
            className="cotton-desktop-menu-trigger"
            aria-label="打开桌宠径向轮盘"
            aria-expanded={pieOpen}
            onClick={(event) => {
              event.stopPropagation();
              setPieOpen((prev) => !prev);
            }}
          >
            ✦
          </button>
        </div>

        {pieOpen && (
          <div className="cotton-desktop-pie" role="menu" aria-label="博美小棉花径向轮盘菜单">
            <button type="button" className="cdp-center" onClick={() => setPieOpen(false)} aria-label="关闭轮盘">
              ×
            </button>
            <button type="button" className="cdp-item cdp-n" onClick={() => runAction('pet', '摸摸头')}>
              摸摸头
            </button>
            <button type="button" className="cdp-item cdp-ne" onClick={() => runAction('dance', '音乐起舞')}>
              随音乐舞
            </button>
            <button type="button" className="cdp-item cdp-e" onClick={() => runAction('feed', '吃零食')}>
              喂零食
            </button>
            <button type="button" className="cdp-item cdp-se" onClick={() => toggleStyle('bigHead', '大头萌态')}>
              {style.bigHead ? '✓ 大头' : '大头模式'}
            </button>
            <button type="button" className="cdp-item cdp-s" onClick={() => toggleStyle('toon', 'MToon 卡通')}>
              {style.toon ? '✓ 卡通' : '写实/卡通'}
            </button>
            <button type="button" className="cdp-item cdp-sw" onClick={togglePomodoro}>
              {pomodoroSec > 0 ? '停番茄钟' : '25分专注'}
            </button>
            <button type="button" className="cdp-item cdp-w" onClick={() => runAction('ball', '逗球玩')}>
              逗球玩
            </button>
            <button type="button" className="cdp-item cdp-nw" onClick={cycleExpression}>
              {EXPRESSION_LABELS[expression] || '换表情'}
            </button>
          </div>
        )}

        <div className="cotton-desktop-toolbar" role="toolbar" aria-label="小棉花桌宠快捷操作">
          <button type="button" onClick={() => runAction('pet', '摸摸头')}>摸头</button>
          <button type="button" onClick={() => runAction('dance', '音乐起舞')}>跳舞</button>
          <button type="button" onClick={() => runAction('feed', '吃零食')}>喂食</button>
          <button type="button" onClick={() => toggleStyle('night', '夜间氛围光')}>
            {style.night ? '日间' : '夜光'}
          </button>
          <button type="button" onClick={snapToCorner} title="贴回右下角">贴边</button>
          {onOpenHouse && (
            <button type="button" onClick={onOpenHouse} title="进入小棉花小屋查看完整 3D 控制台">小屋</button>
          )}
          {onShareToChat && (
            <button
              type="button"
              onClick={() => onShareToChat('我刚在桌面和博美小棉花一起玩了一会儿，它摇着尾巴可开心了！')}
              title="带去聊天"
            >
              聊它
            </button>
          )}
          <button
            type="button"
            className="is-close"
            onClick={() => onSetEnabled?.(false)}
            title="收起悬浮桌宠"
          >
            收起
          </button>
        </div>
      </div>
    </div>
  );
}
