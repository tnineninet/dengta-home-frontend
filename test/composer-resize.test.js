import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {resizeComposerInput} from '../src/composer-size.js';

test('clearing a draft returns to one line even when a narrow placeholder wraps',()=>{
 const input={value:'',scrollHeight:88,style:{},ownerDocument:{defaultView:{getComputedStyle:()=>({minHeight:'44px',maxHeight:'132px'})}}};
 resizeComposerInput(input);
 assert.equal(input.style.height,'44px');assert.equal(input.style.overflowY,'hidden');
 input.value='A long draft';input.scrollHeight=198;resizeComposerInput(input);
 assert.equal(input.style.height,'132px');assert.equal(input.style.overflowY,'auto');
 input.value='';resizeComposerInput(input);assert.equal(input.style.height,'44px');
});

test('the composer resizes long drafts after the viewport grows without a width or input change', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const start = source.indexOf('  useLayoutEffect(() => {\n    const input = messageInputRef.current;');
  const end = source.indexOf('  const composerMenuTriggerRef', start);
  assert.ok(start >= 0 && end > start);

  const composer = { clientWidth: 310 };
  const input = { value: 'many wrapped lines', parentElement: composer, style: {}, scrollHeight: 200 };
  const visualViewport = new EventTarget();
  const view = new EventTarget();
  const frames = new Map();
  let nextFrame = 0;
  let maximum = 108;
  let onComposerResize;
  let disconnected = false;
  Object.assign(view, {
    visualViewport,
    getComputedStyle: () => ({ minHeight: '44px', maxHeight: `${maximum}px` }),
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  input.ownerDocument = { defaultView: view };
  class Observer {
    constructor(callback) { onComposerResize = callback; }
    observe(target) { assert.equal(target, composer); }
    disconnect() { disconnected = true; }
  }
  const flush = () => {
    assert.equal(frames.size, 1);
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
  };
  let cleanup;
  let measurements = 0;
  const measure = field => { measurements++; resizeComposerInput(field); };
  resizeComposerInput(input);
  assert.equal(input.style.height, '108px');
  new Function('useLayoutEffect', 'ResizeObserver', 'window', 'messageInputRef', 'activeView',
    'resizeComposerInput', source.slice(start, end))(
    effect => { cleanup = effect(); }, Observer, view, { current: input }, 'chat', measure,
  );

  maximum = 132;
  // Neither the parent nor the inline textarea height changes until we remeasure.
  // No ResizeObserver callback or new input should be needed.
  visualViewport.dispatchEvent(new Event('resize'));
  view.dispatchEvent(new Event('resize'));
  assert.equal(input.style.height, '108px');
  flush();
  assert.equal(input.style.height, '132px');
  assert.equal(input.style.overflowY, 'auto');
  assert.equal(measurements, 1);

  onComposerResize();
  flush();
  assert.equal(measurements, 1, 'observer notifications for height alone must not cause more writes');
  maximum = 108;
  view.dispatchEvent(new Event('resize'));
  flush();
  assert.equal(input.style.height, '108px');
  composer.clientWidth = 260;
  onComposerResize();
  flush();
  assert.equal(measurements, 3, 'a width change must recalculate wrapping');

  visualViewport.dispatchEvent(new Event('resize'));
  cleanup();
  assert.equal(disconnected, true);
  assert.equal(frames.size, 0);
  view.dispatchEvent(new Event('resize'));
  visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(frames.size, 0, 'cleanup removes both resize listeners and cancels the pending frame');
});
