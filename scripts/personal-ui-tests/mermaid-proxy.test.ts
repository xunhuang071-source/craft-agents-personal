import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleMermaidValidate } from '../../packages/session-tools-core/src/handlers/mermaid-validate'
import type { SessionToolContext } from '../../packages/session-tools-core/src/context'

// Explicit opt-in. Only local mock HTTP, artificial diagrams and disposable files.
const bundle = process.env.CRAFT_PI_TEST_BUNDLE
const integration = bundle ? test : test.skip
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean, label: string) {
  const end = Date.now() + 15000
  while (Date.now() < end) { if (predicate()) return; await wait(10) }
  throw Error(`Timed out: ${label}`)
}
function stream(tool?: string) {
  const events: Record<string, unknown>[] = [
    { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id: 'fixture-diagram', name: tool, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify({ code: 'mindmap\n  root((开始))\n    结束' }) } : { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}
integration('frozen Pi delegates Mermaid validation to the host Pele handler', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-pele-proxy-'))
  const session = join(root, 'workspace/sessions/fixture')
  await mkdir(session, { recursive: true })
  let calls = 0, delegated = 0, done = false, exited = false, valid = false
  const tool = 'mcp__session__mermaid_validate'
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe('/v1/messages')
    const body = await request.json() as any
    expect(body.tools.some((t: any) => t.name === tool)).toBe(true)
    return stream(calls++ === 0 ? tool : undefined)
  } })
  const child = spawn(process.execPath, [bundle!], { cwd: root, stdio: 'pipe', env: {
    PATH: process.env.PATH, HOME: root, CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_DEBUG: '0',
  } })
  const send = (message: unknown) => child.stdin!.write(JSON.stringify(message) + '\n')
  child.once('exit', () => { exited = true })
  child.stderr!.resume()
  createInterface({ input: child.stdout! }).on('line', async line => {
    let m: any; try { m = JSON.parse(line) } catch { return }
    if (m.type === 'ready') {
      send({ type: 'register_tools', tools: [{ name: tool, description: 'Local Mermaid fixture', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } }] })
      send({ type: 'prompt', id: 'fixture-turn', message: 'Validate the fixture diagram', systemPrompt: 'Use the provided local tool.' })
    }
    if (m.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: m.requestId, action: 'allow' })
    if (m.type === 'tool_execute_request') {
      expect(m.toolName).toBe(tool)
      delegated++
      const result = await handleMermaidValidate({} as SessionToolContext, m.args)
      const text = result.content.find(c => c.type === 'text')?.text ?? ''
      valid = JSON.parse(text).valid
      send({ type: 'tool_execute_response', requestId: m.requestId, result: { content: text, isError: Boolean(result.isError) } })
    }
    if (m.type === 'event' && m.event?.type === 'agent_end') done = true
  })
  try {
    send({ type: 'init', managedProvider: 'antigravity', apiKey: 'local-fixture-key', model: 'fixture', cwd: root, workingDirectory: root,
      thinkingLevel: 'off', workspaceRootPath: join(root, 'workspace'), workspaceId: 'fixture', sessionId: 'fixture', sessionPath: session,
      plansFolderPath: join(session, 'plans'), agentDir: join(root, 'agent'), providerType: 'pi_compat', authType: 'api_key_with_endpoint',
      baseUrl: `http://127.0.0.1:${server.port}`, customEndpoint: { api: 'anthropic-messages' },
      customModels: [{ id: 'fixture', contextWindow: 128000, maxTokens: 4096 }],
    })
    await until(() => done || exited, 'local Mermaid tool completion')
    expect(done).toBe(true); expect(delegated).toBe(1); expect(valid).toBe(true); expect(calls).toBe(2)
  } finally {
    send({ type: 'shutdown' }); await wait(100); if (!exited) child.kill('SIGTERM')
    server.stop(true)
    await until(() => exited, 'fixture shutdown').catch(() => child.kill('SIGKILL'))
    await rm(root, { recursive: true, force: true })
  }
}, 25000)
