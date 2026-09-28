import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const originals = new Map();
function stub(name, value) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const events = new EventTarget();
const doc = new EventTarget();
doc.visibilityState = 'visible';
const storage = new Map();
const pendingKey = 'dengta_pending_room_invite';
stub('window', events);
stub('document', doc);
stub('localStorage', { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) });
stub('IS_REACT_ACT_ENVIRONMENT', true);
let calls, listeners, inviteRequests, launches, activeRead, replyRead, frameRead, roomRead, roomEvents, listenerDelay, playbackResult, playbackRead, captureResult;
function reset() {
  calls = []; listeners = []; inviteRequests = []; launches = [];
  captureResult = null;
  activeRead = null; replyRead = null; frameRead = null; roomRead = null; roomEvents = null; listenerDelay = false; playbackResult = null; playbackRead = null; doc.visibilityState = 'visible';
  storage.clear();
}
reset();
stub('__castFixture', {
  plugin: {
    addListener(name, callback) {
      const ready = deferred();
      const entry = { name, callback, removed: false, ready };
      const handle = { remove() { entry.removed = true; } };
      entry.handle = handle;
      listeners.push(entry);
      if (!listenerDelay) ready.resolve(handle);
      return ready.promise;
    },
    launchPlayer(input) { calls.push(['launch', input]); const request = deferred(); launches.push(request); return request.promise; },
    showCastReply(input) { calls.push(['showReply', input]); return Promise.resolve(); },
    showCastReaction(input) { calls.push(['showReaction', input]); return Promise.resolve(); },
    showCastDanmaku(input) { calls.push(['danmaku', input]); return Promise.resolve(); },
    stopPlayback() { calls.push(['stop']); return Promise.resolve(); },
    sendPlaybackCommand(input) { calls.push(['control', input]); return playbackResult?.promise || Promise.reject(new Error('UNIMPLEMENTED')); },
    getPlaybackState() { calls.push(['playbackState']); return playbackRead?.promise || Promise.reject(Object.assign(new Error('fixture old bridge'), { code: 'UNIMPLEMENTED' })); },
    captureFrame() { calls.push(['capture']); return captureResult?.promise || Promise.reject(new Error('UNIMPLEMENTED')); },
  },
  apiFetch() { calls.push(['frame']); return frameRead?.promise || Promise.resolve({ ok: true, json: async () => ({ reaction: '画面回应' }) }); },
  apiRequest(url) { const request = deferred(); inviteRequests.push({ url, ...request }); return request.promise; },
  readActiveCoWatchSession() { calls.push(['readSession']); return activeRead?.promise || Promise.resolve(null); },
  createCoWatchSession(input) { calls.push(['createSession', input]); return Promise.resolve({ id: 'session-fixture' }); },
  sendCoWatchReply(...args) { calls.push(['reply', ...args]); return replyRead?.promise || Promise.resolve({ reaction: '真实接口模拟回应' }); },
  createWatchRoom() { return Promise.resolve({ id: 'room-fixture', joinCode: 'ROOMAA', mediaUrl: 'https://example.test/video' }); },
  joinWatchRoom(code) { calls.push(['join', code]); return Promise.resolve({ id: code, joinCode: code, mediaUrl: 'https://example.test/video' }); },
  readWatchRoom(id) { calls.push(['readRoom', id]); return roomRead?.promise || Promise.resolve({ participants: [] }); },
  sendRoomMessage(...args) { calls.push(['roomUser', ...args]); return Promise.resolve(); },
  sendRoomAiMessage(...args) { calls.push(['roomAi', ...args]); return Promise.resolve(); },
  leaveWatchRoom(id) { calls.push(['leave', id]); return Promise.resolve(); },
  subscribeRoomEvents(id, handlers) { roomEvents = handlers; calls.push(['subscribe', id]); return () => calls.push(['unsubscribe', id]); },
});
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
  name: 'cast-lifecycle-fixture', enforce: 'pre',
  transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/DlnaCastPlayer.jsx')) {
      return code.replace('"./dlna-receiver"', '"virtual:cast-native"').replace('"./api.js"', '"virtual:cast-api"').replace('"./co-watch"', '"virtual:cast-co-watch"').replace('"./watch-room"', '"virtual:cast-room"');
    }
    if (id.replaceAll('\\', '/').endsWith('/room-invite.js')) return code.replace('"./api.js"', '"virtual:cast-api"');
  },
  resolveId(id) { if (id.startsWith('virtual:cast-')) return '\0' + id; },
  load(id) {
    const prefix = '\0virtual:cast-';
    if (!id.startsWith(prefix)) return;
    const names = {
      api: ['apiFetch', 'apiRequest'],
      'co-watch': ['readActiveCoWatchSession', 'createCoWatchSession', 'sendCoWatchReply'],
      room: ['createWatchRoom', 'joinWatchRoom', 'readWatchRoom', 'sendRoomMessage', 'sendRoomAiMessage', 'subscribeRoomEvents', 'leaveWatchRoom'],
    }[id.slice(prefix.length)];
    if (id === prefix + 'native') return 'export const DlnaReceiver=globalThis.__castFixture.plugin;';
    return names.map(name => `export const ${name}=(...args)=>globalThis.__castFixture.${name}(...args);`).join('\n');
  },
}] });
let tree;
const mount = async (Player, props = {}, strict = false) => {
  await act(async () => { tree = TestRenderer.create(strict ? React.createElement(React.StrictMode, null, React.createElement(Player, props)) : React.createElement(Player, props)); });
};
const unmount = async () => { if (tree) { await act(async () => tree.unmount()); tree = null; } };
const text = () => JSON.stringify(tree.toJSON());
const button = label => tree.root.findAllByType('button').find(node => node.children.join('') === label);
const input = placeholder => tree.root.findAllByType('input').find(node => node.props.placeholder === placeholder);
const count = name => calls.filter(call => call[0] === name).length;
const emit = async (name, event) => { await act(async () => { listeners.filter(entry => entry.name === name && !entry.removed).forEach(entry => entry.callback(event)); }); };
async function invite(code) {
  await act(async () => { storage.set(pendingKey, JSON.stringify({ code })); events.dispatchEvent(new Event('dengta:room-invite')); });
}
try {
  const { default: Player } = await vite.ssrLoadModule('/src/DlnaCastPlayer.jsx');

  listenerDelay = true;
  await mount(Player);
  assert.deepEqual(listeners.map(entry => entry.name), ['castChat', 'castFrame', 'castPosition']);
  await unmount();
  await act(async () => listeners.forEach(entry => entry.ready.resolve(entry.handle)));
  assert.ok(listeners.every(entry => entry.removed), 'listener handles arriving after unmount are removed');
  listeners.forEach(entry => entry.callback({ text: '迟到事件' }));
  assert.equal(count('readSession'), 0, 'late callbacks are inert');

  reset();
  await mount(Player, { info: { uri: 'https://example.test/a' } }, true);
  assert.equal(count('launch'), 1, 'StrictMode launches once');
  await act(async () => launches[0].reject(new Error('fixture failure')));
  assert.ok(text().includes('播放器打开失败'));
  await act(async () => button('重试打开播放器').props.onClick());
  assert.equal(count('launch'), 2, 'same URL can retry after failure');
  await act(async () => launches[1].resolve());
  await emit('castPosition', { positionMs: 65000, durationMs: 125000 });
  assert.ok(text().includes('1:05')); assert.ok(text().includes('2:05'));
  await act(async () => tree.root.findAllByType('button').find(node => node.props.title === '暂停').props.onClick());
  assert.ok(text().includes('请在原生播放器内操作'));
  assert.ok(tree.root.findAllByType('button').some(node => node.props.title === '暂停'), 'failed pause does not fake success');
  playbackResult = deferred();
  const pause = tree.root.findAllByType('button').find(node => node.props.title === '暂停');
  await act(async () => { pause.props.onClick(); pause.props.onClick(); });
  assert.equal(count('control'), 2, 'one failed request plus one in flight; rapid clicks do not duplicate native commands');
  await act(async () => playbackResult.resolve({ playWhenReady: false, speed: 1.5, positionMs: 70000, durationMs: 125000 }));
  assert.ok(tree.root.findAllByType('button').some(node => node.props.title === '播放'));
  assert.ok(text().includes('1:10')); assert.ok(text().includes('1.5'));
  await unmount();
  assert.ok(listeners.every(entry => entry.removed));

  reset(); captureResult = deferred();
  await mount(Player, { info: { uri: 'https://example.test/a' } });
  const captureButton = () => tree.root.findAllByType('button').find(node => node.props.title === '截帧');
  await act(async () => { captureButton().props.onClick(); captureButton().props.onClick(); });
  assert.equal(count('capture'), 1, 'rapid clicks cannot request two saved images');
  assert.equal(captureButton().props.disabled, true);
  assert.ok(!text().includes('截帧已保存'), 'starting an action is not a saved-image receipt');
  await act(async () => captureResult.resolve({ completed: true, saved: true, fileName: 'fixture.png' }));
  assert.ok(text().includes('截帧已保存到应用图片目录'));
  assert.equal(captureButton().props.disabled, false);
  captureResult = deferred();
  await act(async () => { void captureButton().props.onClick(); });
  await act(async () => captureResult.resolve({ completed: true, saved: false }));
  assert.ok(text().includes('截帧未完成'));
  assert.ok(!text().includes('截帧已保存'));
  captureResult = deferred();
  await act(async () => { void captureButton().props.onClick(); });
  await unmount();
  await act(async () => captureResult.resolve({ completed: true, saved: true }));
  assert.equal(count('capture'), 3);

  reset(); playbackRead = deferred(); playbackResult = deferred();
  await mount(Player, { info: { uri: 'https://example.test/a' } });
  await act(async () => launches[0].resolve());
  await act(async () => tree.root.findAllByType('button').find(node => node.props.title === '暂停').props.onClick());
  await act(async () => playbackResult.resolve({ playWhenReady: false, speed: 1, positionMs: 10000, durationMs: 125000 }));
  await act(async () => playbackRead.resolve({ playWhenReady: true, speed: 2, positionMs: 5000, durationMs: 125000 }));
  assert.ok(tree.root.findAllByType('button').some(node => node.props.title === '播放'), 'state read started before pause cannot overwrite the command acknowledgement');
  await act(async () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); });
  const readsBeforeHidden = count('playbackState');
  await act(async () => doc.dispatchEvent(new Event('visibilitychange')));
  assert.equal(count('playbackState'), readsBeforeHidden, 'hidden page does not request native state');
  playbackRead = deferred();
  await act(async () => { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(count('playbackState'), readsBeforeHidden + 1);
  await act(async () => playbackRead.resolve({ playWhenReady: false, speed: 1.5, positionMs: 73000, durationMs: 125000 }));
  assert.ok(text().includes('1:13')); assert.ok(text().includes('1.5'));
  await unmount();
  const afterUnmount = count('playbackState');
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(count('playbackState'), afterUnmount, 'visibility listener is removed');

  reset();
  await mount(Player, { info: { uri: 'https://example.test/a' } });
  await act(async () => tree.update(React.createElement(Player, { info: { uri: 'https://example.test/b' } })));
  await act(async () => launches[1].resolve());
  await act(async () => launches[0].reject(new Error('stale launch')));
  assert.ok(!text().includes('播放器打开失败'), 'old media cannot overwrite current launch result');
  assert.ok(button('🎬 创建放映厅') && !button('🎬 创建放映厅').props.disabled, 'room creation stays accessible after receiving media');
  await invite('INVITEC');
  await act(async () => inviteRequests[0].resolve({ room: { title: '播放中的邀请' } }));
  assert.ok(text().includes('播放中的邀请'), 'invites are visible in player view too');
  await unmount();

  reset(); storage.set(pendingKey, JSON.stringify({ code: 'INVITEA' }));
  await mount(Player);
  await invite('INVITEB');
  await act(async () => inviteRequests[1].resolve({ room: { title: '新邀请 B', hostName: '测试主人' } }));
  await act(async () => inviteRequests[0].resolve({ room: { title: '旧邀请 A' } }));
  assert.ok(text().includes('新邀请 B')); assert.ok(!text().includes('旧邀请 A'));
  await invite('INVITEB');
  assert.ok(text().includes('新邀请 B'), 'repeated deep link retains loaded invitation');
  await act(async () => button('拒绝').props.onClick());
  assert.equal(storage.has(pendingKey), false);
  await unmount();

  reset(); activeRead = deferred(); replyRead = deferred(); frameRead = deferred();
  await mount(Player, { info: { uri: 'https://example.test/a' }, aiName: '旧名称' });
  await act(async () => tree.update(React.createElement(Player, { info: { uri: 'https://example.test/a', title: '新标题' }, aiName: '新名称' })));
  await emit('castChat', { text: '原生问题', positionMs: 7000 });
  await emit('castFrame', { frameBase64: 'YQ==' });
  await emit('castFrame', { frameBase64: 'Yg==' });
  assert.equal(count('readSession'), 1, 'chat and frame share the in-flight session lookup');
  await act(async () => activeRead.resolve(null));
  assert.equal(count('createSession'), 1);
  assert.equal(calls.find(call => call[0] === 'createSession')[1].title, '新标题', 'listeners read current props');
  assert.equal(count('frame'), 1, 'overlapping frames do not pile up');
  await act(async () => replyRead.resolve({ reaction: '本轮回应' }));
  assert.equal(calls.find(call => call[0] === 'showReply')[1].aiName, '新名称');
  await unmount();
  await act(async () => frameRead.resolve({ ok: true, json: async () => ({ reaction: '迟到画面' }) }));
  assert.equal(count('showReaction'), 0, 'late frame result cannot display after unmount');

  reset(); replyRead = deferred();
  await mount(Player, { info: { uri: 'https://example.test/a' } });
  await act(async () => input('输入消息…').props.onChange({ target: { value: '网页问题' } }));
  await act(async () => button('发送').props.onClick());
  assert.equal(count('reply'), 1, 'web chat reaches the real co-watch reply API without an unavailable native method');
  await unmount();
  await act(async () => replyRead.resolve({ reaction: '迟到聊天' }));
  assert.equal(count('showReply'), 0);

  reset(); replyRead = deferred();
  await mount(Player);
  await act(async () => input('输入邀请码加入…').props.onChange({ target: { value: 'ROOMAA' } }));
  await act(async () => button('加入').props.onClick());
  await emit('castChat', { text: '房间问题' });
  const staleEvents = roomEvents;
  roomRead = deferred();
  await act(async () => staleEvents.onParticipantLeave());
  await act(async () => button('退出').props.onClick());
  await act(async () => {
    staleEvents.onMessage({ content: '旧房间事件' });
    roomRead.resolve({ room: { id: 'ROOMAA', joinCode: 'ROOMAA', mediaUrl: 'https://example.test/a' } });
    replyRead.resolve({ reaction: '离开后的回应' });
  });
  assert.equal(count('roomAi'), 0, 'late AI reply is not sent to a departed room');
  assert.ok(!text().includes('旧房间事件'));
  assert.ok(button('加入'), 'late room refresh does not resurrect a departed room');
  await unmount();
  console.log('DLNA lifecycle passed: late listener cleanup, StrictMode/retry, real progress, truthful controls, invitation race, current props, shared session, frame backpressure, web chat and departed-room isolation.');
} finally {
  await unmount(); await vite.close();
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}
