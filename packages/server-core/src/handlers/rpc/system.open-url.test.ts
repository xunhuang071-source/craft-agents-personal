import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CLIENT_OPEN_EXTERNAL, CLIENT_OPEN_PATH, CLIENT_SHOW_IN_FOLDER } from '@craft-agent/server-core/transport'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSystemCoreHandlers } from './system'

function createTestHarness(overrides?: { workspaceId?: string | null }) {
  const handlers = new Map<string, HandlerFn>()
  const invokeClientCalls: Array<{ clientId: string; channel: string; args: any[] }> = []
  const pushCalls: Array<{ channel: string; target: any; args: any[] }> = []

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, target, ...args) {
      pushCalls.push({ channel, target, args })
    },
    async invokeClient(clientId, channel, ...args) {
      invokeClientCalls.push({ clientId, channel, args })
      return undefined
    },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }

  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  }

  registerSystemCoreHandlers(server, deps)

  const openUrl = handlers.get(RPC_CHANNELS.shell.OPEN_URL)
  if (!openUrl) {
    throw new Error('OPEN_URL handler not registered')
  }

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: overrides?.workspaceId ?? 'ws-1',
    webContentsId: 101,
  }

  const showInFolder = handlers.get(RPC_CHANNELS.shell.SHOW_IN_FOLDER)!
  return { openUrl, showInFolder, ctx, invokeClientCalls, pushCalls }
}

describe('registerSystemCoreHandlers SHOW_IN_FOLDER', () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'craft-finder-links-')))
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  it('reveals an existing iCloud-style Chinese file without launching its application', async () => {
    const folder = join(temp, 'Mobile Documents', 'com~apple~CloudDocs', '工作')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, '报告 final.pdf')
    writeFileSync(file, 'fixture')
    const { showInFolder, ctx, invokeClientCalls } = createTestHarness()
    await showInFolder(ctx, file)
    expect(invokeClientCalls).toEqual([
      { clientId: 'client-1', channel: CLIENT_SHOW_IN_FOLDER, args: [file] },
    ])
  })

  it('opens the directory itself rather than selecting it in its parent', async () => {
    const { showInFolder, ctx, invokeClientCalls } = createTestHarness()
    await showInFolder(ctx, temp)
    expect(invokeClientCalls).toEqual([
      { clientId: 'client-1', channel: CLIENT_OPEN_PATH, args: [temp] },
    ])
  })

  it.each([':12', ':12:3'])('resolves line references before revealing: %s', async (suffix) => {
    const file = join(temp, 'source.md')
    writeFileSync(file, 'fixture')
    const { showInFolder, ctx, invokeClientCalls } = createTestHarness()
    await showInFolder(ctx, file + suffix)
    expect(invokeClientCalls[0]).toEqual({ clientId: 'client-1', channel: CLIENT_SHOW_IN_FOLDER, args: [file] })
  })

  it('preserves a literal filename ending in a colon and digits when it exists', async () => {
    const file = join(temp, 'report.md:12')
    writeFileSync(file, 'fixture')
    const { showInFolder, ctx, invokeClientCalls } = createTestHarness()
    await showInFolder(ctx, file)
    expect(invokeClientCalls[0]?.args).toEqual([file])
  })

  it.each(['missing.pdf', 'missing.md:12'])('reports missing files without calling Finder: %s', async (name) => {
    const { showInFolder, ctx, invokeClientCalls } = createTestHarness()
    await expect(showInFolder(ctx, join(temp, name))).rejects.toThrow('文件不存在')
    expect(invokeClientCalls).toHaveLength(0)
  })

  it('keeps sensitive path restrictions after stripping a line reference', async () => {
    const { showInFolder, ctx, invokeClientCalls } = createTestHarness()
    await expect(showInFolder(ctx, join(temp, '.env:12'))).rejects.toThrow('sensitive files')
    expect(invokeClientCalls).toHaveLength(0)
  })
})

describe('registerSystemCoreHandlers OPEN_URL', () => {
  it('routes craftagents action links internally via deeplink:navigate', async () => {
    const { openUrl, ctx, invokeClientCalls, pushCalls } = createTestHarness()

    await openUrl(ctx, 'craftagents://action/new-session?input=sg&send=true')

    expect(invokeClientCalls).toHaveLength(0)
    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0]).toEqual({
      channel: RPC_CHANNELS.deeplink.NAVIGATE,
      target: { to: 'client', clientId: 'client-1' },
      args: [{ action: 'new-session', actionParams: { input: 'sg', send: 'true' } }],
    })
  })

  it('routes workspace deep links to workspace target when URL workspace differs', async () => {
    const { openUrl, ctx, invokeClientCalls, pushCalls } = createTestHarness({ workspaceId: 'ws-1' })

    await openUrl(ctx, 'craftagents://workspace/ws-2/action/new-session?input=hello')

    expect(invokeClientCalls).toHaveLength(0)
    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0]).toEqual({
      channel: RPC_CHANNELS.deeplink.NAVIGATE,
      target: { to: 'workspace', workspaceId: 'ws-2' },
      args: [{ action: 'new-session', actionParams: { input: 'hello' } }],
    })
  })

  it('falls back to client openExternal for craftagents window-mode links', async () => {
    const { openUrl, ctx, invokeClientCalls, pushCalls } = createTestHarness()

    await openUrl(ctx, 'craftagents://action/new-session?window=focused')

    expect(pushCalls).toHaveLength(0)
    expect(invokeClientCalls).toHaveLength(1)
    expect(invokeClientCalls[0]).toEqual({
      clientId: 'client-1',
      channel: CLIENT_OPEN_EXTERNAL,
      args: ['craftagents://action/new-session?window=focused'],
    })
  })

  it('keeps forwarding normal http URLs via client openExternal', async () => {
    const { openUrl, ctx, invokeClientCalls } = createTestHarness()

    await openUrl(ctx, 'https://example.com')

    expect(invokeClientCalls).toHaveLength(1)
    expect(invokeClientCalls[0]).toEqual({
      clientId: 'client-1',
      channel: CLIENT_OPEN_EXTERNAL,
      args: ['https://example.com'],
    })
  })

  it('rejects unsupported protocols with a per-scheme reason', async () => {
    const { openUrl, ctx } = createTestHarness()

    // OPEN_URL uses a blocklist (url-safety.ts) and rejects known-dangerous
    // schemes by name. file: is one of them — and the most important on
    // Windows where it's an RCE vector. The thrown error includes the
    // scheme in parens and a human-readable reason so the renderer can
    // show a useful toast instead of a generic "Invalid URL".
    await expect(openUrl(ctx, 'file:///tmp/test.txt')).rejects.toThrow(
      /^Failed to open URL: URL blocked \(file:\)\. file: URLs are blocked /,
    )
  })

  it('rejects javascript: URLs with the JavaScript-specific reason', async () => {
    const { openUrl, ctx } = createTestHarness()

    await expect(openUrl(ctx, 'javascript:alert(1)')).rejects.toThrow(
      /^Failed to open URL: URL blocked \(javascript:\)\. JavaScript URLs /,
    )
  })

  it('rejects malformed URLs through the shared classifier instead of raw URL parsing', async () => {
    const { openUrl, ctx } = createTestHarness()

    await expect(openUrl(ctx, 'not a url')).rejects.toThrow(
      /^Failed to open URL: URL blocked\. URL is malformed and cannot be parsed\./,
    )
  })
})
