import { request } from 'node:http'
import type { ManagerRuntime } from './runtime.ts'
import { AntigravityError, checkAbort, object, parseModel, type Model } from './types.ts'

export class HttpFailure extends AntigravityError {
  constructor(readonly status: number) {
    super(status === 401 || status === 403 ? 'management_auth'
      : status >= 300 && status < 500 && status !== 408 && status !== 429 ? 'protocol' : 'transport')
  }
  get transient() { return this.status === 408 || this.status === 429 || this.status >= 500 }
}
/** Finite API wrapper. No arbitrary management passthrough, redirects, error bodies, or retries. */
export class ProxyClient {
  constructor(readonly baseUrl: string, private keys: { modelKey: string; managementKey: string }, private runtime: ManagerRuntime) {}
  private async json(path: string, management: boolean, signal?: AbortSignal, body?: object): Promise<Record<string, unknown>> {
    checkAbort(signal)
    const timeout = AbortSignal.timeout(this.runtime.requestTimeoutMs)
    let cleanup = () => {}
    try {
      // node:http performs one request only. Some fetch implementations automatically replay
      // a POST after a dropped connection, which is unsafe for an OAuth authorization code.
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body)
        const combinedSignal = AbortSignal.any([timeout, ...(signal ? [signal] : [])])
        const req = request(`${this.baseUrl}${path}`, {
          method: payload === undefined ? 'GET' : 'POST', agent: false,
          headers: { Authorization: `Bearer ${management ? this.keys.managementKey : this.keys.modelKey}`, ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }) },
          signal: combinedSignal,
        }, response => {
          const status = response.statusCode ?? 0
          if (status < 200 || status >= 300) {
            reject(new HttpFailure(status))
            response.destroy()
            return
          }
          let length = 0
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => {
            length += chunk.byteLength
            if (length > 2 * 1024 * 1024) { reject(new AntigravityError('protocol')); response.destroy(); return }
            chunks.push(chunk)
          })
          response.once('aborted', () => reject(new AntigravityError('transport')))
          response.once('error', () => reject(new AntigravityError('transport')))
          response.once('end', () => {
            try {
              const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
              resolve(value as Record<string, unknown>)
            } catch { reject(new AntigravityError('protocol')) }
          })
        })
        // Explicit rejection is needed as well as request.signal: Bun's Node shim can omit
        // the error event when an in-flight HTTP request is aborted before its response.
        const abort = () => { reject(new AntigravityError('transport')); req.destroy() }
        combinedSignal.addEventListener('abort', abort, { once: true })
        cleanup = () => combinedSignal.removeEventListener('abort', abort)
        req.once('error', () => reject(new AntigravityError('transport')))
        if (combinedSignal.aborted) abort()
        else req.end(payload)
      })
    } catch (error) {
      checkAbort(signal)
      if (error instanceof AntigravityError) throw error
      throw new AntigravityError('transport')
    } finally { cleanup() }
  }
  authUrl(signal: AbortSignal) { return this.json('/v0/management/antigravity-auth-url', true, signal) }
  authStatus(state: string, signal: AbortSignal) { return this.json(`/v0/management/get-auth-status?state=${encodeURIComponent(state)}`, true, signal) }
  callback(state: string, code: string, error: string, signal: AbortSignal) {
    return this.json('/v0/management/oauth-callback', true, signal, { provider: 'antigravity', state, ...(code ? { code } : {}), ...(error ? { error } : {}) })
  }
  /** Only summaries, never download or parse the credential JSON files. */
  async accounts(signal?: AbortSignal): Promise<string[]> {
    const response = await this.json('/v0/management/auth-files', true, signal)
    if (!Array.isArray(response.files)) throw new AntigravityError('protocol')
    return response.files.filter(value => {
      const row = object(value)
      return (row.provider === 'antigravity' || row.type === 'antigravity') && row.disabled === false
        && row.unavailable !== true && row.status !== 'disabled' && row.status !== 'error'
        && row.runtime_only !== true && typeof row.name === 'string' && row.name.length > 0 && row.name.length < 512
    }).map(value => object(value).name as string)
  }
  async probe(signal?: AbortSignal): Promise<void> {
    // Authentication proves this listener knows the injected key; /healthz alone cannot prove ownership.
    await this.json('/v0/management/auth-files', true, signal)
  }
  async models(signal?: AbortSignal): Promise<Model[]> {
    const names = await this.accounts(signal)
    if (!names.length) throw new AntigravityError('account_unavailable')
    const definitions = new Map<string, Model>()
    try {
      const response = await this.json('/v0/management/model-definitions/antigravity', true, signal)
      if (Array.isArray(response.models)) for (const value of response.models) {
        const model = parseModel(value)
        if (model) definitions.set(model.id, model)
      }
    } catch { checkAbort(signal) /* Optional metadata cannot hide a callable catalog entry. */ }
    const discovered = new Map<string, Model>()
    const add = (values: unknown) => {
      if (!Array.isArray(values)) return
      for (const value of values) {
        const model = parseModel(value)
        if (!model) continue
        discovered.set(model.id, { ...definitions.get(model.id), ...discovered.get(model.id), ...model })
      }
    }
    for (const name of names) {
      try { add((await this.json(`/v0/management/auth-files/models?name=${encodeURIComponent(name)}`, true, signal)).models) }
      catch { checkAbort(signal) }
    }
    try { add((await this.json('/v1/models', false, signal)).data) }
    catch { checkAbort(signal) }
    if (!discovered.size) throw new AntigravityError('catalog_unavailable')
    return [...discovered.values()]
  }
}
