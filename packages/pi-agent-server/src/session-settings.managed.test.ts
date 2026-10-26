import { describe, it, expect } from 'bun:test'
import { createCraftSettingsManager } from './session-settings'
describe('managed Antigravity request budget on Pi 1.1', () => {
 for (const purpose of ['main', 'ephemeral'] as const) it(`${purpose}: no retry, cache warming or project trust`, () => {
  const managed = createCraftSettingsManager(purpose, true)
  expect(managed.getRetryEnabled()).toBe(false)
  expect(managed.getRetrySettings().maxRetries).toBe(0)
  expect(managed.getProviderRetrySettings().maxRetries).toBe(0)
  expect(managed.getCacheWarmingMode()).toBe('off')
  expect(managed.isProjectTrusted()).toBe(false)
  expect(managed.getCompactionEnabled()).toBe(true)
 })
 it('retains existing Pi 1.1 retries and cache warming for old connections', () => {
  const old = createCraftSettingsManager('main')
  expect(old.getRetryEnabled()).toBe(true)
  expect(old.getRetrySettings().maxRetries).toBe(4)
  expect(old.getProviderRetrySettings().maxRetries).toBe(2)
  expect(old.getCacheWarmingMode()).toBe('streaming')
  expect(old.isProjectTrusted()).toBe(false)
 })
})
