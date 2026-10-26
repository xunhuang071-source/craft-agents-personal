import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { ensureBinary } from './binary.ts'
import { CallbackRelay, validateAuthUrl } from './oauth.ts'
import { abortable, defaultRuntime, delay, Mutex, reservePort, type ManagerRuntime, type OwnedProcess } from './runtime.ts'
import { StateStore, type Account, type StoredState } from './state.ts'
import { HttpFailure, ProxyClient } from './transport.ts'
import { AntigravityError, checkAbort, safeError, type AntigravityManagerOptions, type Binding, type Model, type Status } from './types.ts'

export type { AntigravityManagerOptions, Binding, Model, Status } from './types.ts'
export { AntigravityError } from './types.ts'
export { CLIPROXY_VERSION, CLIPROXY_URL, CLIPROXY_ARCHIVE_SHA256, CLIPROXY_BINARY_SHA256 } from './binary.ts'

interface Instance { accountId: string; port: number; runDir: string; process: OwnedProcess; client: ProxyClient }
interface Login { controller: AbortController; task: Promise<{ binding: Binding; models: Model[] }> }

/** Node-only owner of one active account and one isolated candidate; no Electron dependency.
 * One manager per rootDir. The host must stop consumers before disconnect/account replacement.
 */
export class AntigravityManager {
  private readonly runtime: ManagerRuntime
  private readonly store: StateStore
  private readonly activeLock = new Mutex()
  private readonly records = new Set<Instance>()
  private readonly lifetime = new AbortController()
  private active?: Instance
  private ready?: Promise<Binding>
  private login?: Login
  private disposed = false
  private disposeTask?: Promise<void>
  private disconnecting = false
  private disconnectTask?: Promise<void>
  private lastError?: string
  private binary?: Promise<string>

  constructor(private readonly options: AntigravityManagerOptions, runtime: Partial<ManagerRuntime> = {}) {
    const { modelKey, managementKey } = options.keys
    if (!isAbsolute(options.rootDir) || !modelKey || !managementKey || modelKey === managementKey
      || Buffer.byteLength(managementKey) >= 72 || Buffer.byteLength(managementKey) < 16
      || Buffer.byteLength(modelKey) < 16 || Buffer.byteLength(modelKey) > 1024
      || /[\x00-\x20\x7f]/.test(modelKey + managementKey)) throw new AntigravityError('invalid_keys')
    this.runtime = { ...defaultRuntime, ...runtime }
    this.store = new StateStore(options.rootDir)
  }

  /** Only metadata is read. This method never downloads, launches, refreshes, or writes. */
  async getStatus(): Promise<Status> {
    try {
      const state = await this.store.read()
      if (this.login) return { state: 'connecting', ...(state?.models.length ? { models: state.models } : {}) }
      const error = this.lastError ?? (this.active && !this.active.process.alive ? 'process_exit' : undefined)
      return {
        state: state?.active ? 'connected' : error ? 'error' : 'disconnected',
        ...(error ? { error } : {}), ...(state?.active ? { models: state.models } : {}),
      }
    } catch (error) { return { state: 'error', error: safeError(error, 'storage').code } }
  }

  connect(onAuthUrl: (url: string) => void | Promise<void>): Promise<{ binding: Binding; models: Model[] }> {
    if (this.disposed) return Promise.reject(new AntigravityError('disposed'))
    if (this.disconnecting) return Promise.reject(new AntigravityError('not_connected'))
    if (this.login) return this.login.task
    const controller = new AbortController()
    const operation: Login = { controller, task: undefined! }
    this.login = operation
    this.lastError = undefined
    operation.task = this.performLogin(onAuthUrl, controller)
    const clear = () => { if (this.login === operation) this.login = undefined }
    void operation.task.then(clear, clear)
    return operation.task
  }

  async cancelLogin(): Promise<void> {
    const login = this.login
    if (!login) return
    login.controller.abort()
    await login.task.catch(error => {
      const code = safeError(error).code
      if (code === 'process_stop' || code === 'storage') throw safeError(error)
    })
  }

