import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
  name: 'takeout-api-fixture', enforce: 'pre',
  transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/takeout-executor.js')) return code.replace('"./api.js"', '"virtual:takeout-api"'); },
  resolveId(id) { if (id === 'virtual:takeout-api') return '\0' + id; },
  load(id) { if (id === '\0virtual:takeout-api') return 'export const apiRequest=()=>{throw Error("unexpected real API call")};'; },
}] });
const descriptors = new Map();
function stub(name, value) { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value, writable: true }); }
const interval = [], timeout = [], storage = new Map(), listeners = new Map();
stub('setInterval', fn => { interval.push(fn); return interval.length; });
stub('setTimeout', fn => { timeout.push(fn); return timeout.length; });
stub('clearInterval', () => {}); stub('clearTimeout', () => {});
stub('window', { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  addEventListener: (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
  removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
  dispatchEvent: event => { for (const callback of listeners.get(event.type) || []) callback(event); return true; },
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
try {
  const { executeTakeoutCommand, resumeTakeoutPage, startTakeoutRunner, stopTakeoutAutomation } = await vite.ssrLoadModule('/src/takeout-executor.js');
  const resumeUnavailable = await resumeTakeoutPage({ capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false } });
  assert.equal(resumeUnavailable.ok, false);
  assert.equal(resumeUnavailable.code, 'takeout_native_unavailable');
  const command = { id: 'fixture-command', command: { action: 'order', requirement: '虚构餐品', shop_name: '虚构店铺' } };
  let opens = 0; const calls = [];
  const plugin = { orderProduct: async () => { opens++; return { added: true }; }, searchShops: async () => { opens++; return { shops: [] }; } };
  const client = async path => { calls.push(path); if (path.endsWith('/result')) throw Error('fixture network error with private text'); return {}; };
  const result = await executeTakeoutCommand(command, { client, plugin });
  assert.equal(opens, 1); assert.equal(result.ok, true); assert.equal(result.receipt_synced, false);
  assert.equal(result.code, 'takeout_result_sync_failed');
  assert.equal(calls.some(path => path.endsWith('/failure')), false, 'receipt failure must not mark native success as failure');
  const failureBodies = [];
  const failure = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => { throw Error('fixture private text'); } }, client: async (path, options) => { if (path.endsWith('/failure')) failureBodies.push(options.body); return {}; } });
  assert.equal(failure.code, 'takeout_native_execution_failed'); assert.equal(failure.receipt_synced, true);
  assert.ok(failureBodies.every(body => !body.includes('fixture private text')));
  for (const [status, code] of [['logged_out','takeout_login_expired'],['verification','takeout_verification_required'],['shop_not_found','takeout_shop_not_found'],['product_not_found','takeout_product_not_found'],['over_limit','takeout_budget_exceeded'],['error','takeout_page_execution_failed']]) {
    let body;
    const outcome = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => ({ status, error: 'fixture private text' }) }, client: async (path, options) => { if (path.endsWith('/result')) body = options.body; return {}; } });
    assert.equal(outcome.ok, false); assert.equal(outcome.code, code); assert.ok(!body.includes('fixture private text'));
  }
  for (const code of ['takeout_page_init_failed','takeout_page_renderer_failed','takeout_page_interrupted','takeout_page_not_ready','takeout_page_touch_unavailable','takeout_page_load_failed','browser_account_restore_required']) {
    for (const action of ['search','order']) {
      let resultBody;
      const nativeValue = { status: 'error', code, error: 'fictional private cause' };
      const nativePlugin = { searchShops: async () => nativeValue, orderProduct: async () => nativeValue };
      const outcome = await executeTakeoutCommand({ ...command, command: { action, requirement: 'fictional' } }, { plugin: nativePlugin, client: async (path, options) => { if (path.endsWith('/result')) resultBody = JSON.parse(options.body); return {}; } });
      assert.equal(outcome.ok, false); assert.equal(outcome.code, code); assert.equal(outcome.receipt_synced, true);
      assert.equal(resultBody.result.code, code); assert.equal(resultBody.result.error, outcome.message);
      assert.ok(!JSON.stringify(resultBody).includes('fictional private cause'));
    }
    let failureBody;
    const outcome = await executeTakeoutCommand({ ...command, command: { action: 'search', requirement: 'fictional' } }, {
      plugin: { searchShops: async () => { throw Object.assign(Error('fictional private cause'), { code }); } },
      client: async (path, options) => { if (path.endsWith('/failure')) failureBody = JSON.parse(options.body); return {}; },
    });
    assert.equal(outcome.code, code); assert.equal(outcome.ok, false); assert.equal(outcome.receipt_synced, true);
    assert.equal(failureBody.message, outcome.message); assert.ok(!outcome.message.includes('fictional private cause'));
    const loggedOut = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => ({ status: 'logged_out', code }) }, client: async () => ({}) });
    assert.equal(loggedOut.code, 'takeout_login_expired', 'a technical code must not replace an existing explicit status');
  }
  const unknownNative = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => ({ status: 'error', code: 'fictional_private_provider_code', error: 'fictional private cause' }) }, client: async () => ({}) });
  assert.equal(unknownNative.code, 'takeout_page_execution_failed'); assert.ok(!JSON.stringify(unknownNative).includes('fictional_private_provider_code'));
  const unknownReject = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => { throw Object.assign(Error('fictional private cause'), { code: 'fictional_private_provider_code' }); } }, client: async () => ({}) });
  assert.equal(unknownReject.code, 'takeout_native_execution_failed'); assert.ok(!JSON.stringify(unknownReject).includes('fictional private cause'));
  const incomplete = await executeTakeoutCommand({ ...command, command: { action: 'search', requirement: 'fixture' } }, { plugin: { searchShops: async () => ({ loading: true, shops: [] }) }, client: async () => ({}) });
  assert.equal(incomplete.code, 'takeout_search_incomplete'); assert.equal(incomplete.ok, false);
  const malformed = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => null }, client: async () => ({}) });
  assert.equal(malformed.code, 'takeout_native_result_invalid');
  const invalid = await executeTakeoutCommand({ ...command, command: { action: 'invalid', requirement: 'fixture' } }, { client: async () => ({}), plugin });
  assert.equal(invalid.code, 'takeout_command_invalid'); assert.equal(opens, 1);
  let menuInput, orderInput;
  const menuResult = await executeTakeoutCommand({ ...command, command: { action: 'menu', requirement: '看看菜单', shop_name: '虚构准确店名' } }, {
    scope: 'fictional-menu-scope', client: async () => ({}), plugin: { inspectMenu: async input => { menuInput = input; return { status: 'done', products: [{ name: '番茄饭', price: 18, available: true }] }; } },
  });
  assert.deepEqual(menuInput, { shopName: '虚构准确店名', scope: 'fictional-menu-scope' });
  assert.equal(menuResult.ok, true); assert.equal(menuResult.action, 'menu'); assert.equal(menuResult.products[0].name, '番茄饭');
  const cartResult = await executeTakeoutCommand({ ...command, command: { ...command.command, product_name: '准确餐品', budget_max: 35, note: '少盐', quantity: 2 } }, {
    scope: 'fictional-order-scope', client: async () => ({}), plugin: { orderProduct: async input => { orderInput = input; return { status: 'manual_review', code: 'takeout_quantity_unverified', paymentSubmitted: false }; } },
  });
  assert.deepEqual(orderInput, { shopName: '虚构店铺', product: '准确餐品', quantity: 2, maxAmount: 35, note: '少盐', scope: 'fictional-order-scope' });
  assert.equal(cartResult.ok, false); assert.equal(cartResult.code, 'takeout_quantity_unverified');
  const unverified = await executeTakeoutCommand(command, { client: async () => ({}), plugin: { orderProduct: async () => ({ status: 'ready_for_payment', items: 1, total: null, paymentSubmitted: false }) } });
  assert.equal(unverified.ok, false); assert.equal(unverified.code, 'takeout_cart_unverified');
  const candidates = await executeTakeoutCommand(command, { client: async () => ({}), plugin: { orderProduct: async () => ({ status: 'product_not_found', candidates: ['虚构备选菜'] }) } });
  assert.equal(candidates.code, 'takeout_product_not_found');
  assert.deepEqual(candidates.candidates, ['虚构备选菜']);
  const verified = await executeTakeoutCommand(command, { client: async () => ({}), plugin: { orderProduct: async () => ({ status: 'ready_for_payment', items: 1, total: 18, lines: [{ name: '虚构餐品', quantity: 1 }], paymentSubmitted: false }) } });
  assert.equal(verified.ok, true); assert.equal(verified.status, 'ready_for_payment');
  const manual = await executeTakeoutCommand(command, { client: async () => ({}), plugin: { orderProduct: async () => ({ status: 'manual_review' }) } });
  assert.equal(manual.ok, false); assert.equal(manual.code, 'takeout_manual_review_required');
  let active = true; const ack = deferred();
  const stoppedExecution = executeTakeoutCommand(command, { client: () => ack.promise, plugin, shouldContinue: () => active });
  active = false; ack.resolve({}); assert.equal(await stoppedExecution, null); assert.equal(opens, 1);

  const capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true };
  const pending = deferred(); let polls = 0, done = 0, signal;
  const stop = startTakeoutRunner({ scope: 'fixture-account-companion', capacitor, plugin, onCommandDone: () => { done++; }, client: async (path, options) => { signal = options.signal; if (path.endsWith('/pending')) { polls++; return pending.promise; } return {}; } });
  interval.at(-1)(); interval.at(-1)(); timeout.at(-1)(); await settle();
  assert.equal(polls, 1, 'slow reads cannot overlap');
  stop(); assert.equal(signal.aborted, true); pending.resolve({ commands: [command] }); await settle();
  assert.equal(opens, 1); assert.equal(done, 0);
  const native = deferred();
  const oldStop = startTakeoutRunner({ scope: 'old-companion', capacitor, plugin: { orderProduct: async () => { opens++; return native.promise; } }, onCommandDone: () => { done++; }, client: async path => path.endsWith('/pending') ? { commands: [command] } : (calls.push(path), {}) });
  interval.at(-1)(); await settle(); oldStop(); const before = calls.length;
  native.resolve({ added: true }); await settle();
  assert.equal(calls.length, before, 'late native completion cannot report in the new scope'); assert.equal(done, 0);
  assert.ok(storage.has('dengta_takeout_attempted_v2:old-companion'));
  const freshStop = startTakeoutRunner({ scope: 'new-companion', capacitor, plugin, client: async path => path.endsWith('/pending') ? { commands: [command] } : {} });
  interval.at(-1)(); await settle(); freshStop();
  assert.equal(opens, 3, 'old companion marker cannot suppress a new companion command');
  assert.equal(storage.has('dengta_takeout_attempted_v2:new-companion'), false);
  const errorStop = startTakeoutRunner({ scope: 'error-companion', capacitor, plugin: { orderProduct: async () => ({ status: 'logged_out', error: 'fixture private text' }) }, client: async path => path.endsWith('/pending') ? { commands: [command] } : {} });
  interval.at(-1)(); await settle(); errorStop();
  const { readOperationFailures } = await vite.ssrLoadModule('/src/operation-diagnostics.js');
  const entries = readOperationFailures('error-companion');
  assert.equal(entries[0].code, 'DT-TAKEOUT'); assert.equal(entries[0].reasonCode, 'takeout_login_expired');
  assert.ok(!JSON.stringify(entries).includes('fixture private text'));
  assert.equal(readOperationFailures('new-companion').length, 0);
  for (const code of ['takeout_page_init_failed','takeout_page_renderer_failed','takeout_page_interrupted','takeout_page_not_ready','takeout_page_touch_unavailable','takeout_page_load_failed','browser_account_restore_required']) {
    const scope = 'fictional-' + code;
    const codeStop = startTakeoutRunner({ scope, capacitor,
      plugin: { searchShops: async () => { throw Object.assign(Error('fictional private cause'), { code }); } },
      client: async path => path.endsWith('/pending') ? { commands: [{ ...command, command: { action: 'search', requirement: 'fictional' } }] } : {},
    });
    interval.at(-1)(); await settle(); codeStop();
    const diagnostics = readOperationFailures(scope);
    assert.equal(diagnostics[0].reasonCode, code); assert.equal(diagnostics[0].code, 'DT-TAKEOUT');
    assert.ok(!JSON.stringify(diagnostics).includes('fictional private cause'));
  }
  const search = deferred(), cancelledScopes = [], searchInputs = [], searchCalls = [];
  const searchStop = startTakeoutRunner({ scope: 'fictional-search-old', capacitor,
    plugin: { searchShops: input => { searchInputs.push(input); return search.promise; }, cancelSearch: async input => cancelledScopes.push(input.scope) },
    onCommandDone: () => { done++; }, client: async path => { searchCalls.push(path); return path.endsWith('/pending') ? { commands: [{ ...command, command: { action: 'search', requirement: '虚构店铺' } }] } : {}; },
  });
  interval.at(-1)(); await settle();
  assert.equal(searchInputs[0].scope, 'fictional-search-old');
  searchStop(); searchStop(); assert.deepEqual(cancelledScopes, ['fictional-search-old']);
  const beforeSearch = searchCalls.length;
  search.resolve({ shops: [{ name: '虚构店铺' }] }); await settle();
  assert.equal(searchCalls.length, beforeSearch, 'cancelled search cannot post into a later identity');
  assert.equal(done, 0);
  let failedOtherDevice = false;
  storage.set('dengta_takeout_attempted_v2:claimed-elsewhere', JSON.stringify({ id: command.id }));
  const collisionStop = startTakeoutRunner({ scope: 'claimed-elsewhere', capacitor, plugin, client: async path => {
    if (path.endsWith('/pending')) return { commands: [command] };
    if (path.endsWith('/ack')) throw Object.assign(Error('already claimed'), { status: 409 });
    if (path.endsWith('/failure')) failedOtherDevice = true;
    return {};
  } });
  interval.at(-1)(); await settle(); collisionStop(); assert.equal(failedOtherDevice, false);
  const work = deferred(), updates = [], starts = []; let wakePolls = 0;
  const wakeStop = startTakeoutRunner({ scope: 'fictional-live-panel', capacitor,
    plugin: { inspectMenu: () => work.promise }, onCommandStart: item => starts.push(item.id), onProgress: (item, text) => updates.push([item.id, text]),
    client: async path => { if (path.endsWith('/pending')) { wakePolls++; return { commands: [{ ...command, command: { action: 'menu', requirement: '虚构店铺', shop_name: '虚构店铺' } }] }; } return {}; },
  });
  const wakeHandler = [...listeners.get('dengta:takeout-wake')][0];
  const intervalsBeforeWake = interval.length;
  wakeHandler(); wakeHandler(); await settle();
  assert.equal(wakePolls, 1, 'wakes cannot duplicate a claimed native operation');
  assert.equal(interval.length, intervalsBeforeWake + 1, 'a burst reuses one interval');
  assert.deepEqual(starts, [command.id]); assert.equal(updates[0][0], command.id); assert.match(updates[0][1], /菜单/);
  const pollsBeforeStop = wakePolls;
  wakeStop(); assert.equal(listeners.get('dengta:takeout-wake').size, 0);
  work.resolve({ status: 'done', products: [] }); await settle(); wakeHandler(); interval.at(-1)(); await settle();
  assert.equal(wakePolls, pollsBeforeStop, 'stopped listeners and timers cannot restart the previous identity');
  const nativeWait = deferred(), cancelled = [], pendingItems = [], pausedOutcomes = []; let pausedOpens = 0;
  const pausePlugin = { orderProduct: () => { pausedOpens++; return nativeWait.promise; }, cancelSearch: async input => { cancelled.push(input.scope); nativeWait.resolve({ status: 'manual_review' }); } };
  const pauseClient = async path => {
    if (path.endsWith('/pending')) return { commands: pendingItems.slice() };
    if (path.endsWith('/cancel')) { const id = path.split('/').at(-2); const index = pendingItems.findIndex(item => item.id === id); if (index >= 0) pendingItems.splice(index, 1); cancelled.push(id); }
    return {};
  };
  pendingItems.push(command);
  const pauseStop = startTakeoutRunner({ scope: 'fictional-pause', capacitor, plugin: pausePlugin, client: pauseClient, onCommandDone: (item, outcome) => pausedOutcomes.push({ item, outcome }) });
  interval.at(-1)(); await settle(); assert.equal(pausedOpens, 1);
  const pausedResult = await stopTakeoutAutomation({ scope: 'fictional-pause', capacitor, plugin: pausePlugin });
  assert.equal(pausedResult.ok, true); await settle();
  assert.ok(storage.has('dengta_takeout_paused_v1:fictional-pause'));
  pendingItems.push({ ...command, id: 'fictional-late-command' }); interval.at(-1)(); await settle();
  assert.equal(pausedOpens, 1); assert.ok(cancelled.includes('fictional-late-command'));
  assert.equal(pausedOutcomes.at(-1).outcome.code, 'takeout_automation_paused');
  pauseStop();
  let restartOpens = 0;
  const restartStop = startTakeoutRunner({ scope: 'fictional-pause', capacitor, plugin: { orderProduct: async () => { restartOpens++; return { added: true }; } }, client: pauseClient });
  pendingItems.push({ ...command, id: 'fictional-stale-after-restart' }); interval.at(-1)(); await settle();
  assert.equal(restartOpens, 0); assert.ok(cancelled.includes('fictional-stale-after-restart'), 'saved pause cancels old pending work after restart');
  const resumeHandler = [...listeners.get('dengta:takeout-wake')][0]; await resumeHandler({ detail: { scope: 'fictional-pause' } }); await settle();
  assert.equal(storage.has('dengta_takeout_paused_v1:fictional-pause'), false);
  restartStop();
  storage.set('dengta_takeout_paused_v1:fictional-offline-resume', JSON.stringify({ paused: true }));
  const resumeErrors = [];
  const offlineStop = startTakeoutRunner({ scope: 'fictional-offline-resume', capacitor, plugin,
    onCommandDone: (item, outcome) => resumeErrors.push({ item, outcome }), client: async () => { throw Error('fictional offline'); },
  });
  await [...listeners.get('dengta:takeout-wake')][0]({ detail: { scope: 'fictional-offline-resume' } });
  assert.equal(resumeErrors[0].item, null); assert.equal(resumeErrors[0].outcome.code, 'takeout_previous_attempt_unknown');
  assert.ok(storage.has('dengta_takeout_paused_v1:fictional-offline-resume'), 'failed cancellation cannot reopen the pause gate');
  offlineStop();
  console.log('takeout lifecycle regression passed: receipt failures, invalid commands, polling lock, scope cancellation and scoped markers');
} finally {
  for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  await vite.close();
}
