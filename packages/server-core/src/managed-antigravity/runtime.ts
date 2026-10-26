import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { AntigravityError, checkAbort } from './types.ts'

export interface OwnedProcess {
  readonly alive: boolean
  stop(): Promise<void>
}
export interface SpawnSpec { binaryPath: string; configPath: string; cwd: string }
/** Internal test seam. Production uses only Node built-ins and global fetch. */
export type Fetcher = (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
export interface ManagerRuntime {
  fetch: Fetcher
  spawn(spec: SpawnSpec): OwnedProcess
  startupTimeoutMs: number
  loginTimeoutMs: number
  pollIntervalMs: number
  requestTimeoutMs: number
  callbackPort: number
}

export function spawnOwnedProcess(spec: SpawnSpec): OwnedProcess {
  // Do not inherit unrelated app API keys, management overrides, token stores, or deployment modes.
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  const child = spawn(spec.binaryPath, ['-config', spec.configPath], {
    cwd: spec.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  })
  let alive = true
  let finish!: () => void
  const exited = new Promise<void>(resolve => { finish = resolve })
  const done = () => { alive = false; finish() }
  child.once('error', done)
  child.once('exit', done)
  // Drain both pipes without retaining or logging bytes (OAuth URLs/tokens/email may appear).
  child.stdout?.resume()
  child.stderr?.resume()
  let stopping: Promise<void> | undefined
  return {
    get alive() { return alive },
    stop() {
      if (!alive) return Promise.resolve()
      if (stopping) return stopping
      const task = (async () => {
        child.kill('SIGTERM')
        await waitForExit(exited, 2000)
        if (alive) {
          child.kill('SIGKILL')
          await waitForExit(exited, 2000)
        }
        if (alive) throw new AntigravityError('process_stop')
      })()
      stopping = task
      void task.catch(() => { if (stopping === task) stopping = undefined })
      return task
    },
  }
}
export const defaultRuntime: ManagerRuntime = {
  fetch: (...args) => globalThis.fetch(...args),
  spawn: spawnOwnedProcess,
  startupTimeoutMs: 15_000,
  loginTimeoutMs: 300_000,
  pollIntervalMs: 500,
  requestTimeoutMs: 5000,
  callbackPort: 51121,
}
function waitForExit(exited: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs)
    void exited.then(() => { clearTimeout(timer); resolve() })
  })
}
export function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  checkAbort(signal)
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AntigravityError('cancelled'))
    signal.addEventListener('abort', abort, { once: true })
    void task.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    function abort() { clearTimeout(timer); reject(new AntigravityError('cancelled')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
/** Port checks never connect to an existing listener, so an occupied port cannot be adopted. */
export async function reservePort(port = 0): Promise<{ port: number; release(): Promise<void> }> {
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => resolve())
    })
  } catch { throw new AntigravityError('port_in_use') }
  const chosen = (server.address() as { port: number }).port
  return { port: chosen, release: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(new AntigravityError('port_in_use')) : resolve())) }
}
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn)
    this.tail = result.catch(() => {})
    return result
  }
}