  /** Only already-authorized active metadata may cause a lazy launch. */
  ensureReady(): Promise<Binding> {
    if (this.disposed) return Promise.reject(new AntigravityError('disposed'))
    if (this.ready) return this.ready
    const task = this.activeLock.run(async () => {
      this.assertLive()
      const state = await this.store.read()
      if (!state?.active) throw new AntigravityError('not_connected')
      await this.ensureActive(state)
      return this.binding(state.port)
    })
    this.ready = task
    void task.then(() => { if (this.ready === task) this.ready = undefined }, error => {
      this.lastError = safeError(error, 'process_start').code
      if (this.ready === task) this.ready = undefined
    })
    return task
  }

  async refreshModels(): Promise<Model[]> {
    return this.activeLock.run(async () => {
      this.assertLive()
      const state = await this.store.read()
      if (!state?.active) throw new AntigravityError('not_connected')
      const instance = await this.ensureActive(state)
      try {
        const models = await instance.client.models(this.lifetime.signal)
        await this.store.update(current => ({ ...current!, models }))
        this.lastError = undefined
        return models
      } catch (error) {
        this.lastError = safeError(error, 'catalog_unavailable').code
        // No account/state rollback or token deletion when catalog fetching fails.
        throw safeError(error, 'catalog_unavailable')
      }
    })
  }

  disconnect(): Promise<void> {
    if (this.disconnectTask) return this.disconnectTask
    this.disconnecting = true
    const task = (async () => {
      await this.cancelLogin()
      await this.activeLock.run(async () => {
        const state = await this.store.read()
        await this.stopAll()
        // On restart, never delete credentials while an unowned/stale writer may still be listening.
        const reservations: Awaited<ReturnType<typeof reservePort>>[] = []
        try {
          for (const port of new Set(state?.accounts.map(a => a.port) ?? [])) reservations.push(await reservePort(port))
          if (state) {
            // Commit deletion intent before touching the registered auth directories.
            await this.store.update(current => ({ ...current!, active: undefined, models: [] }))
            for (const account of state.accounts) await this.deleteDirectory(account.id)
            await this.store.update(current => ({ ...current!, accounts: [] }))
          }
          await rm(join(this.options.rootDir, 'run'), { recursive: true, force: true })
          this.lastError = undefined
        } catch (error) { this.lastError = safeError(error, 'storage').code; throw safeError(error, 'storage') }
        finally { for (const reservation of reservations) await reservation.release() }
      })
    })()
    this.disconnectTask = task
    const clear = () => { this.disconnectTask = undefined; this.disconnecting = false }
    void task.then(clear, clear)
    return task
  }

