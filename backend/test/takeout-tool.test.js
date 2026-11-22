const test = require('node:test');
const assert = require('node:assert/strict');
const { TAKEOUT_TOOL, createTakeoutToolExecutor } = require('../services/takeout-tool');

const scope = { userId: 'fixture-account', companionId: 'fixture-companion' };
const call = args => ({ id: 'call_1', name: 'takeout_order', arguments: JSON.stringify(args) });
function fixture(options = {}) {
  const commands = [];
  const outcomes = {
    search: { status: 'done', result: { ok: true, status: 'done', shops: [{ name: 'Fixture Kitchen', meta: 'fixture only' }] } },
    menu: { status: 'done', result: { ok: true, status: 'done', products: [{ name: 'Fixture Soup', price: 20, available: true }, { name: 'Fixture Sold Out', price: null, available: false }] } },
    order: { status: 'done', result: { ok: true, status: 'ready_for_payment', total: 20, items: 1, lines: [{ name: 'Fixture Soup', quantity: 1 }], paymentSubmitted: false } },
    ...options.outcomes
  };
  const channel = {
    async createCommand(actualScope, input) {
      assert.deepEqual(actualScope, scope);
      commands.push(input);
      await options.afterCreate?.(input);
      return { command_id: `fixture-command-${commands.length}` };
    },
    async waitForResult(actualScope, id, waitOptions) {
      assert.deepEqual(actualScope, scope);
      assert.ok(waitOptions.timeoutMs >= 60000 && waitOptions.timeoutMs <= 240000);
      return outcomes[commands.findIndex((_, index) => id === `fixture-command-${index + 1}`) >= 0 ? commands[Number(id.split('-').at(-1)) - 1].action : 'search'];
    }
  };
  return { commands, channel, execute: createTakeoutToolExecutor({ scope, channel, conversationId: 'fixture-conversation', clientMessageId: options.clientMessageId || 'fixture-turn' }) };
}

