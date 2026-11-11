import { test, expect } from 'bun:test'
import { SourceCredentialManager } from '../credential-manager.ts'
import type { LoadedSource } from '../types.ts'
test('failed MCP exchange never overwrites the previous credential', async () => {
  const original = globalThis.fetch
  const manager = new SourceCredentialManager()
  let saved = 0
  manager.save = async () => { saved++ }
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid_scope', error_description: 'Fixture rejected scopes' }), { status: 400 })) as typeof fetch
  try {
    const result = await manager.exchangeAndStore({ config: { slug: 'fixture' } } as LoadedSource, 'mcp', { code: 'fixture-code', codeVerifier: 'fixture-verifier', clientId: 'fixture-client', redirectUri: 'http://localhost:8914/oauth/callback', tokenEndpoint: 'https://example.com/token' })
    expect(result.success).toBe(false)
    expect(saved).toBe(0)
  } finally { globalThis.fetch = original }
})
