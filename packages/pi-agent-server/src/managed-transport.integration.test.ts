import { afterEach, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOfflineEnvironment } from './test-fixtures/offline-environment.ts'
import { SessionManager } from '@earendil-works/pi-coding-agent'

// Explicit opt-in: a built subprocess, local HTTP only, temporary files only.
const bundle = process.env.CRAFT_PI_TEST_BUNDLE
const integration = bundle ? test : test.skip
// Main-tree consumers can select normal policy without changing this fixture.
const defaultManaged = process.env.CRAFT_PI_TEST_MANAGED !== '0'
const managedIntegration = bundle && defaultManaged ? test : test.skip
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
type Row = Record<string, any>
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean, label: string, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (predicate()) return; await wait(10) }
  throw new Error(`Timed out waiting for ${label}`)
}
function sse(content: { text?: string; stopReason?: string; tool?: { id: string; name: string; input: Row; rawInput?: string } }) {
  const events: Row[] = [{ type: 'message_start', message: {
    id: `fixture-${Math.random()}`, type: 'message', role: 'assistant', model: 'fixture-gemini', content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 0 },
  } }]
  if (content.tool) {
    events.push({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: content.tool.id, name: content.tool.name, input: {} } })
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: content.tool.rawInput ?? JSON.stringify(content.tool.input) } })
  } else {
    events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content.text ?? 'OK' } })
  }
  events.push({ type: 'content_block_stop', index: 0 })
  events.push({ type: 'message_delta', delta: { stop_reason: content.stopReason ?? (content.tool ? 'tool_use' : 'end_turn'), stop_sequence: null }, usage: { output_tokens: 10 } })
  events.push({ type: 'message_stop' })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}
async function startFixture(handler: (request: Request, body: Row) => Response | Promise<Response>, options: {
  managed?: boolean; bundlePath?: string; root?: string;
} = {}) {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'craft-managed-pi-'))
  const session = join(root, 'workspace', 'sessions', 'test-session')
  await mkdir(session, { recursive: true })
  const requests: Row[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe('/v1/messages')
    expect(request.headers.get('x-api-key')).toBe('local-fixture-key')
    const body = await request.json() as Row; requests.push(body)
    return handler(request, body)
  } })
  const child = spawn(process.execPath, [
    '--preload', join(import.meta.dir, 'test-fixtures', 'loopback-network.ts'), options.bundlePath ?? bundle!,
  ], {
    cwd: root,
    env: { ...createOfflineEnvironment(root), CRAFT_PI_TEST_ORIGIN: `http://127.0.0.1:${server.port}` },
    stdio: 'pipe',
  }) as ChildProcessWithoutNullStreams
  const messages: Row[] = []; let stderr = ''; let exited = false
  child.stderr.on('data', data => { stderr += String(data).slice(0, 10000) })
  child.once('exit', () => { exited = true })
  const send = (message: Row) => child.stdin.write(JSON.stringify(message) + '\n')
  createInterface({ input: child.stdout }).on('line', line => {
    let message: Row
    try { message = JSON.parse(line) } catch { return }
    messages.push(message)
    if (message.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: message.requestId, action: 'allow' })
    if (message.type === 'tool_execute_request') send({ type: 'tool_execute_response', requestId: message.requestId, result: {
      content: message.toolName === 'mcp__session__mermaid_validate' ? 'fixture Pele host validation' : 'fixture MCP result',
      isError: false,
    } })
  })
  cleanups.push(async () => {
    if (!exited) { send({ type: 'shutdown' }); await wait(100); child.kill('SIGTERM') }
    server.stop(true)
    await until(() => exited, 'child shutdown', 3000).catch(() => child.kill('SIGKILL'))
    await rm(root, { recursive: true, force: true })
  })
  send({ type: 'init', ...((options.managed ?? defaultManaged) ? { managedProvider: 'antigravity' } : {}), apiKey: 'local-fixture-key',
    model: 'fixture-gemini', cwd: root, workingDirectory: root,
    thinkingLevel: 'off', workspaceRootPath: join(root, 'workspace'), workspaceId: 'fixture',
    sessionId: 'test-session', sessionPath: session, plansFolderPath: join(session, 'plans'),
    providerType: 'pi_compat', authType: 'api_key_with_endpoint',
    baseUrl: `http://127.0.0.1:${server.port}`, customEndpoint: { api: 'anthropic-messages' },
    customModels: [{ id: 'fixture-gemini', supportsImages: true, contextWindow: 1048576, maxTokens: 65536 }],
  })
  await until(() => messages.some(m => m.type === 'ready') || exited, 'subprocess ready')
  if (exited) throw new Error(`Subprocess failed: ${stderr}`)
  return { root, send, messages, requests, stderr: () => stderr, shutdown: async () => {
    send({ type: 'shutdown' })
    await until(() => exited, 'graceful subprocess exit', 5000)
  } }
}

