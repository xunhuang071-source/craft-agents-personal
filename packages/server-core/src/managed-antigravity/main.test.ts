import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AntigravityManager, AntigravityError } from './main.ts'
import { reservePort, type ManagerRuntime, type OwnedProcess, type SpawnSpec } from './runtime.ts'
import { validateAuthUrl, nativeAuthError } from './oauth.ts'
import { parseModel } from './types.ts'

const modelKey = 'model-test-key-never-log-0000000001'
const managementKey = 'management-test-key-never-log-0001'
const secret = 'sensitive-code-and-email-user@example.com'
const roots: string[] = []
const managers: AntigravityManager[] = []
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.dispose().catch(() => {})
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface FakeAccount { authorized: boolean }
async function fixture() {
  // All temporary writes remain within this subtask's allowed directory.
  const root = await mkdtemp(join(import.meta.dir, '.test-'))
  roots.push(root)
  const callback = await reservePort()
  const callbackPort = callback.port
  await callback.release()
  const accounts = new Map<string, FakeAccount>()
  const servers = new Set<Server>()
  const handles: OwnedProcess[] = []
  const settings = {
    spawns: 0, stops: 0, authUrls: 0, callbacks: 0, pollRequests: 0,
    catalogDown: false, failSpawn: 0, dropCallbackResponse: false,
    terminalError: '', transientPolls: 0, callbackStatus: 200, stopFails: false,
    wrongUrl: false, accountDisabled: false, noAccountAfterSuccess: false, hangProbe: false,
  }
  const configPaths: string[] = []
  const runtime: Partial<ManagerRuntime> = {
    callbackPort, startupTimeoutMs: 500, loginTimeoutMs: 3000, pollIntervalMs: 10, requestTimeoutMs: 100,
    spawn(spec: SpawnSpec) {
      settings.spawns++
      configPaths.push(spec.configPath)
      const config = JSON.parse(readFileSync(spec.configPath, 'utf8'))
      expect(config.server.host).toBe('127.0.0.1')
      expect(config.server['commercial-mode']).toBe(true)
      expect(config.management['disable-control-panel']).toBe(true)
      expect(config.management['disable-auto-update-panel']).toBe(true)
      expect(config.routing.retry['request-retry']).toBe(0)
      expect(config.observability.pprof.enable).toBe(false)
      const directory = config.oauth['auth-dir'] as string
      if (!accounts.has(directory)) accounts.set(directory, { authorized: false })
      const account = accounts.get(directory)!
      let alive = settings.failSpawn !== settings.spawns
      const state = randomUUID().replaceAll('-', '')
      const server = createServer(async (request, response) => {
        const url = new URL(request.url!, 'http://127.0.0.1')
        const json = (body: object, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)) }
        const isModel = url.pathname === '/v1/models'
        if (request.headers.authorization !== `Bearer ${isModel ? modelKey : managementKey}`) return json({ error: secret }, 401)
        if (url.pathname === '/v0/management/auth-files' && settings.hangProbe) return
        if (url.pathname === '/v0/management/auth-files') return json({ files: account.authorized && !settings.noAccountAfterSuccess ? [{ name: 'user@example.com.json', provider: 'antigravity', disabled: settings.accountDisabled, unavailable: false, status: 'active', email: 'user@example.com', access_token: secret }] : [] })
        if (url.pathname === '/v0/management/antigravity-auth-url') {
          settings.authUrls++
          expect(url.searchParams.has('is_webui')).toBe(false)
          return json({ status: 'ok', state, url: `https://${settings.wrongUrl ? 'accounts.google.com.evil.test' : 'accounts.google.com'}/o/oauth2/v2/auth?state=${state}&response_type=code&redirect_uri=${encodeURIComponent(`http://localhost:${callbackPort}/oauth-callback`)}` })
        }
        if (url.pathname === '/v0/management/oauth-callback') {
          settings.callbacks++
          let body = ''
          for await (const part of request) body += part
          const data = JSON.parse(body)
          expect(data.provider).toBe('antigravity')
          expect(data.state).toBe(state)
          if (settings.callbackStatus !== 200) return json({ error: secret }, settings.callbackStatus)
          account.authorized = true
          if (settings.dropCallbackResponse) { response.destroy(); return }
          return json({ status: 'ok' })
        }
        if (url.pathname === '/v0/management/get-auth-status') {
          settings.pollRequests++
          expect(url.searchParams.get('state')).toBe(state)
          if (settings.transientPolls > 0) { settings.transientPolls--; return json({ error: secret }, 503) }
          if (settings.terminalError) return json({ status: 'error', error: settings.terminalError, email: secret })
          return json({ status: account.authorized ? 'ok' : 'wait' })
        }
        if (url.pathname === '/v0/management/model-definitions/antigravity') return json({ models: [{ id: 'test-model', display_name: 'Test Model', context_length: 200000, max_completion_tokens: 64000, supportedInputModalities: ['text', 'image'], thinking: { levels: ['low', 'high'] } }] })
        if (url.pathname === '/v0/management/auth-files/models') return settings.catalogDown ? json({ error: secret }, 503) : json({ models: [{ id: 'test-model', display_name: 'Test Model' }, { id: 'account-only-model' }] })
        if (url.pathname === '/v1/models') return settings.catalogDown ? json({ error: secret }, 503) : json({ data: [{ id: 'test-model' }, { id: 'route-only-model' }] })
        return json({ error: secret }, 404)
      })
      if (alive) {
        servers.add(server)
        server.on('error', () => { alive = false })
        server.listen(config.server.port, '127.0.0.1')
      }
      const handle: OwnedProcess = {
        get alive() { return alive },
        async stop() {
          settings.stops++
          if (settings.stopFails) throw new Error(secret)
          alive = false
          server.closeAllConnections()
          if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
          servers.delete(server)
        },
      }
      handles.push(handle)
      return handle
    },
  }
  const manager = new AntigravityManager({ rootDir: root, binaryPath: '/trusted/test/cli-proxy-api', keys: { modelKey, managementKey } }, runtime)
  managers.push(manager)
  const callbackUrl = (url: string, code = secret) => {
    const state = new URL(url).searchParams.get('state')!
    return `http://127.0.0.1:${callbackPort}/oauth-callback?state=${state}&code=${encodeURIComponent(code)}`
  }
  const authorize = async (url: string) => { expect((await fetch(callbackUrl(url))).status).toBe(200) }
  const connect = () => manager.connect(authorize)
  return { root, manager, settings, runtime, connect, authorize, callbackUrl, configPaths, servers, handles }
}

