import { describe, it, expect } from 'bun:test'
import { NativeAntigravityController, type NativeAntigravityStatus } from './antigravity-controller'
function fixture() {
 let status: NativeAntigravityStatus = { state: 'disconnected' }; let inUse = false; let confirm = true
 const calls = { login: 0, cancel: 0, refresh: 0, disconnect: 0, changed: 0, browser: 0, shown: 0, failures: [] as string[] }
 const operations = {
  getStatus: async () => status,
  startLogin: async (open: (url: string) => Promise<void>, changed: () => void | Promise<void>) => { calls.login++; await open('https://accounts.google.com/fixture'); status = { state: 'connected', modelCount: 11 }; await changed() },
  cancelLogin: async () => { calls.cancel++; status = { state: 'disconnected' } },
  refreshModels: async () => { calls.refresh++ }, disconnect: async () => { calls.disconnect++; status = { state: 'disconnected' } },
 }
 const ui = { openExternal: async () => { calls.browser++ }, showStatus: async () => { calls.shown++ }, showFailure: async (s: string) => { calls.failures.push(s) }, confirmDisconnect: async () => confirm, changed: () => {}, wait: async (_ms: number) => {} }
 const controller = new NativeAntigravityController(operations, { isConnectionInUse: () => inUse, connectionChanged: async () => { calls.changed++ } }, ui)
 return { controller, calls, operations, ui, setInUse: (x: boolean) => { inUse = x }, setConfirm: (x: boolean) => { confirm = x }, setStatus: (s: NativeAntigravityStatus) => { status = s } }
}
describe('native Antigravity controller', () => {
 it('connects through the system browser and publishes the existing connection event', async () => { const f = fixture(); await f.controller.connect(); expect(f.calls).toMatchObject({ login: 1, browser: 1, changed: 1, shown: 1 }); expect(f.controller.busy).toBe(false); expect(f.controller.loginActive).toBe(false) })
 it('refuses account changes while this connection is in use', async () => { const f = fixture(); f.setInUse(true); await f.controller.connect(); await f.controller.disconnect(); expect(f.calls.login).toBe(0); expect(f.calls.disconnect).toBe(0); expect(f.calls.failures).toEqual(['connection_in_use', 'connection_in_use']) })
 it('never disconnects without explicit confirmation', async () => { const f = fixture(); f.setConfirm(false); await f.controller.disconnect(); expect(f.calls.disconnect).toBe(0) })
 it('rechecks active sessions after the asynchronous disconnect confirmation', async () => { const f = fixture(); f.ui.confirmDisconnect = async () => { f.setInUse(true); return true }; await f.controller.disconnect(); expect(f.calls.disconnect).toBe(0); expect(f.calls.failures).toContain('connection_in_use') })
 it('refreshes models and only notifies the managed runtime', async () => { const f = fixture(); await f.controller.refreshModels(); expect(f.calls.refresh).toBe(1); expect(f.calls.changed).toBe(1) })
 it('cancels a pending login without presenting a false success', async () => { const f = fixture(); f.operations.startLogin = async () => { f.setStatus({ state: 'connecting' }) }; f.ui.wait = async () => { await f.controller.cancel() }; await f.controller.connect(); expect(f.calls.cancel).toBe(1); expect(f.calls.shown).toBe(0); expect(f.calls.failures).toEqual([]) })
 it('surfaces a safe failure and releases the operation lock', async () => { const f = fixture(); f.operations.startLogin = async () => { throw new Error('sensitive upstream payload') }; await f.controller.connect(); expect(f.calls.failures).toEqual(['connection_failed']); expect(f.controller.busy).toBe(false) })
 it('rejects duplicate concurrent login clicks', async () => { const f = fixture(); await Promise.all([f.controller.connect(), f.controller.connect()]); expect(f.calls.login).toBe(1) })
 it('does not open browsers or mutate data after disposal', async () => { const f = fixture(); f.controller.dispose(); await f.controller.connect(); await f.controller.refreshModels(); await f.controller.disconnect(); expect(f.calls.login + f.calls.refresh + f.calls.disconnect).toBe(0) })
 it('disconnect publishes a change but does not own or remove history', async () => { const f = fixture(); await f.controller.disconnect(); expect(f.calls.disconnect).toBe(1); expect(f.calls.changed).toBe(1); expect(f.calls.failures).toEqual([]) })
})