integration('real Pi subprocess: streaming file write/read, proxy tool, and image payload', async () => {
  let requestIndex = 0
  let root = ''
  const fixture = await startFixture((_request, body) => {
    const index = requestIndex++
    const tool = (match: string) => {
      const found = (body.tools as Row[]).find(t => String(t.name).toLowerCase() === match || String(t.name).includes(match))
      if (!found) throw new Error(`Missing ${match} tool`)
      return String(found.name)
    }
    if (index === 0) return sse({ tool: { id: 'fixture-write', name: tool('write'), input: { path: join(root, 'proof.txt'), content: 'managed tool roundtrip' } } })
    if (index === 2) return sse({ tool: { id: 'fixture-read', name: tool('read'), input: { path: join(root, 'proof.txt') } } })
    if (index === 4) return sse({ tool: { id: 'fixture-proxy', name: tool('echo'), input: { value: 'hello' } } })
    return sse({ text: `fixture-complete-${index}` })
  })
  root = fixture.root
  fixture.send({ type: 'register_tools', tools: [{ name: 'mcp__fixture__echo', description: 'Local fixture echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] })
  for (const [index, prompt] of ['Write the test file', 'Read the test file', 'Use the fixture proxy'].entries()) {
    fixture.send({ type: 'prompt', id: `turn-${index}`, message: prompt, systemPrompt: 'Use the requested tool. The directory is a disposable test fixture.' })
    await until(() => fixture.messages.filter(m => m.type === 'event' && m.event?.type === 'agent_end').length >= index + 1, `tool turn ${index}; ${fixture.stderr()}`)
  }
  expect(await readFile(join(root, 'proof.txt'), 'utf8')).toBe('managed tool roundtrip')
  expect(JSON.stringify(fixture.requests[3]?.messages)).toContain('managed tool roundtrip')
  expect(JSON.stringify(fixture.requests[5]?.messages)).toContain('fixture MCP result')
  // A proxied tool has an additional host check; execution events, not hook counts,
  // prove that the file and MCP side effects are each executed exactly once.
  expect(fixture.messages.filter(m => m.type === 'pre_tool_use_request').length).toBeGreaterThanOrEqual(3)
  const executions = fixture.messages.filter(m => m.type === 'event' && m.event?.type === 'tool_execution_end')
  expect(executions).toHaveLength(3)
  expect(new Set(executions.map(m => m.event.toolCallId)).size).toBe(3)
  expect(fixture.requests).toHaveLength(6)
  fixture.send({ type: 'prompt', id: 'image', message: 'Observe this image', systemPrompt: 'Reply briefly.', images: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGOUTDnBQApgIkk1w6gG4gATkergYFQDMYDkUAIAFGMBZabDbTUAAAAASUVORK5CYII=' }] })
  await until(() => fixture.messages.filter(m => m.type === 'event' && m.event?.type === 'agent_end').length >= 4, 'image turn')
  expect(JSON.stringify(fixture.requests[6]?.messages)).toContain('image/png')
  expect(fixture.messages.filter(m => m.type === 'error')).toHaveLength(0)
}, 30000)

managedIntegration('real Pi subprocess: 429 ends the turn without request replay', async () => {
  const fixture = await startFixture(() => new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'fixture rate limit' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' } }))
  fixture.send({ type: 'prompt', id: 'limited', message: 'Reply once', systemPrompt: 'Reply once.' })
  await until(() => fixture.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'rate-limit terminal event')
  await wait(150)
  expect(fixture.requests).toHaveLength(1)
}, 20000)

integration('real Pi subprocess: user stop cancels an open stream without retry', async () => {
  const fixture = await startFixture(() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('event: ping\ndata: {"type":"ping"}\n\n'))
  } }), { headers: { 'Content-Type': 'text/event-stream' } }))
  fixture.send({ type: 'prompt', id: 'stop', message: 'Wait for cancellation', systemPrompt: 'Reply once.' })
  await until(() => fixture.requests.length === 1, 'open model stream')
  fixture.send({ type: 'abort' })
  await until(() => fixture.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'cancel terminal event', 5000)
  expect(fixture.requests).toHaveLength(1)
}, 15000)

managedIntegration('real Pi subprocess: ephemeral managed 429 never replays a request', async () => {
  const fixture = await startFixture(() => new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'fixture utility limit' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' } }))
  fixture.send({ type: 'llm_query', id: 'utility-limit', request: { prompt: 'Reply once', systemPrompt: 'Fixture utility', model: 'fixture-gemini' } })
  await until(() => fixture.messages.some(m => m.type === 'llm_query_result' && m.id === 'utility-limit'), 'ephemeral rate-limit completion')
  await wait(150)
  expect(fixture.requests).toHaveLength(1)
}, 20000)

integration('real Pi subprocess: Mermaid validation is delegated exactly once to the Pele host', async () => {
  const toolName = 'mcp__session__mermaid_validate'
  const code = 'flowchart LR\n  A[Fixture] --> B[Host]'
  const fixture = await startFixture((_request, body) => {
    if (body.messages.some((m: Row) => JSON.stringify(m).includes('fixture Pele host validation'))) return sse({ text: 'host-validated' })
    expect(body.tools.filter((t: Row) => String(t.name).includes('mermaid'))).toHaveLength(1)
    return sse({ tool: { id: 'host-mermaid', name: toolName, input: { code, render: true } } })
  })
  fixture.send({ type: 'register_tools', tools: [{ name: toolName, description: 'Validate through the Pele host', inputSchema: { type: 'object', properties: { code: { type: 'string' }, render: { type: 'boolean' } }, required: ['code'] } }] })
  fixture.send({ type: 'prompt', id: 'mermaid', message: 'Validate fixture diagram', systemPrompt: 'Delegate validation to the host.' })
  await until(() => fixture.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'Mermaid host result')
  const hostCalls = fixture.messages.filter(m => m.type === 'tool_execute_request')
  expect(hostCalls).toHaveLength(1)
  expect(hostCalls[0]).toMatchObject({ toolName, args: { code, render: true } })
  expect(fixture.requests).toHaveLength(2)
  expect(JSON.stringify(fixture.requests[1]?.messages)).toContain('fixture Pele host validation')
  expect(fixture.messages.filter(m => m.type === 'error')).toHaveLength(0)
}, 20000)

for (const managed of [false, true]) {
  const label = managed ? 'managed' : 'normal'
  integration(`real Pi subprocess: ${label} malformed tool JSON cannot execute a side effect`, async () => {
    let index = 0
    const fixture = await startFixture((_request, body) => {
      if (index++ > 0) return sse({ text: 'recovered without executing malformed input' })
      const name = body.tools.find((t: Row) => t.name === 'mcp__fixture__effect')?.name
      return sse({ tool: { id: 'malformed', name, input: {}, rawInput: '{"value":"never execute", BROKEN' } })
    }, { managed })
    fixture.send({ type: 'register_tools', tools: [{ name: 'mcp__fixture__effect', description: 'Fixture side effect', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] })
    fixture.send({ type: 'prompt', id: 'malformed', message: 'Test invalid input', systemPrompt: 'Offline fixture.' })
    await until(() => fixture.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'invalid JSON completion')
    expect(fixture.messages.filter(m => m.type === 'tool_execute_request')).toHaveLength(0)
    expect(fixture.requests.length).toBeLessThanOrEqual(2)
  }, 20000)

  integration(`real Pi subprocess: ${label} truncated tool calls cannot execute salvaged arguments`, async () => {
    let index = 0
    const fixture = await startFixture(() => index++ === 0
      ? sse({ stopReason: 'max_tokens', tool: { id: 'truncated', name: 'mcp__fixture__effect', input: { value: 'looks complete but was truncated' } } })
      : sse({ text: 'truncated-call-recovered' }), { managed })
    fixture.send({ type: 'register_tools', tools: [{ name: 'mcp__fixture__effect', description: 'Fixture side effect', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] })
    fixture.send({ type: 'prompt', id: 'truncated', message: 'Test truncated input', systemPrompt: 'Offline fixture.' })
    await until(() => fixture.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'truncated JSON completion')
    expect(fixture.messages.filter(m => m.type === 'tool_execute_request')).toHaveLength(0)
    expect(fixture.requests).toHaveLength(2)
    expect(JSON.stringify(fixture.requests[1]?.messages)).toContain('output token limit')
  }, 20000)

  integration(`real Pi subprocess: ${label} blank tool output remains a valid next request`, async () => {
    let index = 0
    const fixture = await startFixture(() => index++ === 0
      ? sse({ tool: { id: 'blank', name: 'bash', input: { command: 'printf " "' } } })
      : sse({ text: 'blank-result-recovered' }), { managed })
    fixture.send({ type: 'prompt', id: 'blank', message: 'Test blank output', systemPrompt: 'Offline fixture.' })
    await until(() => fixture.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'blank output completion')
    expect(fixture.requests).toHaveLength(2)
    const blocks = fixture.requests[1]!.messages.flatMap((m: Row) => Array.isArray(m.content) ? m.content : [])
    const result = blocks.find((block: Row) => block.type === 'tool_result')
    expect(result).toBeDefined()
    expect(JSON.stringify(result)).toContain('tool_use_id')
    expect(fixture.messages.filter(m => m.type === 'event' && m.event?.type === 'tool_execution_end')).toHaveLength(1)
    expect(fixture.messages.filter(m => m.type === 'error')).toHaveLength(0)
  }, 20000)
}

const legacyBundle = process.env.CRAFT_PI_TEST_LEGACY_BUNDLE
const historyIntegration = bundle && legacyBundle ? test : test.skip
historyIntegration('real Pi subprocess: synthetic 1.1 history resumes in 1.4 and can reopen in 1.1', async () => {
  const legacy = await startFixture(() => sse({ text: 'legacy-history-marker' }), { bundlePath: legacyBundle })
  legacy.send({ type: 'prompt', id: 'old', message: 'legacy-user-marker', systemPrompt: 'Synthetic history.' })
  await until(() => legacy.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'legacy history')
  await legacy.shutdown()

  const upgraded = await startFixture(() => sse({ text: 'upgraded-history-marker' }), { root: legacy.root })
  upgraded.send({ type: 'prompt', id: 'upgraded', message: 'upgraded-user-marker', systemPrompt: 'Synthetic history.' })
  await until(() => upgraded.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'upgraded history')
  expect(JSON.stringify(upgraded.requests[0]!.messages)).toContain('legacy-user-marker')
  expect(JSON.stringify(upgraded.requests[0]!.messages)).toContain('legacy-history-marker')
  await upgraded.shutdown()

  const reopened = await startFixture(() => sse({ text: 'rollback-readable' }), { root: legacy.root, bundlePath: legacyBundle })
  reopened.send({ type: 'prompt', id: 'reopened', message: 'Read synthetic history', systemPrompt: 'Synthetic history.' })
  await until(() => reopened.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'rollback read')
  for (const marker of ['legacy-user-marker', 'legacy-history-marker', 'upgraded-user-marker', 'upgraded-history-marker']) {
    expect(JSON.stringify(reopened.requests[0]!.messages)).toContain(marker)
  }
  expect(reopened.messages.filter(m => m.type === 'error')).toHaveLength(0)
}, 30000)

historyIntegration('real Pi subprocess: synthetic compaction and branch summaries survive 1.1 → 1.4 → 1.1', async () => {
  const old = await startFixture(() => sse({ text: 'history-before-compaction' }), { bundlePath: legacyBundle })
  old.send({ type: 'prompt', id: 'seed', message: 'history-kept-user', systemPrompt: 'Synthetic complex history.' })
  await until(() => old.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'history seed')
  await old.shutdown()
  const sessionDir = join(old.root, 'workspace', 'sessions', 'test-session', '.pi-sessions')
  const sessionFile = join(sessionDir, (await readdir(sessionDir)).find(name => name.endsWith('.jsonl'))!)
  const readEntries = async () => (await readFile(sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Row)

  // Use supported persistence APIs, not the session version number, to synthesize
  // checkpoints and a real tree fork. No summarization model is called here.
  function checkpoint(prefix: string) {
    const manager = SessionManager.open(sessionFile)
    const firstUser = manager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'user')!
    const compaction = manager.appendCompaction(`${prefix}-compaction-summary`, firstUser.id, 42000, { fixture: prefix }, true)
    const abandoned = manager.appendMessage({ role: 'user', content: `${prefix}-abandoned-side-branch`, timestamp: Date.now() })
    const branch = manager.branchWithSummary(compaction, `${prefix}-branch-summary`, { fixture: prefix }, true)
    expect(manager.getEntry(branch)).toMatchObject({ type: 'branch_summary', parentId: compaction, fromId: abandoned })
    return { compaction, branch }
  }
  const initial = checkpoint('legacy-fixture')
  const initialRows = (await readEntries()).filter(entry => entry.id === initial.compaction || entry.id === initial.branch)

  // First prove the old bundle itself can restore the synthetic checkpoints.
  const oldRead = await startFixture(() => sse({ text: 'legacy-checkpoints-read' }), { root: old.root, bundlePath: legacyBundle })
  oldRead.send({ type: 'prompt', id: 'old-checkpoints', message: 'Read checkpoints', systemPrompt: 'Synthetic complex history.' })
  await until(() => oldRead.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'old checkpoint read')
  for (const marker of ['legacy-fixture-compaction-summary', 'legacy-fixture-branch-summary']) expect(JSON.stringify(oldRead.requests[0]?.messages)).toContain(marker)
  expect(JSON.stringify(oldRead.requests[0]?.messages)).not.toContain('legacy-fixture-abandoned-side-branch')
  await oldRead.shutdown()

  const upgraded = await startFixture(() => sse({ text: 'upgraded-checkpoints-read' }), { root: old.root })
  upgraded.send({ type: 'prompt', id: 'upgrade-checkpoints', message: 'Resume complex history', systemPrompt: 'Synthetic complex history.' })
  await until(() => upgraded.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'upgraded checkpoint read')
  for (const marker of ['legacy-fixture-compaction-summary', 'legacy-fixture-branch-summary']) expect(JSON.stringify(upgraded.requests[0]?.messages)).toContain(marker)
  expect(JSON.stringify(upgraded.requests[0]?.messages)).not.toContain('legacy-fixture-abandoned-side-branch')
  await upgraded.shutdown()
  const latest = checkpoint('upgraded-fixture')
  const latestRows = (await readEntries()).filter(entry => entry.id === latest.compaction || entry.id === latest.branch)

  const rollback = await startFixture(() => sse({ text: 'rollback-checkpoints-read' }), { root: old.root, bundlePath: legacyBundle })
  rollback.send({ type: 'prompt', id: 'rollback-checkpoints', message: 'Resume new checkpoints in old runtime', systemPrompt: 'Synthetic complex history.' })
  await until(() => rollback.messages.some(m => m.type === 'event' && m.event?.type === 'agent_end'), 'rollback checkpoint read')
  for (const marker of ['upgraded-fixture-compaction-summary', 'upgraded-fixture-branch-summary']) expect(JSON.stringify(rollback.requests[0]?.messages)).toContain(marker)
  expect(JSON.stringify(rollback.requests[0]?.messages)).not.toContain('upgraded-fixture-abandoned-side-branch')
  const finalRows = await readEntries()
  for (const expected of [...initialRows, ...latestRows]) expect(finalRows.find(entry => entry.id === expected.id)).toEqual(expected)
  expect(rollback.messages.filter(m => m.type === 'error')).toHaveLength(0)
}, 30000)
