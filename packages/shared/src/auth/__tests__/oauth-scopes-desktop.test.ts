import { test, expect, mock } from 'bun:test'
let opened = ''
mock.module('../../utils/open-url.ts', () => ({ openUrl: async (url: string) => { opened = url } }))
const { CraftOAuth } = await import('../oauth.ts')
test('desktop authorize preserves PKCE and local redirect with optional scopes', async () => {
  for (const scopes of [undefined, [], ['app:read', 'app:write']]) {
    const oauth = new CraftOAuth({ mcpUrl: 'https://example.com/mcp', scopes }, { onStatus: () => {}, onError: () => {} }) as any
    oauth.getServerMetadata = async () => ({ authorization_endpoint: 'https://example.com/authorize', token_endpoint: 'https://example.com/token' })
    oauth.startCallbackServer = async () => ({ port: 8914, codePromise: Promise.resolve('fixture-code') })
    oauth.exchangeCodeForTokens = async () => ({ accessToken: 'fixture-only', tokenType: 'Bearer' })
    await oauth.authenticate()
    const url = new URL(opened)
    expect(url.searchParams.get('scope')).toBe(scopes?.length ? 'app:read app:write' : null)
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8914/oauth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  }
})
