import { afterEach, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Explicit opt-in: a built subprocess, local HTTP only, temporary files only.
const bundle = process.env.CRAFT_PI_TEST_BUNDLE
const integration = bundle ? test : test.skip
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
type Row = Record<string, any>
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean, label: string, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (predicate()) return; await wait(10) }
  throw new Error(`Timed out waiting for ${label}`)
}
function sse(content: { text?: string; tool?: { id: string; name: string; input: Row } }) {
  const events: Row[] = [{ type: 'message_start', message: {
    id: `fixture-${Math.random()}`, type: 'message', role: 'assistant', model: 'fixture-gemini', content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 0 },
  } }]
  if (content.tool) {
    events.push({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: content.tool.id, name: content.tool.name, input: {} } })
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(content.tool.input) } })
  } else {
    events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content.text ?? 'OK' } })
  }
  events.push({ type: 'content_block_stop', index: 0 })
  events.push({ type: 'message_delta', delta: { stop_reason: content.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } })
  events.push({ type: 'message_stop' })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}
async function startFixture(handler: (request: Request, body: Row) => Response | Promise<Response>) {
  const root = await mkdtemp(join(tmpdir(), 'craft-managed-pi-'))
  const config = join(root, 'config'); const session = join(root, 'workspace', 'sessions', 'test-session')
  await mkdir(session, { recursive: true })
  const requests: Row[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe('/v1/messages')
    expect(request.headers.get('x-api-key')).toBe('local-fixture-key')
    const body = await request.json() as Row; requests.push(body)
    return handler(request, body)
  } })
  const child = spawn(process.execPath, [bundle!], {
    cwd: root,
    env: { ...process.env, CRAFT_CONFIG_DIR: config, CRAFT_DEBUG: '0' }, stdio: 'pipe',
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
    if (message.type === 'tool_execute_request') send({ type: 'tool_execute_response', requestId: message.requestId, result: { content: 'fixture MCP result', isError: false } })
  })
  cleanups.push(async () => {
    if (!exited) { send({ type: 'shutdown' }); await wait(100); child.kill('SIGTERM') }
    server.stop(true)
    await until(() => exited, 'child shutdown', 3000).catch(() => child.kill('SIGKILL'))
    await rm(root, { recursive: true, force: true })
  })
  send({ type: 'init', managedProvider: 'antigravity', apiKey: 'local-fixture-key',
    model: 'fixture-gemini', cwd: root, workingDirectory: root,
    thinkingLevel: 'off', workspaceRootPath: join(root, 'workspace'), workspaceId: 'fixture',
    sessionId: 'test-session', sessionPath: session, plansFolderPath: join(session, 'plans'),
    providerType: 'pi_compat', authType: 'api_key_with_endpoint',
    baseUrl: `http://127.0.0.1:${server.port}`, customEndpoint: { api: 'anthropic-messages' },
    customModels: [{ id: 'fixture-gemini', supportsImages: true, contextWindow: 1048576, maxTokens: 65536 }],
  })
  await until(() => messages.some(m => m.type === 'ready') || exited, 'subprocess ready')
  if (exited) throw new Error(`Subprocess failed: ${stderr}`)
  return { root, send, messages, requests, stderr: () => stderr }
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

integration('real Pi subprocess: 429 ends the turn without request replay', async () => {
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
