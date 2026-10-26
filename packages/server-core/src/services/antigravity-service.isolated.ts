import { describe, expect, it, mock } from 'bun:test'
// Run alone: module mocks must never leak into other server tests.
const connections = new Map<string, any>()
const keys = new Map<string, string>()
const originalConnections = [
  ...Array.from({ length: 4 }, (_, i) => ({ slug: `existing-api-${i}`, name: `Existing ${i}`, providerType: 'pi_compat', authType: 'api_key_with_endpoint', models: [{ id: `existing-model-${i}` }] })),
  { slug: 'chatgpt-plus', providerType: 'pi', authType: 'oauth', defaultModel: 'pi/gpt-6.1-sol', models: [{ id: 'pi/gpt-6.1-sol', contextWindow: 500000 }] },
]
for (const c of originalConnections) connections.set(c.slug, structuredClone(c))
for (let i = 0; i < 4; i++) keys.set(`existing-api-${i}`, `fixture-existing-secret-${i}`)
const instances: FakeManager[] = []
let firstRead = true
let releaseFirstRead!: () => void
const gate = new Promise<void>(resolve => { releaseFirstRead = resolve })
class FakeError extends Error { constructor(readonly code: string) { super(code) } }
class FakeManager {
  readyCalls = 0
  disposed = false
  connected = false
  constructor(readonly options: any) { instances.push(this) }
  async getStatus() { return { state: this.connected ? 'connected' : 'disconnected', models: this.connected ? this.models : [] } }
  models = [{ id: 'gemini-fixture', contextWindow: 1048576, maxTokens: 65536, reasoning: true, supportsImages: true }]
  async connect(open: (url: string) => Promise<void>) {
    await open('https://accounts.google.com/o/oauth2/v2/auth?state=fixture')
    this.connected = true
    return { binding: await this.ensureReady(), models: this.models }
  }
  async ensureReady() { this.readyCalls++; return { baseUrl: 'http://127.0.0.1:45454/v1', apiKey: this.options.keys.modelKey } }
  async refreshModels() { return this.models }
  async cancelLogin() {}
  async disconnect() { this.connected = false }
  async dispose() { this.disposed = true }
}
mock.module('@craft-agent/shared/config', () => ({
  getLlmConnection: (slug: string) => connections.get(slug),
  getLlmConnections: () => [...connections.values()],
  getDefaultLlmConnection: () => 'chatgpt-plus',
  addLlmConnection: (connection: any) => { connections.set(connection.slug, connection); return connection },
  updateLlmConnection: (slug: string, update: any) => {
    const merged = { ...connections.get(slug), ...update }; connections.set(slug, merged); return merged
  },
  resolveConfigDir: () => '/disposable-service-fixture',
}))
mock.module('@craft-agent/shared/credentials', () => ({ getCredentialManager: () => ({
  async getLlmApiKey(slug: string) {
    if (firstRead) { firstRead = false; await gate }
    return keys.get(slug) ?? null
  },
  async setLlmApiKey(slug: string, value: string) { keys.set(slug, value) },
  async deleteLlmCredentials(slug: string) { keys.delete(slug) },
}) }))
mock.module('../managed-antigravity/main', () => ({ AntigravityManager: FakeManager, AntigravityError: FakeError }))
const service = await import('./antigravity-service')
const { ensureConnectionReady } = await import('@craft-agent/shared/agent/connection-preflight')
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function waitForLogin() {
  for (let i = 0; i < 100; i++) {
    if ((await service.getAntigravityStatus()).state === 'connected') return
    await tick()
  }
  throw new Error('Fixture login did not finish')
}

describe('managed Antigravity host integration', () => {
  it('can create a manager when a concurrent read-only status lookup resolves to null', async () => {
    service.initializeAntigravityService()
    const reading = service.getAntigravityStatus()
    let browserCalls = 0; let refreshCalls = 0
    const starting = service.startAntigravityLogin(async url => {
      expect(new URL(url).hostname).toBe('accounts.google.com'); browserCalls++
    }, async () => { refreshCalls++ })
    releaseFirstRead()
    await reading; await starting; await waitForLogin()
    expect(instances).toHaveLength(1)
    expect(browserCalls).toBe(1)
    expect(refreshCalls).toBe(1)
    expect(keys.size).toBe(6)
    const connection = connections.get(service.ANTIGRAVITY_SLUG)
    expect(connection.baseUrl).toBe('http://127.0.0.1:45454') // Anthropic adds /v1/messages itself.
    expect(connection.managedProvider).toBe('antigravity')
    expect(connection.piAuthProvider).toBe('anthropic') // Without it Pi omits the saved proxy key.
    expect(connection.models[0].maxOutputTokens).toBe(65536)
    expect(connection.models[0].supportsThinking).toBe(true)
  })
  it('starts only the specifically managed connection during the preflight hook', async () => {
    const manager = instances[0]!
    const previous = manager.readyCalls
    await ensureConnectionReady('chatgpt-plus')
    expect(manager.readyCalls).toBe(previous)
    await ensureConnectionReady(service.ANTIGRAVITY_SLUG)
    expect(manager.readyCalls).toBe(previous + 1)
  })
  it('keeps the credential generation stable for a model-catalog refresh', async () => {
    const previous = connections.get(service.ANTIGRAVITY_SLUG).managedCredentialVersion
    await service.refreshAntigravityModels()
    expect(connections.get(service.ANTIGRAVITY_SLUG).managedCredentialVersion).toBe(previous)
  })
  it('revokes only its own keys, keeps history identity, and rotates the restart generation', async () => {
    const old = connections.get(service.ANTIGRAVITY_SLUG).managedCredentialVersion
    keys.set('unrelated-key', 'do-not-touch')
    await service.disconnectAntigravity()
    expect(keys.get('unrelated-key')).toBe('do-not-touch')
    expect(keys.size).toBe(5)
    expect(connections.has(service.ANTIGRAVITY_SLUG)).toBe(true)
    expect(connections.get(service.ANTIGRAVITY_SLUG).managedCredentialVersion).not.toBe(old)
    expect(instances[0]!.disposed).toBe(true)
  })
  it('reconnects with a fresh proxy key pair and another restart generation', async () => {
    const previous = connections.get(service.ANTIGRAVITY_SLUG).managedCredentialVersion
    const firstKey = instances[0]!.options.keys.modelKey
    await service.startAntigravityLogin(async () => {}, () => {})
    await waitForLogin()
    expect(instances).toHaveLength(2)
    expect(instances[1]!.options.keys.modelKey).not.toBe(firstKey)
    expect(connections.get(service.ANTIGRAVITY_SLUG).managedCredentialVersion).not.toBe(previous)
    expect(keys.get('unrelated-key')).toBe('do-not-touch')
    await service.disposeAntigravityService()
  })
})

it('preserves all five original connections, 500K descriptor and all four API keys through login/refresh/disconnect/reconnect', () => {
  expect([...connections.values()].filter(c => c.slug !== service.ANTIGRAVITY_SLUG)).toEqual(originalConnections)
  for (let i = 0; i < 4; i++) expect(keys.get(`existing-api-${i}`)).toBe(`fixture-existing-secret-${i}`)
})
