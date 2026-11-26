import { useEffect, useRef, useState } from 'react';
import { petLocalStorage, petStorageKey, readPetState, savePetState } from './cotton/pet-state.js';
import { EXPRESSION_LABELS } from './cotton/expressions.js';
import './cotton-pet.css';

const actions = [
  ['pet', '摸摸头'],
  ['dance', '随音乐起舞'],
  ['paw', '抬左爪'],
  ['pawRight', '抬右爪'],
  ['greet', '叫名字'],
  ['nod', '开心点头'],
  ['feed', '喂点零食'],
  ['drink', '递水喝'],
  ['brush', '梳梳毛'],
  ['ball', '拨球玩'],
];
const labels = Object.fromEntries([...actions, ['idle', '安静陪伴'], ['rest', '坐着打盹'], ['wake', '醒来看看']]);
const expressionButtons = ['auto', 'Happy', 'Surprised', 'Sleepy', 'Excited', 'Blink'];
const DESKTOP_PET_CMD = 'D:\\GZdeepseek\\dengta-cotton-desktop\\启动小棉花桌宠.bat';

function PetVisit({ storageKey, onShare, compact, desktopPetEnabled = false, onToggleDesktopPet = null }) {
  const [initial] = useState(() => readPetState(petLocalStorage(), storageKey));
  const [open, setOpen] = useState(compact);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState(compact ? 'loading' : 'idle');
  const [snapshot, setSnapshot] = useState({ stats: initial.stats || {}, action: 'idle' });
  const [quiet, setQuiet] = useState(initial.quiet === true);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState('');
  const [style, setStyle] = useState({ toon: false, outline: true, night: false, bigHead: false, skeleton: false });
  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);
  const [expression, setExpression] = useState('auto');
  const [zoom, setZoom] = useState(1);
  const [pieMenu, setPieMenu] = useState(null);
  const canvas = useRef(null), runtime = useRef(null), stageRef = useRef(null);
  const dragRef = useRef(null);
  const latest = useRef({ stats: initial.stats || {}, quiet: initial.quiet === true });

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const visit = latest.current;
    let instance;
    import('./cotton/pet-runtime.js').then(({ createPetRuntime }) => {
      if (abort.signal.aborted) return;
      return createPetRuntime(canvas.current, {
        signal: abort.signal, initial: visit,
        onChange(value) {
          if (abort.signal.aborted) return;
          visit.stats = value.stats;
          setSnapshot(value);
          savePetState(petLocalStorage(), storageKey, value.stats, visit.quiet);
        },
        onError() { if (!abort.signal.aborted) setStatus('error'); },
      });
    }).then(value => {
      if (!value) return;
      instance = value;
      if (abort.signal.aborted) { instance.dispose(); return; }
      runtime.current = instance;
      instance.setVisualStyle?.(styleRef.current);
      setStatus('ready');
    }).catch(() => { if (!abort.signal.aborted) setStatus('error'); });
    return () => {
      abort.abort();
      if (instance) savePetState(petLocalStorage(), storageKey, instance.snapshot().stats, visit.quiet);
      instance?.dispose();
      runtime.current = null;
    };
  }, [open, attempt, storageKey]);

  function launch() { setStatus('loading'); setPaused(false); setOpen(true); setAttempt(value => value + 1); }
  function toggleQuiet() {
    const next = !quiet;
    setQuiet(next); latest.current.quiet = next;
    runtime.current?.setQuiet(next);
    savePetState(petLocalStorage(), storageKey, latest.current.stats, next);
  }
  function interact(id) {
    setPieMenu(null);
    const result = runtime.current?.command(id);
    setNotice(result?.accepted ? `${labels[id]}，陪它待一会儿。` : result?.reason || '小棉花还在准备。');
  }
  function toggleStyle(key, label) {
    setStyle(current => {
      const next = { ...current, [key]: !current[key] };
      runtime.current?.setVisualStyle?.(next);
      setNotice(`${label}${next[key] ? '已开启' : '已关闭'}。`);
      return next;
    });
    setPieMenu(null);
  }
  function chooseExpression(name) {
    setExpression(name);
    runtime.current?.setExpression?.(name);
    setNotice(`表情已切换为「${EXPRESSION_LABELS[name] || name}」。`);
  }
  function handleStagePointerMove(event) {
    if (status !== 'ready' || compact) return;
    const rect = stageRef.current?.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return;
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    runtime.current?.setGaze?.(nx, ny, true);
    if (dragRef.current) {
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current = { x: event.clientX, y: event.clientY };
      runtime.current?.setCameraOrbit?.(dx * -0.012, dy * 0.008, null);
    }
  }
  function handleStagePointerDown(event) {
    if (status !== 'ready' || compact || event.button !== 0) return;
    setPieMenu(null);
    dragRef.current = { x: event.clientX, y: event.clientY };
  }
  function handleStagePointerUp() { dragRef.current = null; }
  function handleStagePointerLeave() {
    dragRef.current = null;
    runtime.current?.setGaze?.(0, 0, false);
  }
  function handleStageWheel(event) {
    if (status !== 'ready' || compact) return;
    event.preventDefault();
    setZoom(current => {
      const next = Math.max(0.7, Math.min(1.55, Number((current - Math.sign(event.deltaY) * 0.08).toFixed(2))));
      runtime.current?.setCameraOrbit?.(0, 0, next);
      return next;
    });
  }
  function handleStageContextMenu(event) {
    if (status !== 'ready' || compact) return;
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect?.();
    if (!rect) return;
    const x = Math.max(92, Math.min(rect.width - 92, event.clientX - rect.left));
    const y = Math.max(92, Math.min(rect.height - 92, event.clientY - rect.top));
    setPieMenu({ x, y });
  }
  async function copyDesktopCommand() {
    try {
      await navigator.clipboard.writeText(DESKTOP_PET_CMD);
      setNotice('已复制桌面独立桌宠启动路径，可直接双击运行。');
    } catch {
      setNotice(`请在本机直接双击运行：${DESKTOP_PET_CMD}`);
    }
  }

  return <section className={`cotton-pet${compact ? ' cotton-pet-compact' : ''}`} aria-label={compact ? '小棉花陪聊' : '小棉花的小屋'}>
    {!compact && <header className="cotton-heading"><span className="cotton-eyebrow">VRM 弹簧物理 · 多形态键表情 · 卡通渲染</span><h2>小棉花的小屋</h2><p>不急着说什么，坐一会儿也很好。左键拖拽旋转视角、滚轮缩放、右键唤出桌宠径向轮盘。</p></header>}
    <div className="cotton-layout">
      <div
        ref={stageRef}
        className={`cotton-stage${style.night ? ' is-night' : ''}${style.toon ? ' is-toon' : ''}`}
        onPointerMove={handleStagePointerMove}
        onPointerDown={handleStagePointerDown}
        onPointerUp={handleStagePointerUp}
        onPointerLeave={handleStagePointerLeave}
        onWheel={handleStageWheel}
        onContextMenu={handleStageContextMenu}
      >
        {open && <canvas key={attempt} ref={canvas} aria-label="小棉花三维坐姿互动" />}
        {!open && <div className="cotton-welcome"><span aria-hidden="true">✿</span><h3>给日常留一点柔软</h3><p>第一次打开会加载小棉花三维模型、弹簧骨骼物理与 5 组表情形态键。</p><button type="button" onClick={launch}>打开小屋</button></div>}
        {status === 'loading' && <div className="cotton-overlay" role="status">小棉花正在过来…</div>}
        {status === 'error' && <div className="cotton-overlay" role="alert"><p>暂时没能打开小屋，请重试或稍后再来。</p><button type="button" onClick={launch}>重新打开</button></div>}
        {status === 'ready' && <span className="cotton-state">{paused ? '暂停陪伴' : labels[snapshot.action] || '安静陪伴'}</span>}
        {status === 'ready' && !compact && <span className="cotton-zoom-pill">{Math.round(zoom * 100)}%</span>}
        <span className="cotton-silent">无声陪伴</span>
        {pieMenu && !compact && (
          <div className="cotton-pie-menu" style={{ left: `${pieMenu.x}px`, top: `${pieMenu.y}px` }} role="menu" aria-label="桌宠快捷轮盘">
            <button type="button" className="pie-center" onClick={() => setPieMenu(null)} aria-label="关闭轮盘">×</button>
            <button type="button" className="pie-item pie-n" onClick={() => interact('pet')}>摸摸头</button>
            <button type="button" className="pie-item pie-ne" onClick={() => interact('dance')}>随音乐舞</button>
            <button type="button" className="pie-item pie-se" onClick={() => toggleStyle('bigHead', '大头萌态')}>大头模式</button>
            <button type="button" className="pie-item pie-s" onClick={() => toggleStyle('toon', 'MToon 卡通着色')}>卡通着色</button>
            <button type="button" className="pie-item pie-sw" onClick={() => toggleStyle('night', '夜间氛围光')}>夜间氛围</button>
            <button type="button" className="pie-item pie-nw" onClick={() => { runtime.current?.resetCamera?.(); setZoom(1); setPieMenu(null); }}>重置视角</button>
          </div>
        )}
      </div>
      <aside className="cotton-controls">
        {!compact && <><h3>一起照料的小日常</h3><p>摸摸头、随音乐起舞、递杯水，也可以各做各的。离开时，小棉花会休息，不需要补签或补喂。</p></>}
        <div className="cotton-actions">{(compact ? actions.slice(0, 1) : actions).map(([id, label]) => <button type="button" key={id} disabled={status !== 'ready' || paused} onClick={() => interact(id)}>{label}</button>)}</div>
        {!compact && (
          <>
            <div className="cotton-subsection">
              <h4>视觉与物理（VRM 课程管线）</h4>
              <div className="cotton-style-row">
                <button type="button" data-active={style.toon ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('toon', 'MToon 卡通着色')}>{style.toon ? '✓ MToon 卡通' : 'MToon 卡通'}</button>
                <button type="button" data-active={style.outline ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('outline', '卡通描边')}>{style.outline ? '✓ 细描边' : '细描边'}</button>
                <button type="button" data-active={style.night ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('night', '夜间氛围光')}>{style.night ? '✓ 夜间氛围' : '夜间氛围'}</button>
                <button type="button" data-active={style.bigHead ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('bigHead', '大头萌态')}>{style.bigHead ? '✓ 大头模式' : '大头模式'}</button>
                <button type="button" data-active={style.skeleton ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => toggleStyle('skeleton', '骨骼视图')}>{style.skeleton ? '✓ 骨骼线' : '骨骼线'}</button>
              </div>
            </div>
            <div className="cotton-subsection">
              <h4>形态键表情（Shape Keys）</h4>
              <div className="cotton-style-row">
                {expressionButtons.map((expr) => (
                  <button key={expr} type="button" data-active={expression === expr ? 'true' : 'false'} disabled={status !== 'ready'} onClick={() => chooseExpression(expr)}>
                    {EXPRESSION_LABELS[expr]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="cotton-options"><button type="button" aria-pressed={quiet} onClick={toggleQuiet}>{quiet ? '✓ 安静陪伴' : '安静陪伴'}</button><button type="button" disabled={status !== 'ready'} onClick={() => { const next = !paused; setPaused(next); runtime.current?.setPaused(next); }}>{paused ? '继续陪伴' : '暂停动画'}</button></div>
        <p className="cotton-feedback" role="status">{notice || '互动由你开始，不会自动发消息。'}</p>
        {status === 'ready' && !compact && <dl className="cotton-stats">{[['mood', '心情'], ['satiety', '饱食'], ['water', '饮水']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Math.round(snapshot.stats[key] || 0)}<span> / 100</span></dd></div>)}</dl>}
        {!compact && (
          <div className="cotton-desktop-card">
            <strong>博美犬小棉花 · 悬浮桌面宠物（BV1nn486sEbu 课程全流程）</strong>
            <p>已按课程第 3–8 节在 Blender 5.3 + VRM 1.0 管线完成 MToon 卡通着色、双耳/四节尾巴弹簧骨骼与球形碰撞体、5 组形态键表情与右键径向轮盘，可在 DengTa 全页面悬浮互动，也可导出 `.vrm` 导入 Mate Engine。</p>
            <div className="cotton-style-row">
              {onToggleDesktopPet && (
                <button
                  type="button"
                  data-active={desktopPetEnabled ? 'true' : 'false'}
                  onClick={() => {
                    onToggleDesktopPet(!desktopPetEnabled);
                    setNotice(!desktopPetEnabled ? '已开启 DengTa 内悬浮博美桌宠！切回聊天或其他页面即可看到小棉花陪着你。' : '已收起 DengTa 内悬浮博美桌宠。');
                  }}
                >
                  {desktopPetEnabled ? '✓ 已开启 DengTa 悬浮桌宠' : '🐾 开启 DengTa 悬浮桌宠'}
                </button>
              )}
              <a
                className="cotton-vrm-download"
                href={`${import.meta.env.BASE_URL}cotton/cotton-pomeranian.vrm`}
                download="cotton-pomeranian.vrm"
              >
                下载博美 VRM 1.0 模型
              </a>
              <button type="button" onClick={() => void copyDesktopCommand()}>复制 Windows 独立桌宠路径</button>
            </div>
          </div>
        )}
        {onShare && <button type="button" className="cotton-share" disabled={status !== 'ready'} onClick={() => onShare('想和你一起陪小棉花待一会儿，聊聊我们的小日常。')}>带回聊天，和伴侣聊聊 ↗</button>}
        {!compact && <small>{storageKey ? '照料状态仅保存在本机，按当前账号和伴侣分别记录。' : '本次体验不保存照料状态。'}<br />已集成双耳与四节尾巴 Verlet 弹簧骨骼 + 头胸球形碰撞体防穿模。</small>}
      </aside>
    </div>
  </section>;
}

export default function CottonPet({ accountScope = '', companionScope = '', onShare, compact = false, desktopPetEnabled = false, onToggleDesktopPet = null }) {
  const key = petStorageKey(accountScope, companionScope);
  return <PetVisit key={`${key || 'guest'}:${compact}`} storageKey={key} onShare={onShare} compact={compact} desktopPetEnabled={desktopPetEnabled} onToggleDesktopPet={onToggleDesktopPet} />;
}
