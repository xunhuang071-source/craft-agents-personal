import { afterEach, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfflineEnvironment } from './test-fixtures/offline-environment.ts';

// Use the retained standard Pi plus the freshly compiled interceptor. No GUI or accounts.
const bundle = process.env.CRAFT_PI_TEST_BUNDLE;
const interceptor = process.env.CRAFT_INTERCEPTOR_TEST_BUNDLE;
const integration = bundle && interceptor ? test : test.skip;
type Row = Record<string, any>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function until(predicate: () => boolean, label: string, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (predicate()) return; await Bun.sleep(10); }
  throw new Error(`Timed out: ${label}`);
}
function chatReply(tool?: { name: string; path: string }): Response {
  const chunk = (delta: Row, finish_reason: string | null = null) => ({
    id: 'chat_fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-openai',
    choices: [{ index: 0, delta, finish_reason }],
  });
  const args = JSON.stringify({ path: tool?.path, _intent: 'Read the disposable fixture', _displayName: 'Read fixture' });
  const events = tool ? [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: tool.name, arguments: args } }] }),
    chunk({}, 'tool_calls'),
  ] : [chunk({ role: 'assistant', content: 'fixture completed' }), chunk({}, 'stop')];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } });
}
function responsesReply(tool?: { name: string; path: string }): Response {
  const args = JSON.stringify({ path: tool?.path, _intent: 'Read the disposable fixture', _displayName: 'Read fixture' });
  const item: Row = tool
    ? { type: 'function_call', id: 'fc_read', call_id: 'call_read', name: tool.name, arguments: args, status: 'completed' }
    : { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture completed', annotations: [] }] };
  const response = { id: 'resp_fixture', object: 'response', model: 'fixture-openai', status: 'completed', output: [item],
    usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
  const events: Row[] = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, ...(tool ? { arguments: '' } : { content: [] }) } },
    ...(tool ? [
      { type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: args },
      { type: 'response.function_call_arguments.done', output_index: 0, item_id: item.id, call_id: item.call_id, arguments: args },
    ] : [
      { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: item.id, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: 'fixture completed' },
    ]),
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } });
}

