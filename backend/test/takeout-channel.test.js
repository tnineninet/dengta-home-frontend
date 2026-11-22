const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createTakeoutChannel } = require('../services/takeout-channel');
const { createTakeoutRouter } = require('../routes/takeout');
const { createRequestScope } = require('../services/request-scope');
const express = require('express');

const id = '00000000-0000-4000-8000-000000000001';
const scope = { userId: 'fixture-account', companionId: 'fixture-companion' };

// Execute the service's filters as real SQL, including atomic UPDATE predicates.
function clientFor(db, hooks = {}) {
  return { from(table) {
    assert.equal(table, 'takeout_commands');
    let patch, inserted, columns = '*', ordering, maximum; const filters = [];
    const builder = {
      select(value) { columns = value; return builder; },
      insert(value) { inserted = value; return builder; },
      update(value) { patch = value; return builder; },
      eq(key, value) { filters.push([key, [value]]); return builder; },
      in(key, values) { filters.push([key, values]); return builder; },
      order(key, options) { ordering = `${key} ${options?.ascending === false ? 'DESC' : 'ASC'}`; return builder; },
      limit(value) { maximum = value; return builder; },
      async execute(multiple = false) {
        const args = []; const param = value => { args.push(value); return '$' + args.length; };
        const asValue = (key, value) => ['command', 'result'].includes(key) ? JSON.stringify(value) : value;
        if (inserted) {
          const entries = Object.entries(inserted);
          try {
            const { rows } = await db.query(`INSERT INTO takeout_commands(${entries.map(([key]) => key).join(',')}) VALUES(${entries.map(([key, value]) => param(asValue(key, value))).join(',')}) RETURNING ${columns}`, args);
            return { data: rows[0] || null, error: null };
          } catch (error) { return { data: null, error }; }
        }
        const set = patch ? Object.entries(patch).map(([key, value]) => `${key}=${param(asValue(key, value))}`).join(',') : '';
        const where = filters.map(([key, values]) => `${key} IN (${values.map(param).join(',')})`).join(' AND ');
        if (patch) await hooks.beforeUpdate?.(patch, filters);
        const { rows } = await db.query(patch ? `UPDATE takeout_commands SET ${set} WHERE ${where} RETURNING ${columns}` : `SELECT ${columns} FROM takeout_commands WHERE ${where}${ordering ? ' ORDER BY ' + ordering : ''}${maximum ? ' LIMIT ' + maximum : ''}`, args);
        if (!patch) await hooks.afterRead?.();
        return { data: multiple ? rows : rows[0] || null, error: null };
      },
      maybeSingle() { return builder.execute(); },
      single() { return builder.execute(); },
      then(resolve, reject) { return builder.execute(true).then(resolve, reject); },
    };
    return builder;
  } };
}

test('SQL claims are exclusive and terminal results survive late callbacks and tenant changes', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE takeout_commands (id uuid PRIMARY KEY, user_id text, companion_id text, status text, progress text, result jsonb, ack_at timestamptz, updated_at timestamptz, done_at timestamptz)');
    const reset = async status => { await db.exec('DELETE FROM takeout_commands'); await db.query('INSERT INTO takeout_commands(id,user_id,companion_id,status) VALUES($1,$2,$3,$4)', [id, scope.userId, scope.companionId, status]); };
    const row = async () => (await db.query('SELECT * FROM takeout_commands')).rows[0];
    await reset('pending');
    let reads = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    const channel = createTakeoutChannel({ database: clientFor(db, { afterRead: async () => { if (++reads === 2) release(); await barrier; } }) });
    const claims = await Promise.allSettled([channel.ackCommand(scope, id), channel.ackCommand(scope, id)]);
    assert.equal(claims.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(claims.find(value => value.status === 'rejected').reason.code, 'takeout_command_not_pending');
    assert.equal((await row()).status, 'executing');
    await assert.rejects(channel.ackCommand(scope, id), { status: 409 });
    await channel.postProgress(scope, id, 'fixture progress');
    await channel.postResult(scope, id, { fixture: 'original' });
    await channel.postResult(scope, id, { fixture: 'duplicate must not overwrite' });
    await assert.rejects(channel.postFailure(scope, id, 'late failure'), { status: 409 });
    await assert.rejects(channel.postProgress(scope, id, 'late progress'), { status: 409 });
    await assert.rejects(channel.cancelCommand(scope, id), { status: 409 });
    assert.deepEqual((await row()).result, { fixture: 'original' });
    assert.equal((await row()).progress, 'fixture progress');
    for (const foreign of [{ ...scope, userId: 'other-account' }, { ...scope, companionId: 'other-companion' }]) {
      for (const [method, value] of [['ackCommand'], ['cancelCommand'], ['postResult', {}], ['postFailure', 'fixture'], ['postProgress', 'fixture']]) {
        await assert.rejects(channel[method](foreign, id, value), { status: 404 });
      }
    }
    await reset('executing');
    let raced = false;
    const racing = createTakeoutChannel({ database: clientFor(db, { beforeUpdate: async (patch, filters) => {
      assert.ok(filters.some(([key]) => key === 'user_id'));
      assert.ok(filters.some(([key]) => key === 'companion_id'));
      if (patch.status === 'cancelled' && !raced) {
        raced = true;
        await db.query("UPDATE takeout_commands SET status='done',result=$1 WHERE id=$2", [JSON.stringify({ fixture: 'won race' }), id]);
      }
    } }) });
    await assert.rejects(racing.cancelCommand(scope, id), { status: 409 });
    assert.deepEqual((await row()).result, { fixture: 'won race' });
    await reset('executing');
    await channel.cancelCommand(scope, id);
    await assert.rejects(channel.postResult(scope, id, {}), { status: 409 });
    assert.equal((await row()).status, 'cancelled');
    await reset('pending');
    await assert.rejects(channel.postFailure(scope, id, 'unclaimed'), { status: 409 });
    await channel.ackCommand(scope, id);
    await channel.postFailure(scope, id, 'fixture');
    await channel.postFailure(scope, id, 'duplicate');
    assert.deepEqual((await row()).result, { error: 'fixture' });
  } finally { await db.close(); }
});

