const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateReply, generateReplyStream, MAIN_CHAT_PROMPT_ARCHITECTURE } = require('../services/ai-service');
const { TAKEOUT_TOOL, createTakeoutToolExecutor } = require('../services/takeout-tool');

const FIXTURE_TOOL = { name: 'fixture_note', description: 'Synthetic local note.', input_schema: { type: 'object', properties: {}, additionalProperties: false } };
const actionArguments = [
  { action: 'search', requirement: 'fixture dinner' },
  { action: 'menu', shop_name: 'Fixture Kitchen' },
  { action: 'order', shop_name: 'Fixture Kitchen', product_name: 'Fixture Soup', budget_max: 30 }
];
const localResults = [
  { ok: true, status: 'done', shops: [{ name: 'Fixture Kitchen', meta: 'local fixture only' }] },
  { ok: true, status: 'done', products: [{ name: 'Fixture Soup', price: 20, available: true }] },
  { ok: true, status: 'ready_for_payment', total: 20, items: 1, lines: [{ name: 'Fixture Soup', quantity: 1 }], paymentSubmitted: false }
];

async function localProvider(handler, run) {
  const requests = [], errors = [];
  const server = http.createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      const result = await handler(body, requests.length);
      if (!body.stream) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: result, finish_reason: result.tool_calls?.length ? 'tool_calls' : 'stop' }] }));
      } else {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const delta = result.tool_calls?.length ? { ...(result.content ? { content: result.content } : {}), tool_calls: result.tool_calls.map((call, index) => ({ ...call, index })) } : { content: result.content };
        response.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: result.tool_calls?.length ? 'tool_calls' : 'stop' }] })}\n\n`);
        response.end('data: [DONE]\n\n');
      }
    } catch (error) { errors.push(error); response.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run({ provider: 'custom', api_url: `http://127.0.0.1:${server.address().port}/v1`, runtime_api_key: 'fixture-local-key', model: 'fixture-takeout-model', max_tokens: 1024, prompt_mode: 'unified', unified_system_prompt: 'Fixture persona remains unchanged.' }, requests);
    assert.deepEqual(errors, []);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

function toolCall(name, args) { return { id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }; }
async function generate(streaming, settings, tools, executeTool) {
  const input = { settings, tools, executeTool, promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE, messages: [{ role: 'user', content: 'Use local fixture tools only.' }] };
  return streaming ? generateReplyStream({ ...input, onEvent() {} }) : generateReply(input);
}

