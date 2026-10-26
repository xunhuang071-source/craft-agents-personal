import { afterEach, describe, expect, it } from 'bun:test'
import { ensureConnectionReady, setConnectionPreflightHook } from '../connection-preflight'

afterEach(() => setConnectionPreflightHook(undefined))

describe('managed transport preflight', () => {
  it('is a no-op without a host hook or connection slug', async () => {
    await ensureConnectionReady('existing-connection')
    let called = false
    setConnectionPreflightHook(async () => { called = true })
    await ensureConnectionReady(undefined)
    expect(called).toBe(false)
  })
  it('passes only the requested connection identity and awaits readiness', async () => {
    const seen: string[] = []
    setConnectionPreflightHook(async slug => { await Promise.resolve(); seen.push(slug) })
    await ensureConnectionReady('antigravity-sub')
    expect(seen).toEqual(['antigravity-sub'])
  })
  it('fails just the requesting operation when the transport is unavailable', async () => {
    setConnectionPreflightHook(async slug => {
      if (slug === 'antigravity-sub') throw new Error('transport unavailable')
    })
    await expect(ensureConnectionReady('antigravity-sub')).rejects.toThrow('transport unavailable')
    await ensureConnectionReady('chatgpt-plus')
  })
})
