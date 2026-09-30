import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const saved = { id: "fixture-list", name: "虚构测试歌单", itemCount: 1, items: [{ id: "fixture-track", title: "虚构歌曲", url: "https://media.example.test/audio.mp3", playbackMode: "direct_https" }] };
const descriptors = new Map();
function stub(name, value) { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value, writable: true }); }
const doc = new EventTarget(); doc.visibilityState = "visible"; doc.body = { style: { overflow: "auto" } };
let restored = 0;
doc.activeElement = { isConnected: true, focus() { restored++; } };
const values = new Map();
const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
stub("window", win); stub("document", doc); stub("IS_REACT_ACT_ENVIRONMENT", true);
let imports = 0, notified = 0, failNotification = false, connected = false, searches = 0;
stub("__musicFixture", {
  listMusicPlaylists: async () => [], listMusicFavorites: async () => [], listNeteaseConnections: async () => [],
  importMusicPlaylist: async () => { imports++; return saved; },
  importNeteaseShare: async () => { imports++; return saved; },
  getMusicPlaylist: async () => saved,
  readNeteaseCookieSession: async () => ({ session: { connected } }),
  cookieSearchNetease: async query => { assert.equal(query, '虚构歌名'); searches++; return []; },
});
const functions = ['listMusicPlaylists', 'listMusicFavorites', 'listNeteaseConnections', 'importMusicPlaylist', 'importNeteaseShare', 'getMusicPlaylist', 'readNeteaseCookieSession', 'connectNeteaseMcp', 'cookieGetDailyRecommend', 'cookieGetMyPlaylists', 'cookieGetPlayHistory', 'cookieGetPlaylistTracks', 'cookieLikeSong', 'cookieSearchNetease', 'deleteMusicFavorite', 'clearNeteaseCookieSession', 'saveNeteaseCookieSession', 'putMusicFavorite', 'requestExternalMusicPlayback', 'deleteMusicPlaylist', 'getNeteaseConnectionStatus', 'getNeteasePlaylist', 'listNeteasePlaylists', 'searchNeteaseMusic', 'uploadLocalMusicFile'];
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "music-import-fixture", enforce: "pre",
  transform(code, id) {
    if (/\/(MusicSettings|TogetherMusic)\.jsx$/.test(id.replaceAll('\\', '/'))) return code.replace('"./music-listening.js"', '"virtual:music-api"');
    if (id.replaceAll('\\', '/').endsWith('/MusicImportDialog.jsx')) return code.replace('"react-dom"', '"virtual:music-portal"');
  },
  resolveId(id) { if (id.startsWith('virtual:music-')) return '\0' + id; },
  load(id) {
    if (id === '\0virtual:music-portal') return 'export const createPortal=children=>children;';
    if (id === '\0virtual:music-api') return 'export {detectNeteaseShare} from "/src/music-listening.js";\n' + functions.map(name => `export const ${name}=(...args)=>globalThis.__musicFixture.${name}?.(...args)??Promise.resolve({});`).join('\n');
  },
}] });
let tree;
const unmount = async () => { if (tree) { await act(async () => tree.unmount()); tree = null; } };
try {
  const { default: Settings } = await vite.ssrLoadModule('/src/MusicSettings.jsx');
  await act(async () => { tree = TestRenderer.create(React.createElement(Settings, { compact: true, onImported: async data => { assert.equal(data.id, saved.id); notified++; if (failNotification) throw Error('fixture refresh failure'); } })); });
  const area = () => tree.root.findByType('textarea');
  const importButton = () => tree.root.findAllByType('button').find(node => node.children.join('') === '导入歌单');
  await act(async () => area().props.onChange({ target: { value: 'https://media.example.test/audio.mp3' } }));
  const submit = importButton();
  await act(async () => { void submit.props.onClick(); void submit.props.onClick(); });
  assert.equal(imports, 1, 'same-tick imports perform one save'); assert.equal(notified, 1);
  failNotification = true;
  await act(async () => area().props.onChange({ target: { value: 'https://media.example.test/next.mp3' } }));
  await act(async () => importButton().props.onClick());
  assert.ok(JSON.stringify(tree.toJSON()).includes('无需重复导入'), 'post-save player refresh failure must not become a failed save');
  assert.equal(imports, 2); await unmount();

  const { default: Music } = await vite.ssrLoadModule('/src/TogetherMusic.jsx');
  await act(async () => { tree = TestRenderer.create(React.createElement(Music, { request: { id: 'request-1', query: '虚构歌名' } })); });
  await act(async () => tree.root.findAllByType('button').find(node => node.children.filter(value => typeof value === 'string').join('') === '导入歌曲').props.onClick());
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'https://media.example.test/audio.mp3' } }));
  await act(async () => tree.root.findAllByType('button').find(node => node.children.join('') === '导入歌单').props.onClick());
  assert.ok(!tree.root.findAll(node => node.props.role === 'dialog').length, 'successful import closes the sheet');
  assert.ok(tree.root.findAllByType('select').some(node => node.props.value === saved.id), 'newly imported playlist is selected immediately');
  assert.ok(JSON.stringify(tree.toJSON()).includes('虚构歌曲')); await unmount();
  connected = true;
  await act(async () => { tree = TestRenderer.create(React.createElement(Music, { request: { id: 'request-search', query: '虚构歌名' } })); });
  assert.equal(searches, 1, 'connected activity searches the requested song once');
  await act(async () => tree.update(React.createElement(Music, { request: { id: 'request-search', query: '虚构歌名' } })));
  assert.equal(searches, 1, 'rerender does not repeat the automatic search'); await unmount();

  const { default: Dialog } = await vite.ssrLoadModule('/src/MusicImportDialog.jsx');
  let closed = 0;
  const panel = { querySelector: () => ({ focus() {} }), querySelectorAll: () => [], contains: () => false, focus() {} };
  await act(async () => { tree = TestRenderer.create(React.createElement(Dialog, { onClose: () => { closed++; } }, React.createElement('p', null, '虚构导入内容')), { createNodeMock: node => node.props.role === 'dialog' ? panel : {} }); });
  assert.equal(doc.body.style.overflow, 'hidden');
  const escape = new Event('keydown', { cancelable: true }); Object.defineProperty(escape, 'key', { value: 'Escape' });
  await act(async () => doc.dispatchEvent(escape)); assert.equal(closed, 1); assert.equal(escape.defaultPrevented, true);
  await act(async () => tree.update(React.createElement(Dialog, { busy: true, onClose: () => { closed++; } }, React.createElement('p', null, '虚构保存过程'))));
  await act(async () => doc.dispatchEvent(escape)); assert.equal(closed, 1, 'Escape cannot dismiss an in-flight import');
  await unmount(); assert.equal(doc.body.style.overflow, 'auto'); assert.ok(restored >= 1);
  console.log('Music import flow passed: one save, parent receipt, refresh failure wording, immediate playlist selection and modal cleanup.');
} finally {
  await unmount(); await vite.close();
  for (const [name, value] of descriptors) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; }
}