async function prepare(execute) {
  assert.equal((await execute(call({ action: 'search', requirement: 'fixture dinner' }))).ok, true);
  assert.equal((await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen' }))).ok, true);
}

test('real search/menu selection is required before exact product checkout, one command per action', async () => {
  const { execute, commands } = fixture();
  assert.equal((await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup' }))).code, 'takeout_shop_unverified');
  await execute(call({ action: 'search', requirement: 'fixture dinner' }));
  assert.equal((await execute(call({ action: 'menu', shop_name: 'Imagined Kitchen' }))).code, 'takeout_shop_unverified');
  assert.equal((await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup' }))).code, 'takeout_product_unverified');
  await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen' }));
  for (const product_name of ['Imagined Dish', 'Fixture Sold Out']) {
    assert.equal((await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name }))).code, 'takeout_product_unverified');
  }
  const args = { action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup', budget_max: 30, note: '' };
  const result = await execute(call(args));
  assert.equal(result.ok, true);
  assert.equal(result.payment_required, true);
  assert.equal(result.payment_policy, 'user_confirm');
  assert.equal(result.order_result.paymentSubmitted, false);
  assert.deepEqual(await execute(call(args)), result);
  assert.equal((await execute(call({ ...args, quantity: 2 }))).code, 'takeout_quantity_changed');
  assert.equal(commands.length, 3, 'changing the quantity never dispatches a second cart action');
  assert.deepEqual(commands.map(item => item.action), ['search', 'menu', 'order']);
  assert.equal(commands.at(-1).requirement, 'Fixture Soup');
  assert.equal(commands.at(-1).budget_max, 30);
});

test('concurrent duplicate calls share one promise; idempotency IDs persist per chat turn, not provider call ID', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const first = fixture({ afterCreate: () => blocked });
  const args = call({ action: 'search', requirement: 'fixture dinner' });
  const left = first.execute(args), right = first.execute({ ...args, id: 'different-provider-call-id' });
  assert.equal(left, right);
  release();
  assert.deepEqual(await left, await right);
  assert.equal(first.commands.length, 1);
  const retry = fixture();
  await retry.execute(args);
  assert.equal(retry.commands[0].idempotency_key, first.commands[0].idempotency_key);
  const another = fixture({ clientMessageId: 'another-turn' });
  await another.execute(args);
  assert.notEqual(another.commands[0].idempotency_key, first.commands[0].idempotency_key);
  const withoutId = createTakeoutToolExecutor({ scope, channel: retry.channel });
  const otherWithoutId = createTakeoutToolExecutor({ scope, channel: retry.channel });
  await withoutId(args); const key = retry.commands.at(-1).idempotency_key;
  await otherWithoutId(args);
  assert.notEqual(retry.commands.at(-1).idempotency_key, key);
});

test('timeouts retain original command ID and failed/incomplete read receipts do not unlock ordering', async () => {
  for (const outcome of [
    { timed_out: true, status: 'executing', progress: 'fixture waiting' },
    { status: 'done', result: { ok: false, status: 'logged_out', code: 'takeout_login_expired' } },
    { status: 'done', result: { status: 'done', loading: true, shops: [] } },
    { status: 'done', result: { status: 'done' } }
  ]) {
    const { execute, commands } = fixture({ outcomes: { search: outcome } });
    const result = await execute(call({ action: 'search', requirement: 'fixture dinner' }));
    assert.equal(result.command_id, 'fixture-command-1');
    if (outcome.timed_out) {
      assert.equal(result.timed_out, true);
      assert.equal(result.status, 'executing');
      assert.equal(result.progress, 'fixture waiting');
    } else {
      assert.equal(result.ok, false);
      if (outcome.result?.code === 'takeout_login_expired') {
        assert.equal(result.code, 'takeout_login_expired');
        assert.equal(result.status, 'logged_out');
      }
    }
    assert.equal((await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen' }))).ok, false);
    assert.equal(commands.length, 1);
  }
});

test('payment requires a verified unpaid receipt; invalid actions and private channel errors stay bounded', async () => {
  for (const patch of [{ status: 'manual_review' }, { status: 'awaiting_payment' }, { paymentSubmitted: true }, { paymentSubmitted: undefined }, { total: null }, { total: 0 }, { total: '20' }, { items: 2 }, { ok: false }, { lines: undefined }, { lines: [] }, { lines: [{ name: 'Different Dish', quantity: 1 }] }, { lines: [{ name: 'Fixture Soup', quantity: 2 }] }]) {
    const { execute } = fixture({ outcomes: { order: { status: 'done', result: { ok: true, status: 'ready_for_payment', total: 20, items: 1, lines: [{ name: 'Fixture Soup', quantity: 1 }], paymentSubmitted: false, ...patch } } } });
    await prepare(execute);
    assert.equal((await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', requirement: 'Fixture Soup' }))).ok, false);
  }
  const { execute, commands } = fixture();
  for (const action of ['pay', 'submit_order']) assert.equal((await execute(call({ action, requirement: 'fixture' }))).code, 'takeout_action_invalid');
  assert.equal((await execute({ arguments: '{' })).code, 'takeout_arguments_invalid');
  assert.equal((await execute(call({ action: 'search' }))).code, 'takeout_requirement_required');
  assert.equal((await execute(call({ action: 'search', requirement: 'fixture', budget_max: -1 }))).code, 'takeout_budget_invalid');
  assert.equal(commands.length, 0);
  const failed = createTakeoutToolExecutor({ scope, channel: { async createCommand() { throw new Error('FICTIONAL_PRIVATE_DB_ERROR'); } } });
  assert.doesNotMatch(JSON.stringify(await failed(call({ action: 'search', requirement: 'fixture' }))), /FICTIONAL_PRIVATE_DB_ERROR/);
  assert.equal((await createTakeoutToolExecutor({})(call({ action: 'search' }))).code, 'takeout_auth_required');
  assert.deepEqual(TAKEOUT_TOOL.input_schema.properties.action.enum, ['search', 'menu', 'order']);
});

test('failed or timed out phone receipts stop the remainder of this turn, and a new explicit turn starts independently', async () => {
  for (const outcome of [
    { timed_out: true, status: 'executing' },
    { status: 'failed', result: { error: 'fixture failure' } },
    { status: 'cancelled', result: null },
    { status: 'done', result: { ok: false, status: 'manual_review' } }
  ]) {
    const { execute, commands } = fixture({ outcomes: { menu: outcome } });
    await execute(call({ action: 'search', requirement: 'fixture dinner' }));
    const menu = call({ action: 'menu', shop_name: 'Fixture Kitchen' });
    await execute(menu);
    const stopped = await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup' }));
    assert.equal(stopped.code, 'takeout_flow_stopped');
    assert.equal(stopped.command_id, 'fixture-command-2');
    await execute(menu);
    assert.equal(commands.length, 2, 'replaying a failed step cannot dispatch a second page operation');
    const next = fixture({ clientMessageId: 'explicit-new-user-turn' });
    await prepare(next.execute);
    assert.equal((await next.execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup', budget_max: 30 }))).ok, true);
  }
  const limited = fixture();
  await prepare(limited.execute);
  assert.equal((await limited.execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup', budget_max: 10 }))).ok, false, 'a receipt over the requested budget cannot be announced as ready');
});
test('stated budget, note and quantity carry into later steps and cannot be widened or changed', async () => {
  const { execute, commands } = fixture();
  assert.equal((await execute(call({ action: 'search', requirement: 'fixture dinner', budget_max: 30, note: 'no coriander' }))).ok, true);
  assert.equal((await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen', note: 'less ice' }))).ok, true);
  const order = await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup' }));
  assert.equal(order.ok, true);
  assert.equal(commands.at(-1).budget_max, 30, 'budget inherits without being repeated');
  assert.equal(commands.at(-1).note, 'no coriander；less ice', 'notes accumulate across steps');
  assert.equal(commands.at(-1).quantity, 1);
  const widened = await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup', budget_max: 60 }));
  assert.equal(widened.code, 'takeout_budget_widened');
  assert.equal(widened.budget_max, 30);
  const changed = await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup', quantity: 2 }));
  assert.equal(changed.code, 'takeout_quantity_changed');
});

test('search and menu receipts expose comparable rating, price and availability', async () => {
  const { execute } = fixture({ outcomes: {
    search: { status: 'done', result: { ok: true, status: 'done', shops: [
      { name: '虚构小馆', meta: '虚构小馆 | 4.9 | 分 | 起送¥20 | 30分钟' },
      { name: '虚构小馆', meta: 'duplicate' },
      { shop_name: '免起送店', meta: '免起送店 | 4.2 | 分 | 免配送费' }
    ] } },
    menu: { status: 'done', result: { ok: true, status: 'done', products: [
      { name: '番茄饭', price: 23, available: true },
      { name: '售罄菜', price: null, available: false },
      { name: '番茄饭', price: 99 }
    ] } }
  } });
  const search = await execute(call({ action: 'search', requirement: 'fixture' }));
  assert.deepEqual(search.shops, [
    { name: '虚构小馆', meta: '虚构小馆 | 4.9 | 分 | 起送¥20 | 30分钟', rating: 4.9 },
    { name: '免起送店', meta: '免起送店 | 4.2 | 分 | 免配送费', rating: 4.2 }
  ]);
  const menu = await execute(call({ action: 'menu', shop_name: '虚构小馆' }));
  assert.deepEqual(menu.products, [
    { name: '番茄饭', price: 23, available: true },
    { name: '售罄菜', price: null, available: false }
  ]);
});

test('a shop without the dish can be swapped for another real search result, then checkout stays single-use', async () => {
  const commands = [];
  const receipts = [
    { status: 'done', result: { ok: true, status: 'done', shops: [{ name: 'Fixture Kitchen' }, { name: 'Fixture Bistro' }] } },
    { status: 'done', result: { ok: false, status: 'product_not_found', code: 'takeout_product_not_found' } },
    { status: 'done', result: { ok: true, status: 'done', products: [{ name: 'Fixture Soup', price: 20, available: true }] } },
    { status: 'done', result: { ok: true, status: 'ready_for_payment', total: 20, items: 1, lines: [{ name: 'Fixture Soup', quantity: 1 }], paymentSubmitted: false } }
  ];
  const channel = {
    async createCommand(actualScope, input) { assert.deepEqual(actualScope, scope); commands.push(input); return { command_id: 'retry-' + commands.length }; },
    async waitForResult() { return receipts[commands.length - 1]; }
  };
  const execute = createTakeoutToolExecutor({ scope, channel, conversationId: 'retry-conversation', clientMessageId: 'retry-turn' });
  assert.equal((await execute(call({ action: 'search', requirement: 'fixture dinner' }))).ok, true);
  const missing = await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen' }));
  assert.equal(missing.code, 'takeout_product_not_found');
  assert.equal(missing.retryable, true);
  assert.equal((await execute(call({ action: 'menu', shop_name: 'Fixture Bistro' }))).ok, true, 'another real search result is allowed');
  assert.equal((await execute(call({ action: 'order', shop_name: 'Fixture Bistro', product_name: 'Fixture Soup' }))).ok, true);
  assert.deepEqual(commands.map(item => item.action), ['search', 'menu', 'menu', 'order']);
  assert.notEqual(commands[1].idempotency_key, commands[2].idempotency_key, 'each shop attempt needs its own idempotency key');
  assert.equal((await execute(call({ action: 'order', shop_name: 'Fixture Bistro', product_name: 'Fixture Soup', quantity: 1 }))).ok, true, 'identical resend reuses the same receipt');
  assert.equal(commands.length, 4);
  assert.equal((await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen' }))).code, 'takeout_product_not_found', 'replaying a failed step returns its original receipt without a new page operation');
  assert.equal((await execute(call({ action: 'search', requirement: 'shortened keyword' }))).code, 'takeout_action_already_used', 'a successful step cannot be replaced by another search in the same turn');
  assert.equal(commands.length, 4);
});

test('a tightened budget persists and an unaffordable menu item never creates a cart command', async () => {
  const { execute, commands } = fixture();
  await execute(call({ action: 'search', requirement: 'fixture dinner', budget_max: 45, quantity: 2 }));
  await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen', budget_max: 30 }));
  assert.equal((await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup' }))).code, 'takeout_over_budget');
  assert.deepEqual(commands.map(command => command.budget_max), [45, 30]);
  assert.equal((await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup', budget_max: 45 }))).code, 'takeout_budget_widened');
  assert.equal(commands.length, 2, 'known menu price times inherited quantity is checked before dispatch');
});

test('same explicit request reuses its original promise after later constraints have tightened', async () => {
  const { execute, commands } = fixture();
  const search = call({ action: 'search', requirement: 'fixture dinner', budget_max: 45, note: 'no coriander' });
  const original = execute(search);
  assert.equal((await original).ok, true);
  await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen', budget_max: 30, note: 'less salt' }));
  assert.equal(execute({ ...search, id: 'another-provider-call' }), original);
  const order = await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup' }));
  assert.equal(order.ok, false, 'a legacy ready receipt cannot silently confirm unapplied dietary notes');
  assert.equal(commands.at(-1).budget_max, 30);
  assert.equal(commands.at(-1).note, 'no coriander；less salt');
  assert.equal(commands.length, 3);
});

test('dietary notes are accumulated exactly without substring loss or silent truncation', async () => {
  const { execute, commands } = fixture();
  await execute(call({ action: 'search', requirement: 'fixture dinner', note: 'no coriander sauce' }));
  await execute(call({ action: 'menu', shop_name: 'Fixture Kitchen', note: 'coriander' }));
  assert.equal(commands.at(-1).note, 'no coriander sauce；coriander', 'a distinct note is not discarded as a substring');
  const overflow = await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup', note: '忌'.repeat(500) }));
  assert.equal(overflow.code, 'takeout_note_limit_exceeded');
  assert.equal(commands.length, 2, 'overlong cumulative notes require manual review before any cart action');
  const stopped = await execute(call({ action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup' }));
  assert.equal(stopped.code, 'takeout_flow_stopped');
  assert.equal(commands.length, 2, 'omitting an overflowing note cannot bypass manual review');
  const fresh = fixture();
  assert.equal((await fresh.execute(call({ action: 'search', requirement: 'fixture dinner', note: '忌'.repeat(501) }))).code, 'takeout_note_limit_exceeded');
  assert.equal(fresh.commands.length, 0);
});

test('a failed step replay keeps its promise after later dietary notes change', async () => {
  const commands = [];
  const outcomes = [
    { status: 'done', result: { ok: true, status: 'done', shops: [{ name: 'Fixture Kitchen' }, { name: 'Fixture Bistro' }] } },
    { status: 'done', result: { ok: false, code: 'takeout_menu_unavailable' } },
    { status: 'done', result: { ok: true, status: 'done', products: [{ name: 'Fixture Soup', price: 20 }] } }
  ];
  const execute = createTakeoutToolExecutor({ scope, channel: {
    async createCommand(actualScope, command) { commands.push(command); return { command_id: `retry-${commands.length}` }; },
    async waitForResult(actualScope, id) { return outcomes[Number(id.split('-').at(-1)) - 1]; }
  } });
  await execute(call({ action: 'search', requirement: 'fixture dinner', budget_max: 45, note: 'no coriander' }));
  const menuArgs = call({ action: 'menu', shop_name: 'Fixture Kitchen' });
  const firstMenu = execute(menuArgs);
  assert.equal((await firstMenu).code, 'takeout_menu_unavailable');
  await execute(call({ action: 'menu', shop_name: 'Fixture Bistro', budget_max: 30, note: 'less salt' }));
  assert.equal(execute(menuArgs), firstMenu);
  assert.equal(commands.length, 3, 'replaying the original failed step never consumes a new attempt');
});

test('unverified notes and malformed quantities never produce a verified payment receipt', () => {
  const { isVerifiedTakeoutCheckout } = require('../services/takeout-receipts');
  const receipt = { status: 'ready_for_payment', total: 20, items: 1, lines: [{ name: 'Fixture Soup', quantity: 1 }], paymentSubmitted: false };
  const command = { action: 'order', requirement: 'Fixture Soup', quantity: 1, budget_max: 30 };
  assert.equal(isVerifiedTakeoutCheckout(receipt, command), true);
  for (const patch of [{ note: 'no coriander' }, { quantity: 0 }, { quantity: -1 }, { quantity: 'invalid' }, { quantity: 1.5 }, { quantity: 21 }, { budget_max: -1 }, { budget_max: 'invalid' }]) {
    assert.equal(isVerifiedTakeoutCheckout(receipt, { ...command, ...patch }), false, JSON.stringify(patch));
  }
});