async function withChannel(run) {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE takeout_commands (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, companion_id text, status text, command jsonb, progress text, result jsonb, created_at timestamptz DEFAULT now(), ack_at timestamptz, updated_at timestamptz DEFAULT now(), done_at timestamptz)');
    await run(createTakeoutChannel({ database: clientFor(db) }), db);
  } finally { await db.close(); }
}

test('search, real menu and exact product commands always stop before payment', async () => withChannel(async (channel) => {
  const search = await channel.createCommand(scope, { requirement: 'fixture noodles', idempotency_key: 'fixture-search' });
  let snapshot = await channel.getCommand(scope, search.command_id);
  assert.equal(snapshot.command.action, 'search');
  assert.equal(snapshot.command.checkout_only, true);
  assert.equal(snapshot.command.payment_policy, 'user_confirm');
  assert.equal(Object.hasOwn(snapshot, 'user_id'), false);
  const menu = await channel.createCommand(scope, { action: 'menu', shop_name: 'Fixture Kitchen', idempotency_key: 'fixture-menu' });
  snapshot = await channel.getCommand(scope, menu.command_id);
  assert.equal(snapshot.command.requirement, 'Fixture Kitchen');
  const order = await channel.createCommand(scope, { action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture soup', requirement: 'ignored legacy category', budget_max: 30, quantity: 2, idempotency_key: 'fixture-order', checkout_only: false, payment_policy: 'automatic' });
  snapshot = await channel.getCommand(scope, order.command_id);
  assert.equal(snapshot.command.requirement, 'Fixture soup');
  assert.equal(snapshot.command.budget_max, 30);
  assert.equal(snapshot.command.quantity, 2);
  assert.equal(snapshot.command.checkout_only, true);
  assert.equal(snapshot.command.payment_policy, 'user_confirm');
  const pending = await channel.pendingCommands(scope);
  assert.equal(pending.length, 3);
  await channel.ackCommand(scope, order.command_id);
  await channel.postResult(scope, order.command_id, { status: 'ready_for_payment', total: 28, items: 2, lines: [{ name: 'Fixture soup', quantity: 2 }], paymentSubmitted: false });
  snapshot = await channel.getCommand(scope, order.command_id);
  assert.equal(snapshot.payment_required, true);
  assert.equal(snapshot.status, 'done');
  assert.equal((await channel.waitForResult(scope, order.command_id)).command_id, order.command_id);
  for (const action of ['pay', 'submit_order', 'payment', 'arbitrary']) {
    await assert.rejects(channel.createCommand(scope, { action, requirement: 'fixture' }), { code: 'takeout_action_invalid' });
  }
  await assert.rejects(channel.createCommand(scope, { action: 'order', requirement: 'fixture' }), { code: 'takeout_shop_required' });
  await assert.rejects(channel.createCommand(scope, { action: 'menu', requirement: 'fixture' }), { code: 'takeout_shop_required' });
  for (const budget_max of [-1, 0, Infinity, 'not-a-price']) {
    await assert.rejects(channel.createCommand(scope, { requirement: 'fixture', budget_max }), { code: 'takeout_budget_invalid' });
  }
}));

test('SQL primary key makes retried creation exclusive across instances without overwriting prior command', async () => withChannel(async (channel, db) => {
  const secondInstance = createTakeoutChannel({ database: clientFor(db) });
  const input = { action: 'order', shop_name: 'Fixture Kitchen', requirement: 'Fixture soup', idempotency_key: 'fixture-shared-key' };
  const [first, duplicate] = await Promise.all([channel.createCommand(scope, input), secondInstance.createCommand(scope, input)]);
  assert.equal(first.command_id, duplicate.command_id);
  assert.equal([first, duplicate].filter(item => item.replayed).length, 1);
  assert.equal((await db.query('SELECT COUNT(*) AS count FROM takeout_commands')).rows[0].count, 1);
  await channel.ackCommand(scope, first.command_id);
  await channel.postResult(scope, first.command_id, { status: 'ready_for_payment', total: '12.00' });
  const terminalReplay = await secondInstance.createCommand(scope, input);
  assert.equal(terminalReplay.status, 'done');
  assert.equal(terminalReplay.replayed, true);
  await assert.rejects(channel.createCommand(scope, { ...input, requirement: 'Different fixture' }), { code: 'takeout_idempotency_conflict' });
  assert.deepEqual((await channel.getCommand(scope, first.command_id)).result, { status: 'ready_for_payment', total: '12.00' });
  for (const foreign of [{ ...scope, userId: 'other-account' }, { ...scope, companionId: 'other-companion' }]) {
    await assert.rejects(channel.getCommand(foreign, first.command_id), { status: 404 });
    const independent = await channel.createCommand(foreign, input);
    assert.notEqual(independent.command_id, first.command_id);
  }
  await assert.rejects(channel.createCommand(scope, { ...input, idempotency_key: 'line\nbreak' }), { code: 'takeout_idempotency_key_invalid' });
  await assert.rejects(channel.pendingCommands({}), { status: 401 });
  await assert.rejects(channel.readCommand(null, first.command_id), { status: 401 });
}));

test('real HTTP command creation and status polling require scope, retry ID and tenant ownership', async () => withChannel(async (channel, db) => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.get('X-Fixture-Account')) {
      const userId = req.get('X-Fixture-Account');
      const companion = { id: scope.companionId, user_id: userId, status: 'active' };
      req.scope = createRequestScope({ adminSupabase: clientFor(db), user: { id: userId }, profile: { id: userId, status: 'active', role: 'member' }, companions: [companion], companion });
    }
    next();
  });
  app.use('/takeout', createTakeoutRouter({ channel }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ code: error.code || 'fixture_failed' }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const request = async (path, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/takeout${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Fixture-Account': scope.userId, ...options.headers } });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  };
  try {
    assert.equal((await request('/pending', { headers: { 'X-Fixture-Account': '' } })).status, 401);
    const missingKey = await request('/', { method: 'POST', body: JSON.stringify({ requirement: 'Fixture dinner' }) });
    assert.equal(missingKey.status, 400);
    assert.equal(missingKey.body.code, 'takeout_idempotency_key_required');
    const options = { method: 'POST', headers: { 'Idempotency-Key': 'fixture-http-search' }, body: JSON.stringify({ requirement: 'Fixture dinner', user_id: 'attempted-other-account', companion_id: 'attempted-other-companion' }) };
    const first = await request('/', options);
    assert.equal(first.status, 201);
    assert.equal(first.cache, 'private, no-store');
    const second = await request('/', options);
    assert.equal(second.status, 200);
    assert.equal(second.body.command.command_id, first.body.command.command_id);
    const commandId = first.body.command.command_id;
    assert.equal((await request('/pending')).body.commands.length, 1);
    const status = await request(`/${commandId}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.command.command.requirement, 'Fixture dinner');
    assert.equal(Object.hasOwn(status.body.command, 'user_id'), false);
    assert.equal((await request(`/${commandId}`, { headers: { 'X-Fixture-Account': 'other-account' } })).status, 404);
    assert.equal((await request('/not-a-uuid')).body.code, 'takeout_command_id_invalid');
    assert.equal((await request(`/${commandId}/ack`, { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await request(`/${commandId}/result`, { method: 'POST', body: JSON.stringify({ result: { status: 'done', shops: [{ name: 'Fixture Kitchen' }] } }) })).status, 200);
    assert.deepEqual((await request(`/${commandId}`)).body.command.result.shops, [{ name: 'Fixture Kitchen' }]);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}));
