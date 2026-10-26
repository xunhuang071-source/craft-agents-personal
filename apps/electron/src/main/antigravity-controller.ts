export interface NativeAntigravityStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  modelCount?: number
}
export interface NativeAntigravityOperations {
  getStatus(): Promise<NativeAntigravityStatus>
  startLogin(open: (url: string) => Promise<void>, changed: () => void | Promise<void>): Promise<void>
  cancelLogin(): Promise<void>
  refreshModels(): Promise<void>
  disconnect(): Promise<void>
}
export interface NativeAntigravityHost {
  isConnectionInUse(): boolean
  connectionChanged(): Promise<void>
}
export interface NativeAntigravityUi {
  openExternal(url: string): Promise<void>
  showStatus(status: NativeAntigravityStatus): Promise<void>
  showFailure(code: string): Promise<void>
  confirmDisconnect(): Promise<boolean>
  changed(): void
  wait(ms: number): Promise<void>
}

/** Main-process controller. No renderer, persisted settings, or credential ownership. */
export class NativeAntigravityController {
  status: NativeAntigravityStatus = { state: 'disconnected' }
  busy = false
  loginActive = false
  private disposed = false
  private cancelled = false
  constructor(private readonly operations: NativeAntigravityOperations, private readonly host: NativeAntigravityHost, private readonly ui: NativeAntigravityUi) {}

  async readStatus(show = false): Promise<void> {
    if (this.disposed) return
    try {
      this.status = await this.operations.getStatus()
      this.ui.changed()
      if (show) await this.ui.showStatus(this.status)
    } catch { if (show) await this.ui.showFailure('status_unavailable') }
  }

  async connect(): Promise<void> {
    if (this.disposed || this.busy) return
    if (this.host.isConnectionInUse()) return this.ui.showFailure('connection_in_use')
    this.busy = true; this.loginActive = true; this.cancelled = false; this.ui.changed()
    try {
      await this.operations.startLogin(this.ui.openExternal, () => this.host.connectionChanged())
      const deadline = Date.now() + 330_000
      while (!this.disposed && Date.now() < deadline) {
        this.status = await this.operations.getStatus()
        if (this.status.state !== 'connecting') break
        await this.ui.wait(300)
      }
      if (this.disposed || this.cancelled) return
      if (this.status.state === 'connecting') {
        await this.operations.cancelLogin()
        await this.ui.showFailure('oauth_timeout')
      } else if (this.status.error || this.status.state !== 'connected') {
        await this.ui.showFailure(this.status.error ?? 'connection_failed')
      } else {
        await this.ui.showStatus(this.status)
      }
    } catch { if (!this.disposed && !this.cancelled) await this.ui.showFailure('connection_failed') }
    finally { this.busy = false; this.loginActive = false; if (!this.disposed) { await this.readStatus(); this.ui.changed() } }
  }

  async cancel(): Promise<void> {
    this.cancelled = true
    try { await this.operations.cancelLogin() }
    catch { if (!this.disposed) await this.ui.showFailure('cancel_failed') }
    await this.readStatus()
  }

  async refreshModels(): Promise<void> {
    if (this.disposed || this.busy) return
    this.busy = true; this.ui.changed()
    try { await this.operations.refreshModels(); await this.host.connectionChanged(); await this.readStatus(true) }
    catch { await this.ui.showFailure('catalog_unavailable') }
    finally { this.busy = false; this.ui.changed() }
  }

  async disconnect(): Promise<void> {
    if (this.disposed || this.busy) return
    if (this.host.isConnectionInUse()) return this.ui.showFailure('connection_in_use')
    if (!await this.ui.confirmDisconnect()) return
    // Recheck after the asynchronous confirmation: a chat may have started meanwhile.
    if (this.host.isConnectionInUse()) return this.ui.showFailure('connection_in_use')
    this.busy = true; this.ui.changed()
    try { await this.operations.disconnect(); await this.host.connectionChanged(); await this.readStatus(true) }
    catch { await this.ui.showFailure('disconnect_failed') }
    finally { this.busy = false; this.ui.changed() }
  }

  dispose(): void { this.disposed = true; this.cancelled = true }
}