  /** Idempotent shutdown. Authorization is deliberately retained. */
  dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask
    this.disposed = true
    this.lifetime.abort()
    const task = (async () => {
      // Even if candidate cleanup failed, attempt every retained owned process.
      try { await this.cancelLogin() }
      finally { await this.activeLock.run(() => this.stopAll()) }
    })()
    this.disposeTask = task
    void task.catch(() => { if (this.disposeTask === task) this.disposeTask = undefined })
    return task
  }

  private assertLive() { if (this.disposed) throw new AntigravityError('disposed') }
  private binding(port: number): Binding { return { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: this.options.keys.modelKey } }
  private authDir(id: string) { return join(this.options.rootDir, 'accounts', id, 'auth') }
  private async initialize(): Promise<StoredState> {
    const existing = await this.store.read()
    if (existing) return existing
    const reserved = await reservePort()
    try { return await this.store.update(current => current ?? { schemaVersion: 1, port: reserved.port, accounts: [], models: [] }) }
    finally { await reserved.release() }
  }
  private executable(signal: AbortSignal): Promise<string> {
    if (this.options.binaryPath) return Promise.resolve(this.options.binaryPath)
    if (!this.binary) {
      const task = ensureBinary(this.options.rootDir, this.runtime.fetch, this.lifetime.signal)
      this.binary = task
      void task.catch(() => { if (this.binary === task) this.binary = undefined })
    }
    return abortable(this.binary, signal)
  }

  private async start(accountId: string, port: number, signal: AbortSignal): Promise<Instance> {
    checkAbort(signal)
    const runDir = join(this.options.rootDir, 'run', randomUUID())
    const configPath = join(runDir, 'config.yaml')
    const authDir = this.authDir(accountId)
    let instance: Instance | undefined
    let startupTimer: ReturnType<typeof setTimeout> | undefined
    const startupController = new AbortController()
    const startupSignal = AbortSignal.any([signal, startupController.signal])
    try {
      const binaryPath = await this.executable(signal)
      await mkdir(authDir, { recursive: true, mode: 0o700 })
      await mkdir(runDir, { recursive: true, mode: 0o700 })
      const configuration = {
        'config-version': 8,
        server: { host: '127.0.0.1', port, 'commercial-mode': true, discovery: { enabled: false }, tls: { enable: false } },
        management: { 'allow-remote': false, 'secret-key': this.options.keys.managementKey, 'disable-control-panel': true, 'disable-auto-update-panel': true },
        access: { 'api-keys': [this.options.keys.modelKey] },
        oauth: { 'auth-dir': authDir },
        routing: { retry: { 'request-retry': 0, 'max-retry-credentials': 1, 'max-retry-interval': 0 } },
        requests: { streaming: { 'bootstrap-retries': 0 } },
        observability: { logs: { debug: false, 'logging-to-file': false, 'request-log': false, 'logs-max-total-size-mb': 1, 'error-logs-max-files': 1 }, usage: { 'usage-statistics-enabled': false }, pprof: { enable: false } },
        'quota-exceeded': { 'switch-project': false, 'switch-preview-model': false },
      }
      // JSON is a YAML subset. No interpolation or quoting of injected secrets/paths.
      await writeFile(configPath, JSON.stringify(configuration), { mode: 0o600, flag: 'wx' })
      checkAbort(signal)
      const reservation = await reservePort(port)
      await reservation.release()
      const process = this.runtime.spawn({ binaryPath, configPath, cwd: runDir })
      instance = { accountId, port, runDir, process, client: new ProxyClient(`http://127.0.0.1:${port}`, this.options.keys, this.runtime) }
      this.records.add(instance) // Retain the handle before any await/health check.
      startupTimer = setTimeout(() => startupController.abort(), this.runtime.startupTimeoutMs)
      const deadline = Date.now() + this.runtime.startupTimeoutMs
      while (Date.now() < deadline) {
        checkAbort(startupSignal)
        if (!process.alive) throw new AntigravityError('process_exit')
        try {
          await instance.client.probe(startupSignal)
          checkAbort(startupSignal)
          if (!process.alive) throw new AntigravityError('process_exit')
          return instance
        } catch (error) {
          checkAbort(startupSignal)
          if (error instanceof HttpFailure && !error.transient) throw error
          if (error instanceof AntigravityError && !['transport', 'protocol'].includes(error.code)) throw error
        }
        await delay(Math.min(this.runtime.pollIntervalMs, 100), startupSignal)
      }
      throw new AntigravityError('startup_timeout')
    } catch (error) {
      if (instance) await this.stop(instance)
      else await rm(runDir, { recursive: true, force: true }).catch(() => {})
      if (startupController.signal.aborted && !signal.aborted) throw new AntigravityError('startup_timeout')
      throw safeError(error, 'process_start')
    } finally { clearTimeout(startupTimer) }
  }
  private async stop(instance: Instance): Promise<void> {
    try { await instance.process.stop() } // If stop cannot be confirmed, keep both handle and files.
    catch { throw new AntigravityError('process_stop') }
    try { await rm(instance.runDir, { recursive: true, force: true }) }
    catch { throw new AntigravityError('storage') }
    this.records.delete(instance)
    if (this.active === instance) this.active = undefined
  }
  private async stopAll(): Promise<void> {
    const results = await Promise.allSettled([...this.records].map(instance => this.stop(instance)))
    if (results.some(result => result.status === 'rejected')) throw new AntigravityError('process_stop')
  }
  private async ensureActive(state: StoredState): Promise<Instance> {
    this.assertLive()
    if (this.active?.accountId === state.active!.id && this.active.process.alive) return this.active
    if (this.active) await this.stop(this.active)
    const instance = await this.start(state.active!.id, state.port, this.lifetime.signal)
    try {
      if (!(await instance.client.accounts(this.lifetime.signal)).length) throw new AntigravityError('account_unavailable')
      this.active = instance
      return instance
    } catch (error) { await this.stop(instance); throw safeError(error, 'account_unavailable') }
  }
  private async deleteDirectory(id: string): Promise<void> {
    if ([...this.records].some(record => record.accountId === id)) throw new AntigravityError('process_stop')
    try { await rm(join(this.options.rootDir, 'accounts', id), { recursive: true, force: true }) }
    catch { throw new AntigravityError('storage') }
  }
  private async discardAccount(id: string): Promise<void> {
    await this.deleteDirectory(id)
    await this.store.update(state => ({ ...state!, accounts: state!.accounts.filter(a => a.id !== id) }))
  }

  private async performLogin(onAuthUrl: (url: string) => void | Promise<void>, controller: AbortController): Promise<{ binding: Binding; models: Model[] }> {
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.runtime.loginTimeoutMs)
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    let candidate: Account | undefined
    let candidateInstance: Instance | undefined
    let relay: CallbackRelay | undefined
    let committed = false
    try {
      const initial = await this.initialize()
      checkAbort(signal)
      const reserved = await reservePort()
      candidate = { id: randomUUID(), port: reserved.port }
      await reserved.release()
      await this.store.update(state => ({ ...state!, accounts: [...state!.accounts, candidate!] }))
      candidateInstance = await this.start(candidate.id, candidate.port, signal)
      relay = new CallbackRelay(candidateInstance.client, this.runtime, signal)
      await relay.bind() // Must own localhost callback before creating/opening any auth URL.
      const auth = await candidateInstance.client.authUrl(signal) // Intentionally no is_webui and no retries.
      if (auth.status !== 'ok') throw new AntigravityError('auth_url')
      const url = validateAuthUrl(auth.url, auth.state, this.runtime.callbackPort)
      relay.setState(auth.state as string)
      checkAbort(signal)
      try { await abortable(Promise.resolve(onAuthUrl(url)), signal) }
      catch { checkAbort(signal); throw new AntigravityError('auth_url') }
      checkAbort(signal)
      await relay.wait(auth.state as string)
      await relay.close()
      relay = undefined
      // Completed state alone is insufficient: CLIProxy must report a usable saved account.
      if (!(await candidateInstance.client.accounts(signal)).length) throw new AntigravityError('account_unavailable')
      let models: Model[] = []
      let catalogError: AntigravityError | undefined
      try { models = await candidateInstance.client.models(signal) }
      catch (error) { checkAbort(signal); catalogError = safeError(error, 'catalog_unavailable') }
      checkAbort(signal)
      // Switching accounts requires a catalog. A first successful authorization is retained even if discovery is temporarily down.
      if (catalogError && initial.active) throw catalogError
      await this.activeLock.run(async () => {
        checkAbort(signal)
        this.assertLive()
        const previousState = (await this.store.read())!
        const previous = this.active
        await this.stop(candidateInstance!)
        candidateInstance = undefined
        if (previous) await this.stop(previous)
        let replacement: Instance | undefined
        try {
          replacement = await this.start(candidate!.id, previousState.port, signal)
          if (!(await replacement.client.accounts(signal)).length) throw new AntigravityError('account_unavailable')
          checkAbort(signal)
          await this.store.update(state => ({
            ...state!, active: { id: candidate!.id, authorizedAt: new Date().toISOString() }, models,
            accounts: state!.accounts.map(a => a.id === candidate!.id ? { ...a, port: state!.port } : a),
          }))
          this.active = replacement
          committed = true // Linearization point: cancellation never removes this authorized active.
        } catch (error) {
          if (replacement) await this.stop(replacement)
          // The persisted previous active is unchanged until commit. It remains lazily restartable.
          throw error
        }
        if (previousState.active) {
          // Cleanup failure after commit cannot roll back or destroy the new active.
          await this.discardAccount(previousState.active.id).catch(() => { this.lastError = 'storage' })
        }
      })
      if (catalogError) throw catalogError
      return { binding: this.binding(initial.port), models }
    } catch (error) {
      const safe = timedOut ? new AntigravityError('oauth_timeout') : safeError(error, 'oauth_failed')
      if (safe.code !== 'cancelled') this.lastError = safe.code
      throw safe
    } finally {
      clearTimeout(timer)
      try {
        await relay?.close()
        if (!committed) {
          // Never delete a directory whose writer could not be stopped.
          if (candidateInstance) await this.stop(candidateInstance)
          if (candidate) await this.discardAccount(candidate.id)
        }
      } catch (error) {
        const safe = safeError(error, 'storage')
        this.lastError = safe.code
        throw safe
      }
    }
  }
}
