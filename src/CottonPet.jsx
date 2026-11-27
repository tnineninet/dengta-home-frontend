import { useEffect, useRef, useState } from 'react';
import {
  CircleDot,
  Compass,
  Droplets,
  Hand,
  Heart,
  MessageCircle,
  Moon,
  Music,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Smile,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { petLocalStorage, petStorageKey, readPetState, savePetState } from './cotton/pet-state.js';
import { EXPRESSION_LABELS } from './cotton/expressions.js';
import { createGyroController, isGyroSupported } from './cotton/gyro-controller.js';
import './cotton-pet.css';

const PRIMARY_ACTIONS = [
  { id: 'pet', label: '摸头', Icon: Heart },
  { id: 'feed', label: '喂食', Icon: Utensils },
  { id: 'drink', label: '喝水', Icon: Droplets },
  { id: 'ball', label: '抛球', Icon: CircleDot },
  { id: 'brush', label: '梳毛', Icon: Sparkles },
  { id: 'dance', label: '跳舞', Icon: Music },
];

const EXTRA_ACTIONS = [
  ['paw', '抬左爪'],
  ['pawRight', '抬右爪'],
  ['greet', '叫名字'],
  ['nod', '开心点头'],
];

const labels = {
  pet: '摸摸头',
  feed: '端碗干饭',
  drink: '咕嘟喝水',
  ball: '追球玩耍',
  brush: '蓬松梳毛',
  dance: '开心起舞',
  paw: '抬左爪',
  pawRight: '抬右爪',
  greet: '回应名字',
  nod: '开心点头',
  idle: '安静陪伴',
  rest: '坐着打盹',
  wake: '醒来看看',
};

const expressionButtons = ['auto', 'Happy', 'Surprised', 'Sleepy', 'Excited', 'Blink'];
const BACKDROP_PRESETS = [
  ['sage', '雾松绿'],
  ['cocoa', '暖咖绒'],
  ['twilight', '暮色蓝'],
];
const DESKTOP_PET_CMD = 'D:\\GZdeepseek\\dengta-cotton-desktop\\启动小棉花桌宠.bat';

function PetVisit({ storageKey, onShare, compact, desktopPetEnabled = false, onToggleDesktopPet = null }) {
  const [initial] = useState(() => readPetState(petLocalStorage(), storageKey));
  const [open, setOpen] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('loading');
  const [snapshot, setSnapshot] = useState({ stats: initial.stats || {}, action: 'idle' });
  const [quiet, setQuiet] = useState(initial.quiet === true);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState('');
  const [style, setStyle] = useState({ toon: true, outline: true, night: false, bigHead: false, skeleton: false });
  const [backdrop, setBackdrop] = useState('sage');
  const [activeTab, setActiveTab] = useState('play');
  const [gyroEnabled, setGyroEnabled] = useState(false);
  const [expression, setExpression] = useState('auto');
  const [zoom, setZoom] = useState(1);

  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  const canvas = useRef(null);
  const runtime = useRef(null);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const gyroRef = useRef(null);
  const latest = useRef({ stats: initial.stats || {}, quiet: initial.quiet === true });

  useEffect(() => {
    if (!open) return undefined;
    const abort = new AbortController();
    const visit = latest.current;
    let instance;
    import('./cotton/pet-runtime.js')
      .then(({ createPetRuntime }) => {
        if (abort.signal.aborted) return null;
        return createPetRuntime(canvas.current, {
          signal: abort.signal,
          initial: visit,
          onChange(value) {
            if (abort.signal.aborted) return;
            visit.stats = value.stats;
            setSnapshot(value);
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
        runtime.current = instance;
        instance.setVisualStyle?.(styleRef.current);
        setStatus('ready');
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus('error');
      });
    return () => {
      abort.abort();
      if (instance) savePetState(petLocalStorage(), storageKey, instance.snapshot().stats, visit.quiet);
      instance?.dispose();
      runtime.current = null;
    };
  }, [open, attempt, storageKey]);

  // Phone gyroscope integration inside Little Cotton's House
  useEffect(() => {
    if (!gyroEnabled || status !== 'ready') {
      gyroRef.current?.stop();
      gyroRef.current = null;
      runtime.current?.setGyroTilt?.(0, 0);
      return undefined;
    }
    const ctrl = createGyroController({
      onTilt: ({ x, z }) => {
        runtime.current?.setGyroTilt?.(x, z);
      },
      onShake: (imp) => {
        runtime.current?.applyShake?.(imp);
        setNotice('哇哦！摇晃手机把小球弹飞了，小棉花正追过去呢！');
      },
    });
    gyroRef.current = ctrl;
    void ctrl.start().then((res) => {
      if (!res.ok) {
        setGyroEnabled(false);
        setNotice(res.reason || '当前设备不支持陀螺仪');
      }
    });
    return () => {
      ctrl.stop();
      gyroRef.current = null;
      runtime.current?.setGyroTilt?.(0, 0);
    };
  }, [gyroEnabled, status]);

  function launch() {
    setStatus('loading');
    setPaused(false);
    setOpen(true);
    setAttempt((value) => value + 1);
  }

  function toggleQuiet() {
    const next = !quiet;
    setQuiet(next);
    latest.current.quiet = next;
    runtime.current?.setQuiet(next);
    savePetState(petLocalStorage(), storageKey, latest.current.stats, next);
  }

  function interact(id) {
    const result = runtime.current?.command(id);
    setNotice(result?.accepted ? `${labels[id] || id}～小棉花好开心！` : result?.reason || '小棉花还在准备。');
  }

  function toggleStyle(key, label) {
    setStyle((current) => {
      const next = { ...current, [key]: !current[key] };
      runtime.current?.setVisualStyle?.(next);
      setNotice(`${label}${next[key] ? '已开启' : '已关闭'}。`);
      return next;
    });
  }

  function cycleBackdrop() {
    const idx = BACKDROP_PRESETS.findIndex(([id]) => id === backdrop);
    const [nextId, nextLabel] = BACKDROP_PRESETS[(idx + 1) % BACKDROP_PRESETS.length];
    setBackdrop(nextId);
    setNotice(`舞台底色已切换为「${nextLabel}」。`);
  }

  function chooseExpression(name) {
    setExpression(name);
    runtime.current?.setExpression?.(name);
    setNotice(`表情已切换为「${EXPRESSION_LABELS[name] || name}」。`);
  }

  function toggleGyro() {
    if (!isGyroSupported()) {
      setNotice('当前设备暂不支持陀螺仪，直接用手指抓球甩飞也超好玩！');
      return;
    }
    setGyroEnabled((prev) => {
      const next = !prev;
      setNotice(next ? '🧭 陀螺仪已开启！倾斜手机就能让小球滚动、小棉花跟着满场跑～' : '已关闭陀螺仪感应。');
      return next;
    });
  }

  function getNdc(clientX, clientY) {
    const rect = stageRef.current?.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return { nx: 0, ny: 0 };
    return {
      nx: ((clientX - rect.left) / rect.width) * 2 - 1,
      ny: ((clientY - rect.top) / rect.height) * 2 - 1,
    };
  }

  function handleStagePointerDown(event) {
    if (status !== 'ready' || compact) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button, a')) return;
    const { nx, ny } = getNdc(event.clientX, event.clientY);
    const picked = runtime.current?.pickTarget?.(nx, ny);
    const now = Number(event.timeStamp) || 0;

    if (picked?.hit === 'ball') {
      event.preventDefault();
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
      runtime.current?.grabBall?.(nx, ny);
      dragRef.current = { mode: 'ball', pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, lastTime: now, moved: true };
      setNotice('抓住小球啦！甩手扔出去，看小棉花追球～');
      return;
    }

    if (picked?.hit === 'pet') {
      event.preventDefault();
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
      dragRef.current = {
        mode: 'pet',
        zone: picked.zone,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: now,
        moved: false,
      };
      return;
    }

    dragRef.current = {
      mode: 'orbit',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: now,
      moved: false,
    };
  }

  function handleStagePointerMove(event) {
    if (status !== 'ready' || compact) return;
    const { nx, ny } = getNdc(event.clientX, event.clientY);
    runtime.current?.setGaze?.(nx, ny, true);

    const drag = dragRef.current;
    if (!drag) return;
    const now = Number(event.timeStamp) || (drag.lastTime + 16);
    const dtSec = Math.max(0.008, (now - drag.lastTime) / 1000);
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;

    if (drag.mode === 'ball') {
      runtime.current?.dragBall?.(nx, ny);
      return;
    }

    if (drag.mode === 'pet') {
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
        drag.moved = true;
      }
      if (drag.moved) {
        runtime.current?.setBodyDrag?.({
          active: true,
          zone: drag.zone,
          vx: (dx / dtSec) / 240,
          vy: (dy / dtSec) / 240,
        });
      }
      return;
    }

    if (drag.mode === 'orbit') {
      // Only orbit on deliberate horizontal/mouse drag so vertical touch swipes still scroll the page!
      if (event.pointerType !== 'touch' || Math.abs(event.clientX - drag.startX) > Math.abs(event.clientY - drag.startY) * 1.15) {
        runtime.current?.setCameraOrbit?.(dx * -0.011, dy * 0.007, null);
      }
    }
  }

  function handleStagePointerUp(event) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture?.(drag.pointerId); } catch { /* ignore */ }

    if (drag.mode === 'ball') {
      runtime.current?.releaseBall?.();
      setNotice('球飞出去啦！小棉花正在满场追球～');
      return;
    }

    if (drag.mode === 'pet') {
      runtime.current?.setBodyDrag?.({ active: false });
      if (!drag.moved) {
        interact(drag.zone === 'paw' ? 'paw' : 'pet');
      } else {
        setNotice(
          drag.zone === 'head'
            ? '小脑袋摇摇晃晃落回地上啦～'
            : drag.zone === 'paw'
              ? '牵完小爪子软乎乎落地！'
              : '抱起来摇晃了一下，小棉花开心落地！',
        );
      }
    }
  }

  function handleStagePointerLeave() {
    if (dragRef.current?.mode === 'ball') runtime.current?.releaseBall?.();
    if (dragRef.current?.mode === 'pet') runtime.current?.setBodyDrag?.({ active: false });
    dragRef.current = null;
    runtime.current?.setGaze?.(0, 0, false);
  }

  function handleStageWheel(event) {
    if (status !== 'ready' || compact) return;
    event.preventDefault();
    setZoom((current) => {
      const next = Math.max(0.7, Math.min(1.55, Number((current - Math.sign(event.deltaY) * 0.08).toFixed(2))));
      runtime.current?.setCameraOrbit?.(0, 0, next);
      return next;
    });
  }

  async function copyDesktopCommand() {
    try {
      await navigator.clipboard.writeText(DESKTOP_PET_CMD);
      setNotice('已复制桌面独立桌宠启动路径。');
    } catch {
      setNotice(`请在本机直接双击运行：${DESKTOP_PET_CMD}`);
    }
  }

  return (
    <section
      className={`cotton-pet${compact ? ' cotton-pet-compact' : ' feature-page'}`}
      aria-label={compact ? '小棉花陪聊' : '小棉花的小屋'}
    >
      {!compact && (
        <header className="cotton-topbar">
          <div className="cotton-topbar-title">
            <h2>小棉花的小屋</h2>
            <p>拖小球甩飞 · 拎身体部位互动 · 开陀螺仪满场跑</p>
          </div>
          <div className="cotton-topbar-pills">
            {status === 'ready' && (
              <div className="cotton-mini-stats" aria-label="小棉花状态">
                <span title="心情"><Heart size={12} /> {Math.round(snapshot.stats.mood || 0)}</span>
                <span title="饱食"><Utensils size={12} /> {Math.round(snapshot.stats.satiety || 0)}</span>
                <span title="饮水"><Droplets size={12} /> {Math.round(snapshot.stats.water || 0)}</span>
              </div>
            )}
            {onToggleDesktopPet && (
              <button
                type="button"
                className={`cotton-float-toggle-pill${desktopPetEnabled ? ' is-active' : ''}`}
                onClick={() => {
                  onToggleDesktopPet(!desktopPetEnabled);
                  setNotice(!desktopPetEnabled ? '已开启悬浮桌宠！切回聊天就能看到小棉花陪着你。' : '已收起悬浮桌宠。');
                }}
              >
                {desktopPetEnabled ? '🐾 桌宠悬浮中' : '🐾 召唤桌宠'}
              </button>
            )}
          </div>
        </header>
      )}

      <div className="cotton-layout">
        <div
          ref={stageRef}
          className={`cotton-stage${style.night ? ' is-night' : ''}${style.toon ? ' is-toon' : ''}`}
          data-backdrop={backdrop}
          onPointerMove={handleStagePointerMove}
          onPointerDown={handleStagePointerDown}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
          onPointerLeave={handleStagePointerLeave}
          onWheel={handleStageWheel}
        >
          {open && <canvas key={attempt} ref={canvas} aria-label="小棉花三维互动舞台" />}
          {status === 'loading' && <div className="cotton-overlay" role="status">小棉花正在跑来…</div>}
          {status === 'error' && (
            <div className="cotton-overlay" role="alert">
              <p>暂时没能打开小屋，请重试。</p>
              <button type="button" onClick={launch}>重新打开</button>
            </div>
          )}
          {status === 'ready' && (
            <span className="cotton-state">
              {paused ? '已暂停' : labels[snapshot.action] || '开心陪伴'}
            </span>
          )}
          {status === 'ready' && !compact && (
            <div className="cotton-stage-top-right">
              <button
                type="button"
                className={`cotton-stage-chip${gyroEnabled ? ' is-active' : ''}`}
                onClick={toggleGyro}
                title="开启/关闭手机陀螺仪控制小棉花与小球"
              >
                <Compass size={13} aria-hidden="true" />
                <span>{gyroEnabled ? '陀螺仪开' : '陀螺仪'}</span>
              </button>
              <button
                type="button"
                className="cotton-stage-chip"
                onClick={() => { runtime.current?.resetCamera?.(); setZoom(1); }}
                title="重置视角"
                aria-label="重置视角"
              >
                <RotateCcw size={13} aria-hidden="true" />
                <span>{Math.round(zoom * 100)}%</span>
              </button>
            </div>
          )}

          {/* Sleek translucent floating bottom icon dock right on the stage */}
          {status === 'ready' && !compact && (
            <div className="cotton-stage-dock" role="toolbar" aria-label="小棉花快捷互动">
              {PRIMARY_ACTIONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={snapshot.action === id ? 'is-active' : ''}
                  disabled={paused}
                  onClick={() => interact(id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="cotton-controls">
          {compact ? (
            <>
              <div className="cotton-actions">
                <button type="button" disabled={status !== 'ready' || paused} onClick={() => interact('pet')}>摸摸头</button>
              </div>
              <div className="cotton-options">
                <button type="button" aria-pressed={quiet} onClick={toggleQuiet}>{quiet ? '✓ 安静' : '安静'}</button>
                <button type="button" disabled={status !== 'ready'} onClick={() => { const next = !paused; setPaused(next); runtime.current?.setPaused(next); }}>
                  {paused ? '继续' : '暂停'}
                </button>
              </div>
              <p className="cotton-feedback" role="status">{notice || '轻点摸头，或拖球逗它玩。'}</p>
            </>
          ) : (
            <>
              <p className="cotton-feedback" role="status">
                {notice || '可直接拖动红白小球甩飞、拎起小棉花头/肚子摇晃，或点右上角开启陀螺仪！'}
              </p>

              <div className="cotton-tabs" role="tablist" aria-label="小棉花控制分类">
                <button type="button" role="tab" aria-selected={activeTab === 'play'} className={activeTab === 'play' ? 'is-active' : ''} onClick={() => setActiveTab('play')}>
                  <Hand size={13} /> 动作与陪伴
                </button>
                <button type="button" role="tab" aria-selected={activeTab === 'look'} className={activeTab === 'look' ? 'is-active' : ''} onClick={() => setActiveTab('look')}>
                  <Palette size={13} /> 外观与表情
                </button>
                <button type="button" role="tab" aria-selected={activeTab === 'desk'} className={activeTab === 'desk' ? 'is-active' : ''} onClick={() => setActiveTab('desk')}>
                  <Smile size={13} /> 桌宠与分享
                </button>
              </div>

              {activeTab === 'play' && (
                <div className="cotton-tab-panel">
                  <div className="cotton-pill-grid">
                    {EXTRA_ACTIONS.map(([id, label]) => (
                      <button key={id} type="button" disabled={status !== 'ready' || paused} onClick={() => interact(id)}>
                        {label}
                      </button>
                    ))}
                    <button type="button" aria-pressed={quiet} onClick={toggleQuiet}>
                      {quiet ? '✓ 安静打盹' : '安静打盹'}
                    </button>
                    <button
                      type="button"
                      disabled={status !== 'ready'}
                      onClick={() => {
                        const next = !paused;
                        setPaused(next);
                        runtime.current?.setPaused(next);
                      }}
                    >
                      {paused ? <><Play size={13} /> 继续动画</> : <><Pause size={13} /> 暂停动画</>}
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'look' && (
                <div className="cotton-tab-panel">
                  <div className="cotton-style-row">
                    <button type="button" data-active={style.toon ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('toon', '卡通着色')}>
                      {style.toon ? '✓ 卡通着色' : '卡通着色'}
                    </button>
                    <button type="button" data-active={style.outline ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('outline', '手绘细描边')}>
                      {style.outline ? '✓ 细描边' : '细描边'}
                    </button>
                    <button type="button" data-active={style.night ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('night', '夜间氛围光')}>
                      <Moon size={12} /> {style.night ? '夜光开' : '夜间光'}
                    </button>
                    <button type="button" data-active={style.bigHead ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('bigHead', '大头萌态')}>
                      {style.bigHead ? '✓ 大头萌态' : '大头模式'}
                    </button>
                    <button type="button" data-active={style.skeleton ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('skeleton', '骨骼视图')}>
                      {style.skeleton ? '✓ 骨骼线' : '骨骼线'}
                    </button>
                    <button type="button" className="cotton-backdrop-btn" disabled={status !== 'ready'} onClick={cycleBackdrop}>
                      底色：{BACKDROP_PRESETS.find(([id]) => id === backdrop)?.[1] || '雾松绿'}
                    </button>
                  </div>
                  <div className="cotton-subsection">
                    <h4>表情切换</h4>
                    <div className="cotton-style-row">
                      {expressionButtons.map((expr) => (
                        <button
                          key={expr}
                          type="button"
                          data-active={expression === expr ? 'true' : 'false'}
                          disabled={status !== 'ready'}
                          onClick={() => chooseExpression(expr)}
                        >
                          {EXPRESSION_LABELS[expr]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'desk' && (
                <div className="cotton-tab-panel">
                  <div className="cotton-style-row">
                    {onShare && (
                      <button
                        type="button"
                        className="cotton-share-btn"
                        disabled={status !== 'ready'}
                        onClick={() => onShare('刚和小棉花玩了抛球、干饭和陀螺仪满场跑，毛茸茸的好可爱！')}
                      >
                        <MessageCircle size={13} /> 带回聊天聊它
                      </button>
                    )}
                    <a
                      className="cotton-vrm-download"
                      href={`${import.meta.env.BASE_URL}cotton/cotton-pomeranian.vrm`}
                      download="cotton-pomeranian.vrm"
                    >
                      下载 VRM 1.0 模型
                    </a>
                    <button type="button" onClick={() => void copyDesktopCommand()}>
                      复制 PC 桌宠路径
                    </button>
                  </div>
                  <small>
                    已启用 24 根全身骨骼 + 弹簧耳尾物理 + 卡通毛绒笔触纹理 + 陀螺仪跑动与物理抛球。
                  </small>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

export default function CottonPet({ accountScope = '', companionScope = '', onShare, compact = false, desktopPetEnabled = false, onToggleDesktopPet = null }) {
  const key = petStorageKey(accountScope, companionScope);
  return (
    <PetVisit
      key={`${key || 'guest'}:${compact}`}
      storageKey={key}
      onShare={onShare}
      compact={compact}
      desktopPetEnabled={desktopPetEnabled}
      onToggleDesktopPet={onToggleDesktopPet}
    />
  );
}
