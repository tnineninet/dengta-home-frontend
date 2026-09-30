import assert from 'node:assert/strict';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map(), calls = [];
globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval };
globalThis.__duelRequest = (_path, options) => new Promise((resolve, reject) => calls.push({ options, resolve, reject }));
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  plugins: [{ name: 'duel-api-fixture', enforce: 'pre', load(id) {
    if (id.replaceAll('\\', '/').endsWith('/src/api.js')) return 'export const apiRequest = (...args) => globalThis.__duelRequest(...args);';
  } }] });
let tree;
try {
  const { default: Duel } = await vite.ssrLoadModule('/src/IntimateDuel.jsx');
  const render = async companionScope => act(async () => { tree = TestRenderer.create(React.createElement(Duel, { accountScope: 'fictional-a', companionScope, aiName: 'Fixture', userName: 'Tester' })); });
  await render('companion-a');
  const firstButton = tree.root.findAllByType('button').find(node => String(node.props.className || '').includes('recover') === false && node.props.disabled === false && node.findAllByType('strong').length > 0);
  let run;
  await act(async () => { run = firstButton.props.onClick(); void firstButton.props.onClick(); });
  assert.equal(calls.length, 1, 'two clicks in the same tick start only one round');
  const restart = tree.root.findAllByType('button').find(node => node.children.some(value => typeof value === 'string' && /重开|重新/.test(value)));
  assert.ok(restart);
  await act(async () => restart.props.onClick());
  assert.equal(calls[0].options.signal.aborted, true);
  await act(async () => { calls[0].resolve({ narration: 'old stale fictional text', reaction: 'old stale reaction' }); await run; });
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /old stale/);
  assert.ok(storage.size === 1);
  await act(async () => tree.unmount());
  await render('companion-b');
  assert.equal(storage.size, 2, 'companion save slots are distinct');
  const secondButton = tree.root.findAllByType('button').find(node => node.props.disabled === false && node.findAllByType('strong').length > 0);
  await act(async () => { run = secondButton.props.onClick(); });
  await act(async () => { calls[1].resolve({ refused: true }); await run; });
  const saved = [...storage.entries()].find(([key]) => key.includes('companion-b'));
  assert.equal(JSON.parse(saved[1]).round, 1, 'failed round restores resources and round state');
  await act(async () => tree.unmount());
  console.log('duel request lifecycle passed: double click, restart, companion scope, refusal rollback');
} finally { if (tree) await act(async () => tree.unmount()); await vite.close(); delete globalThis.__duelRequest; }