for (const api of ['openai-completions', 'openai-responses'] as const) {
  integration(`packaged interceptor + retained Pi: ${api} schema and read roundtrip`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-openai-wire-'));
    const config = join(root, 'config');
    const session = join(root, 'workspace', 'sessions', 'fixture-session');
    await mkdir(config, { recursive: true });
    await mkdir(session, { recursive: true });
    await writeFile(join(config, 'config.json'), JSON.stringify({ richToolDescriptions: true }));
    const proof = join(root, 'proof.txt');
    await writeFile(proof, 'fixture-read-roundtrip');
    const requests: Row[] = [];
    const violations: string[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const body = await request.json() as Row;
      requests.push(body);
      if (request.headers.get('authorization') !== 'Bearer local-fixture-key') violations.push('wrong synthetic key');
      const expectedPath = api === 'openai-completions' ? '/v1/chat/completions' : '/v1/responses';
      if (new URL(request.url).pathname !== expectedPath) violations.push('wrong endpoint');
      const tools: Row[] = body.tools.map((t: Row) => api === 'openai-completions' ? t.function : t);
      const read = tools.find(t => t.name === 'mcp__fixture__read');
      if (!read) violations.push('missing read tool');
      if (read?.parameters.additionalProperties !== false) violations.push('read schema lost additionalProperties false');
      for (const name of ['_intent', '_displayName']) {
        if (!read?.parameters.properties[name] || !read.parameters.required.includes(name)) violations.push(`missing ${name}`);
      }
      if (violations.length) return Response.json({ error: { message: violations.join(', ') } }, { status: 400 });
      return api === 'openai-completions'
        ? chatReply(requests.length === 1 ? { name: read!.name, path: proof } : undefined)
        : responsesReply(requests.length === 1 ? { name: read!.name, path: proof } : undefined);
    } });
    const child = spawn(process.execPath, [
      '--preload', join(import.meta.dir, 'test-fixtures/openai-loopback-network.ts'),
      '--preload', interceptor!, bundle!,
    ], { cwd: root, env: { ...createOfflineEnvironment(root), CRAFT_PI_TEST_ORIGIN: `http://127.0.0.1:${server.port}` }, stdio: 'pipe' });
    let exited = false;
    let stderr = '';
    const messages: Row[] = [];
    child.once('exit', () => { exited = true; });
    child.stderr!.on('data', data => { stderr += String(data).slice(0, 10000); });
    const send = (row: Row) => child.stdin!.write(JSON.stringify(row) + '\n');
    createInterface({ input: child.stdout! }).on('line', line => {
      let row: Row;
      try { row = JSON.parse(line); } catch { return; }
      messages.push(row);
      if (row.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: row.requestId, action: 'allow' });
      if (row.type === 'tool_execute_request') {
        if (row.toolName !== 'mcp__fixture__read' || row.args.path !== proof || '_intent' in row.args || '_displayName' in row.args) {
          violations.push('unexpected proxy arguments');
        }
        send({ type: 'tool_execute_response', requestId: row.requestId, result: { content: 'fixture-read-roundtrip', isError: false } });
      }
    });
    cleanups.push(async () => {
      if (!exited) { send({ type: 'shutdown' }); await until(() => exited, 'shutdown', 3000).catch(() => child.kill('SIGKILL')); }
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    });
    send({ type: 'init', apiKey: 'local-fixture-key', model: 'fixture-openai', cwd: root, workingDirectory: root,
      thinkingLevel: 'off', workspaceRootPath: join(root, 'workspace'), workspaceId: 'fixture',
      sessionId: 'fixture-session', sessionPath: session, plansFolderPath: join(session, 'plans'),
      providerType: 'pi_compat', authType: 'api_key_with_endpoint', baseUrl: `http://127.0.0.1:${server.port}/v1`,
      customEndpoint: { api }, customModels: [{ id: 'fixture-openai', contextWindow: 100000, maxTokens: 4096 }],
    });
    await until(() => messages.some(m => m.type === 'ready') || exited, 'ready');
    expect(exited, stderr).toBe(false);
    send({ type: 'register_tools', tools: [{ name: 'mcp__fixture__read', description: 'Read the disposable fixture through the host',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }] });
    send({ type: 'prompt', id: 'read-fixture', message: 'Read proof.txt once.', systemPrompt: 'Read only the disposable fixture file.' });
    await until(() => messages.some(m => m.type === 'event' && m.event?.type === 'agent_end') || exited, 'turn completion');
    expect(violations).toEqual([]);
    expect(messages.filter(m => m.type === 'error')).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain('fixture-read-roundtrip');
    const executions = messages.filter(m => m.type === 'event' && m.event?.type === 'tool_execution_end');
    expect(executions).toHaveLength(1);
    expect(executions[0]!.event.isError).toBe(false);
    expect(await readFile(proof, 'utf8')).toBe('fixture-read-roundtrip');
  }, 20000);
}


integration('compiled interceptor preserves strict OpenAI tools on both APIs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-strict-bundle-'));
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const {openAiAdapter, openAiResponsesAdapter} = require(process.argv[1]);
      const assert = require('node:assert/strict');
      for (const [api, adapter] of [['chat', openAiAdapter], ['responses', openAiResponsesAdapter]]) {
        const schema = {type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false};
        const tool = api === 'chat'
          ? {type:'function',function:{name:'read',strict:true,parameters:schema}}
          : {type:'function',name:'read',strict:true,parameters:schema};
        adapter.addMetadataToTools({tools:[tool]});
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual(schema.required, ['_displayName','_intent','path']);
        assert.deepEqual(Object.keys(schema.properties), ['_displayName','_intent','path']);
      }
      console.log('strict tool schemas verified');
    `, interceptor!], {
      cwd: root,
      env: { ...createOfflineEnvironment(root), CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '1' },
      encoding: 'utf8', timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('strict tool schemas verified');
  } finally { await rm(root, { recursive: true, force: true }); }
});