for (const streaming of [false, true]) {
  test(`${streaming ? 'SSE' : 'JSON'} actual takeout search/menu/order gets exactly three execution rounds and one final reply`, async () => {
    const commands = [];
    const executeTool = createTakeoutToolExecutor({ scope: { userId: 'fixture-account', companionId: 'fixture-companion' }, clientMessageId: 'fixture-three-step-turn', conversationId: 'fixture-conversation', channel: {
      async createCommand(scope, command) { commands.push(command); return { command_id: `fixture-command-${commands.length}` }; },
      async waitForResult(scope, id) { return { status: 'done', result: localResults[Number(id.split('-').at(-1)) - 1] }; }
    } });
    await localProvider(async (body, round) => {
      if (round <= 3) {
        assert.ok(body.tools.some(tool => tool.function.name === TAKEOUT_TOOL.name));
        assert.equal(body.messages.filter(message => message.role === 'tool').length, round - 1);
        if (round > 1) assert.equal(JSON.parse(body.messages.at(-1).content).command_id, `fixture-command-${round - 1}`);
        return { content: null, tool_calls: [toolCall(TAKEOUT_TOOL.name, actionArguments[round - 1])] };
      }
      assert.equal(round, 4);
      assert.equal(body.tools, undefined);
      assert.equal(body.messages.filter(message => message.role === 'tool').length, 3);
      assert.equal(JSON.parse(body.messages.at(-1).content).payment_required, true);
      return { content: 'Fixture cart is ready for your manual review and payment.' };
    }, async (settings, requests) => {
      const result = await generate(streaming, settings, [TAKEOUT_TOOL], executeTool);
      assert.equal(requests.length, 4);
      assert.deepEqual(commands.map(command => command.action), ['search', 'menu', 'order']);
      assert.equal(new Set(commands.map(command => command.idempotency_key)).size, 3);
      assert.equal(result.tool_executions.length, 3);
      assert.equal(result.tool_executions.at(-1).result.order_result.paymentSubmitted, false);
      assert.match(result.text, /manual review and payment/);
    });
  });

  test(`${streaming ? 'SSE' : 'JSON'} merely offering takeout leaves ordinary tools at two rounds`, async () => {
    const executions = [];
    await localProvider(async (body, round) => {
      if (round < 3) {
        assert.ok(body.tools);
        return { content: null, tool_calls: [toolCall(FIXTURE_TOOL.name, {})] };
      }
      assert.equal(round, 3);
      assert.equal(body.tools, undefined);
      return { content: 'Fixture ordinary tools finished.' };
    }, async (settings, requests) => {
      const result = await generate(streaming, settings, [FIXTURE_TOOL, TAKEOUT_TOOL], async call => { executions.push(call); return { ok: true }; });
      assert.equal(requests.length, 3);
      assert.equal(executions.length, 2);
      assert.equal(result.tool_executions.length, 2);
    });
  });

  test(`${streaming ? 'SSE' : 'JSON'} rejected takeout calls without a dispatched command do not extend tool rounds`, async () => {
    const executeTool = createTakeoutToolExecutor({ scope: { userId: 'fixture-account', companionId: 'fixture-companion' }, channel: { async createCommand() { assert.fail('invalid calls must not dispatch'); } } });
    await localProvider(async (body, round) => {
      if (round < 3) return { content: null, tool_calls: [toolCall(TAKEOUT_TOOL.name, { action: 'pay' })] };
      assert.equal(round, 3);
      assert.equal(body.tools, undefined);
      return { content: 'Fixture request needs correction.' };
    }, async (settings, requests) => {
      const result = await generate(streaming, settings, [TAKEOUT_TOOL], executeTool);
      assert.equal(requests.length, 3);
      assert.equal(result.tool_executions.length, 2);
      assert.ok(result.tool_executions.every(execution => execution.result.code === 'takeout_action_invalid' && !execution.result.command_id));
    });
  });

  test(`${streaming ? 'SSE' : 'JSON'} a provider ignoring the final no-tools request cannot execute a third ordinary action`, async () => {
    let executed = 0;
    await localProvider(async (body, round) => {
      assert.ok(round <= 3);
      if (round === 3) assert.equal(body.tools, undefined);
      return { content: round === 3 ? 'Fixture prior reply remains visible.' : null, tool_calls: [toolCall(FIXTURE_TOOL.name, {})] };
    }, async (settings, requests) => {
      await assert.rejects(generate(streaming, settings, [FIXTURE_TOOL, TAKEOUT_TOOL], async () => { executed += 1; return { ok: true }; }), /工具调用次数过多/);
      assert.equal(requests.length, 3);
      assert.equal(executed, 2);
    });
  });
}
for (const streaming of [false, true]) {
  test(`${streaming ? 'SSE' : 'JSON'} a retryable missing dish allows one more shop within a bounded round budget`, async () => {
    const commands = [];
    const receipts = [
      { status: 'done', result: { ok: true, status: 'done', shops: [{ name: 'Fixture Kitchen' }, { name: 'Fixture Bistro' }] } },
      { status: 'done', result: { ok: false, status: 'product_not_found', code: 'takeout_product_not_found' } },
      { status: 'done', result: { ok: true, status: 'done', products: [{ name: 'Fixture Soup', price: 20, available: true }] } },
      { status: 'done', result: { ok: true, status: 'ready_for_payment', total: 20, items: 1, lines: [{ name: 'Fixture Soup', quantity: 1 }], paymentSubmitted: false } }
    ];
    const executeTool = createTakeoutToolExecutor({ scope: { userId: 'fixture-account', companionId: 'fixture-companion' }, clientMessageId: 'fixture-retry-turn', conversationId: 'fixture-conversation', channel: {
      async createCommand(scope, command) { commands.push(command); return { command_id: 'fixture-command-' + commands.length }; },
      async waitForResult() { return receipts[commands.length - 1]; }
    } });
    const retryArguments = [
      { action: 'search', requirement: 'fixture dinner' },
      { action: 'menu', shop_name: 'Fixture Kitchen' },
      { action: 'menu', shop_name: 'Fixture Bistro' },
      { action: 'order', shop_name: 'Fixture Bistro', product_name: 'Fixture Soup' }
    ];
    await localProvider(async (body, round) => {
      if (round <= 4) {
        assert.ok(body.tools, 'retryable takeout work keeps tools available');
        return { content: null, tool_calls: [toolCall(TAKEOUT_TOOL.name, retryArguments[round - 1])] };
      }
      assert.equal(round, 5);
      assert.equal(body.messages.filter(message => message.role === 'tool').length, 4);
      return { content: 'Fixture retry finished at the payment handoff.' };
    }, async (settings, requests) => {
      const result = await generate(streaming, settings, [TAKEOUT_TOOL], executeTool);
      assert.equal(requests.length, 5);
      assert.equal(commands.length, 4);
      assert.equal(result.tool_executions.length, 4);
      assert.equal(result.tool_executions[1].result.retryable, true);
      assert.equal(result.text, 'Fixture retry finished at the payment handoff.');
    });
  });
}