async function errorCode(task: Promise<unknown>) {
  try { await task; throw new Error('expected rejection') }
  catch (error) { expect(error).toBeInstanceOf(AntigravityError); expect(String(error)).not.toContain(secret); return (error as AntigravityError).code }
}

describe('managed Antigravity process/OAuth contract', () => {
  test('getStatus is read-only and never starts or creates metadata', async () => {
    const f = await fixture()
    expect(await f.manager.getStatus()).toEqual({ state: 'disconnected' })
    expect(f.settings.spawns).toBe(0)
    expect(await readdir(f.root)).toEqual([])
    expect(await errorCode(f.manager.ensureReady())).toBe('not_connected')
    expect(await readdir(f.root)).toEqual([])
  })

  test('connect confirms account, merges catalogs and reliable metadata, never persists secrets', async () => {
    const f = await fixture()
    const result = await f.connect()
    expect(result.binding.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    expect(result.binding.apiKey).toBe(modelKey)
    expect(result.models).toContainEqual({ id: 'test-model', name: 'Test Model', contextWindow: 200000, maxTokens: 64000, supportsImages: true, reasoning: true })
    expect(result.models.map(m => m.id)).toContain('account-only-model')
    expect(result.models.map(m => m.id)).toContain('route-only-model')
    const stateText = await readFile(join(f.root, 'state.json'), 'utf8')
    const status = JSON.stringify(await f.manager.getStatus())
    for (const value of [modelKey, managementKey, secret, 'user@example.com', 'https://accounts.google.com']) {
      expect(stateText).not.toContain(value)
      expect(status).not.toContain(value)
    }
    expect((await stat(join(f.root, 'state.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(f.configPaths.at(-1)!)).mode & 0o777).toBe(0o600)
    expect(f.settings.authUrls).toBe(1)
    expect(f.settings.callbacks).toBe(1)
    expect(f.settings.spawns).toBe(2)
  })

  test('dispose retains authorization and parallel ensureReady launches exactly one stable endpoint', async () => {
    const f = await fixture()
    const before = await f.connect()
    await f.manager.dispose()
    await f.manager.dispose()
    expect(await readdir(join(f.root, 'run'))).toEqual([])
    const next = new AntigravityManager({ rootDir: f.root, binaryPath: '/trusted/test/cli-proxy-api', keys: { modelKey, managementKey } }, f.runtime)
    managers.push(next)
    const bindings = await Promise.all(Array.from({ length: 20 }, () => next.ensureReady()))
    expect(f.settings.spawns).toBe(3)
    expect(bindings.every(binding => binding.baseUrl === before.binding.baseUrl)).toBe(true)
    expect(f.settings.authUrls).toBe(1)
  })

  test('cancel candidate preserves active and handles simultaneous connect as one login', async () => {
    const f = await fixture()
    const original = await f.connect()
    const stateBefore = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8'))
    let opened!: () => void
    const shown = new Promise<void>(resolve => { opened = resolve })
    const task = f.manager.connect(() => { opened() })
    expect(f.manager.connect(() => { throw new Error('must not open twice') })).toBe(task)
    await shown
    expect((await f.manager.getStatus()).state).toBe('connecting')
    await f.manager.cancelLogin()
    expect(await errorCode(task)).toBe('cancelled')
    const stateAfter = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8'))
    expect(stateAfter.active).toEqual(stateBefore.active)
    expect(stateAfter.accounts.length).toBe(1)
    expect(await f.manager.ensureReady()).toEqual(original.binding)
    expect((await f.manager.getStatus()).state).toBe('connected')
  })

  test('failed candidate startup and failed replacement retain old active authorization', async () => {
    const f = await fixture()
    const original = await f.connect()
    const state = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8'))
    f.settings.failSpawn = 3
    expect(await errorCode(f.connect())).toBe('process_exit')
    expect(JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).active).toEqual(state.active)
    f.settings.failSpawn = 5 // candidate starts as #4, stable replacement #5 fails
    expect(await errorCode(f.connect())).toBe('process_exit')
    expect(JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).active).toEqual(state.active)
    f.settings.failSpawn = 0
    expect(await f.manager.ensureReady()).toEqual(original.binding)
  })

  test('ambiguous lost callback response is never replayed; transient status failures recover', async () => {
    const f = await fixture()
    f.settings.dropCallbackResponse = true
    f.settings.transientPolls = 2
    await f.connect()
    expect(f.settings.callbacks).toBe(1)
    expect(f.settings.pollRequests).toBeGreaterThanOrEqual(3)
    expect((await f.manager.getStatus()).state).toBe('connected')
  })

  test('callback is transported once, with wrong-state requests rejected', async () => {
    const f = await fixture()
    await f.manager.connect(async url => {
      expect((await fetch(f.callbackUrl(url).replace(/state=[^&]+/, 'state=invalid'))).status).toBe(400)
      expect((await fetch(f.callbackUrl(url))).status).toBe(200)
      expect((await fetch(f.callbackUrl(url))).status).toBe(409)
    })
    expect(f.settings.callbacks).toBe(1)
  })

  test('deterministic callback rejection terminates with a fixed code', async () => {
    const f = await fixture()
    f.settings.callbackStatus = 400
    expect(await errorCode(f.connect())).toBe('callback_rejected')
    expect(f.settings.callbacks).toBe(1)
    expect((await f.manager.getStatus()).error).toBe('callback_rejected')
    expect(JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).accounts).toEqual([])
  })

  test('unknown native errors and raw browser errors are never exposed', async () => {
    const f = await fixture()
    f.settings.terminalError = secret
    expect(await errorCode(f.manager.connect(() => {}))).toBe('oauth_failed')
    expect(JSON.stringify(await f.manager.getStatus())).not.toContain(secret)
    f.settings.terminalError = ''
    expect(await errorCode(f.manager.connect(() => { throw new Error(secret) }))).toBe('auth_url')
  })

  test('Google URL validation is exact and no invalid URL reaches caller', async () => {
    const f = await fixture()
    f.settings.wrongUrl = true
    let opens = 0
    expect(await errorCode(f.manager.connect(() => { opens++ }))).toBe('auth_url')
    expect(opens).toBe(0)
    expect(f.settings.authUrls).toBe(1)
  })

  test('occupied OAuth callback port fails before creating an auth URL', async () => {
    const f = await fixture()
    const held = await reservePort(f.runtime.callbackPort)
    try {
      expect(await errorCode(f.connect())).toBe('port_in_use')
      expect(f.settings.authUrls).toBe(0)
    } finally { await held.release() }
  })

  test('occupied stable port is never adopted or probed as a stranger service', async () => {
    const f = await fixture()
    const connected = await f.connect()
    await f.manager.dispose()
    const port = Number(new URL(connected.binding.baseUrl).port)
    const held = await reservePort(port)
    const next = new AntigravityManager({ rootDir: f.root, binaryPath: '/trusted/test/cli-proxy-api', keys: { modelKey, managementKey } }, f.runtime)
    managers.push(next)
    try {
      expect(await errorCode(next.ensureReady())).toBe('port_in_use')
      expect(f.settings.spawns).toBe(2)
      expect(await errorCode(next.disconnect())).toBe('port_in_use')
      expect(JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).active).toBeDefined()
    } finally { await held.release() }
  })

  test('catalog failure retains first authorization and cache on refresh failure', async () => {
    const f = await fixture()
    f.settings.catalogDown = true
    expect(await errorCode(f.connect())).toBe('catalog_unavailable')
    expect(await f.manager.getStatus()).toEqual({ state: 'connected', error: 'catalog_unavailable', models: [] })
    await f.manager.ensureReady()
    f.settings.catalogDown = false
    const models = await f.manager.refreshModels()
    f.settings.catalogDown = true
    expect(await errorCode(f.manager.refreshModels())).toBe('catalog_unavailable')
    expect((await f.manager.getStatus()).models).toEqual(models)
  })

  test('catalog failure during account switch preserves original active', async () => {
    const f = await fixture()
    await f.connect()
    const previous = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).active
    f.settings.catalogDown = true
    expect(await errorCode(f.connect())).toBe('catalog_unavailable')
    const after = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8'))
    expect(after.active).toEqual(previous)
    expect(after.accounts.length).toBe(1)
  })

  test('completed OAuth status still requires saved usable Antigravity account', async () => {
    const f = await fixture()
    f.settings.noAccountAfterSuccess = true
    expect(await errorCode(f.connect())).toBe('account_unavailable')
    expect((await f.manager.getStatus()).state).toBe('error')
  })

  test('disconnect cleans own auth and config but not unrelated root files', async () => {
    const f = await fixture()
    await f.connect()
    await writeFile(join(f.root, 'unrelated.txt'), 'keep')
    await f.manager.disconnect()
    expect(await f.manager.getStatus()).toEqual({ state: 'disconnected' })
    expect(await readdir(join(f.root, 'accounts'))).toEqual([])
    expect(await readFile(join(f.root, 'unrelated.txt'), 'utf8')).toBe('keep')
    expect(await errorCode(f.manager.ensureReady())).toBe('not_connected')
  })

  test('corrupt metadata fails closed and is not overwritten', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'state.json'), `{\"secret\":\"${secret}\"}`)
    expect(await f.manager.getStatus()).toEqual({ state: 'error', error: 'state_format' })
    expect(await errorCode(f.connect())).toBe('state_format')
    expect(f.settings.spawns).toBe(0)
    expect(await readFile(join(f.root, 'state.json'), 'utf8')).toContain(secret)
  })

  test('successful account replacement retains endpoint and deletes only retired authorization', async () => {
    const f = await fixture()
    const first = await f.connect()
    const old = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).active.id
    const second = await f.connect()
    expect(second.binding).toEqual(first.binding)
    const current = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8'))
    expect(current.active.id).not.toBe(old)
    expect(current.accounts).toEqual([{ id: current.active.id, port: current.port }])
    expect(await readdir(join(f.root, 'accounts'))).toEqual([current.active.id])
    expect(f.handles.filter(handle => handle.alive).length).toBe(1)
  })

  test('cancel also interrupts an unresolved browser-opening callback', async () => {
    const f = await fixture()
    let signalOpened!: () => void
    const opened = new Promise<void>(resolve => { signalOpened = resolve })
    const task = f.manager.connect(() => { signalOpened(); return new Promise<void>(() => {}) })
    await opened
    await f.manager.cancelLogin()
    expect(await errorCode(task)).toBe('cancelled')
    expect(f.handles.every(handle => !handle.alive)).toBe(true)
    expect((await f.manager.getStatus()).state).toBe('disconnected')
  })

  test('startup hard deadline cancels a stalled HTTP response and cleans its owned process', async () => {
    const f = await fixture()
    f.settings.hangProbe = true
    const short = new AntigravityManager({ rootDir: f.root, binaryPath: '/trusted/test/cli-proxy-api', keys: { modelKey, managementKey } }, { ...f.runtime, startupTimeoutMs: 80, requestTimeoutMs: 5000 })
    managers.push(short)
    const started = Date.now()
    expect(await errorCode(short.connect(() => {}))).toBe('startup_timeout')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(f.handles.every(handle => !handle.alive)).toBe(true)
    expect(f.settings.authUrls).toBe(0)
  })

  test('stop failure retains owned handle and directory, exposes only a fixed error, then can retry dispose', async () => {
    const f = await fixture()
    let signalOpened!: () => void
    const opened = new Promise<void>(resolve => { signalOpened = resolve })
    const task = f.manager.connect(() => { signalOpened() })
    await opened
    f.settings.stopFails = true
    expect(await errorCode(f.manager.cancelLogin())).toBe('process_stop')
    expect(await errorCode(task)).toBe('process_stop')
    expect((await f.manager.getStatus()).error).toBe('process_stop')
    expect((await readdir(join(f.root, 'accounts'))).length).toBe(1)
    expect(f.handles.some(handle => handle.alive)).toBe(true)
    expect(await errorCode(f.manager.dispose())).toBe('process_stop')
    f.settings.stopFails = false
    await f.manager.dispose()
    expect(f.handles.every(handle => !handle.alive)).toBe(true)
  })

  test('dispose during authorization stops candidate without removing existing active authorization', async () => {
    const f = await fixture()
    await f.connect()
    const previous = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).active
    let signalOpened!: () => void
    const opened = new Promise<void>(resolve => { signalOpened = resolve })
    const task = f.manager.connect(() => { signalOpened() })
    await opened
    await f.manager.dispose()
    expect(await errorCode(task)).toBe('cancelled')
    expect(JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).active).toEqual(previous)
    expect(f.handles.every(handle => !handle.alive)).toBe(true)
    expect(await errorCode(f.manager.ensureReady())).toBe('disposed')
  })

  test('OAuth timeout stops candidate and releases callback port', async () => {
    const f = await fixture()
    const short = new AntigravityManager({ rootDir: f.root, binaryPath: '/trusted/test/cli-proxy-api', keys: { modelKey, managementKey } }, { ...f.runtime, loginTimeoutMs: 100 })
    managers.push(short)
    expect(await errorCode(short.connect(() => {}))).toBe('oauth_timeout')
    const port = await reservePort(f.runtime.callbackPort)
    await port.release()
    expect(JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).accounts).toEqual([])
  })
})

