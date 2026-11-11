import { describe, test, expect } from 'bun:test'
import { FolderSourceConfigSchema } from '../../config/validators.ts'
const source = (scopes?: unknown) => ({ id: 'fixture', slug: 'fixture', name: 'Fixture', provider: 'fixture', type: 'mcp', enabled: true, mcp: { url: 'https://example.com/mcp', authType: 'oauth', oauthRelay: false, ...(scopes === undefined ? {} : { scopes }) } })
describe('MCP scopes config', () => {
  test('retains scopes and the local callback option', () => {
    const parsed = FolderSourceConfigSchema.parse(source(['app:read', 'app:write']))
    expect(parsed.mcp?.scopes).toEqual(['app:read', 'app:write'])
    expect(parsed.mcp?.oauthRelay).toBe(false)
  })
  test('leaves old configs unchanged', () => {
    expect(FolderSourceConfigSchema.parse(source()).mcp?.scopes).toBeUndefined()
    expect(FolderSourceConfigSchema.parse(source([])).mcp?.scopes).toEqual([])
  })
  test('rejects malformed scope lists', () => {
    for (const bad of ['app:read', [42], ['']]) expect(FolderSourceConfigSchema.safeParse(source(bad)).success).toBe(false)
  })
})
