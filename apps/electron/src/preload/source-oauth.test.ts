import { expect, test, mock } from 'bun:test'
import type { CallbackPayload } from '@craft-agent/shared/auth/callback-server'
import type { SourceOAuthProgress } from '../shared/types'
import { runSourceOAuth } from './source-oauth'

const flow = { authUrl: 'https://auth.example.test/authorize', flowId: 'test-flow', state: 'test-state' }

function setup() {
  const controller = new AbortController()
  const callback = Promise.withResolvers<CallbackPayload>()
  const events: SourceOAuthProgress[] = []
  const dependencies = {
    createListener: async () => ({ url: 'http://localhost:6477', promise: callback.promise, close }),
    start: mock(async (_: string) => flow),
    openBrowser: mock(async (_: string) => {}),
    complete: mock(async (_flow: typeof flow, _code: string) => ({ success: true })),
    cancel: mock(async (_flow: typeof flow) => {}),
  }
  const close = mock(() => {})
  return { controller, dependencies, events, callback, close }
}

test('keeps the original authorization link and callback alive if the default browser fails', async () => {
  const { controller, dependencies, events, callback, close } = setup()
  dependencies.openBrowser.mockRejectedValue(new Error('Default browser unavailable'))
  const result = await runSourceOAuth(dependencies, controller.signal, (event) => {
    events.push(event)
    if (event.stage === 'browser-failed') callback.resolve({ query: { code: 'test-code' } })
  }, 1000)
  expect(result).toEqual({ success: true })
  expect(events).toEqual([
    { stage: 'ready', url: flow.authUrl },
    { stage: 'browser-failed', url: flow.authUrl },
    { stage: 'completing' },
  ])
  expect(dependencies.openBrowser).toHaveBeenCalledWith(flow.authUrl)
  expect(dependencies.start).toHaveBeenCalledWith('http://localhost:6477/callback')
  expect(dependencies.complete).toHaveBeenCalledWith(flow, 'test-code')
  expect(dependencies.cancel).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})

test('reports a failed start without opening a browser and releases the callback port', async () => {
  const { controller, dependencies, close } = setup()
  dependencies.start.mockRejectedValue(new Error('Proxy refused the connection'))
  const progress = mock(() => {})
  expect(await runSourceOAuth(dependencies, controller.signal, progress)).toEqual({
    success: false, error: 'Proxy refused the connection',
  })
  expect(progress).not.toHaveBeenCalled()
  expect(dependencies.openBrowser).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})

test('times out and cancels the server flow even if the browser opener never returns', async () => {
  const { controller, dependencies, close } = setup()
  dependencies.openBrowser.mockImplementation(() => new Promise(() => {}))
  expect(await runSourceOAuth(dependencies, controller.signal, undefined, 10)).toEqual({
    success: false, error: 'The sign-in expired before it was completed.',
  })
  expect(dependencies.cancel).toHaveBeenCalledWith(flow)
  expect(close).toHaveBeenCalledTimes(1)
})

test('cancels a displayed attempt and releases the callback port', async () => {
  const { controller, dependencies, close } = setup()
  const result = await runSourceOAuth(dependencies, controller.signal, () => controller.abort())
  expect(result).toEqual({ success: false, error: 'Sign-in cancelled.' })
  expect(dependencies.cancel).toHaveBeenCalledWith(flow)
  expect(dependencies.complete).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})

test('returns a browser error to existing callers without a fallback link', async () => {
  const { controller, dependencies, close } = setup()
  dependencies.openBrowser.mockRejectedValue(new Error('Default browser unavailable'))
  expect(await runSourceOAuth(dependencies, controller.signal)).toEqual({
    success: false, error: 'Default browser unavailable',
  })
  expect(dependencies.cancel).toHaveBeenCalledWith(flow)
  expect(close).toHaveBeenCalledTimes(1)
})