test('allowlisted upstream stages and unknown capabilities are not guessed', () => {
  expect(nativeAuthError('Failed to exchange token').code).toBe('oauth_exchange')
  expect(nativeAuthError(secret).code).toBe('oauth_failed')
  expect(parseModel({ id: 'claude-thinking-image-unknown' })).toEqual({ id: 'claude-thinking-image-unknown' })
  expect(parseModel({ id: 'test-model', supportedInputModalities: ['text'] })).toEqual({ id: 'test-model', supportsImages: false })
  expect(parseModel({ id: 'user@example.com' })).toBeUndefined()
  const good = 'https://accounts.google.com/o/oauth2/v2/auth?state=abc&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A51121%2Foauth-callback'
  expect(validateAuthUrl(good, 'abc')).toBe(good)
  for (const url of [good.replace('https:', 'http:'), good.replace('accounts.google.com/', 'accounts.google.com.evil/'), good.replace('state=abc', 'state=def'), good.replace('51121', '8080'), `${good}&state=abc`]) {
    expect(() => validateAuthUrl(url, 'abc')).toThrow('auth_url')
  }
  expect(() => new AntigravityManager({ rootDir: '/tmp/test', keys: { modelKey, managementKey: modelKey } })).toThrow('invalid_keys')
  expect(() => new AntigravityManager({ rootDir: '/tmp/test', keys: { modelKey, managementKey: 'a'.repeat(72) } })).toThrow('invalid_keys')
})
