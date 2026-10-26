import { createServer, type Server } from 'node:http'
import { AntigravityError, checkAbort, type ErrorCode } from './types.ts'
import { HttpFailure, type ProxyClient } from './transport.ts'
import { delay, type ManagerRuntime } from './runtime.ts'

const nativeErrors: Record<string, ErrorCode> = {
  'Authentication failed': 'oauth_denied',
  'Authentication failed: state mismatch': 'oauth_state',
  'Authentication failed: code not found': 'oauth_code',
  'Failed to exchange token': 'oauth_exchange',
  'Failed to fetch user info': 'oauth_userinfo',
  'Failed to save token to file': 'oauth_save',
  'OAuth flow timed out': 'oauth_timeout',
  'invalid state': 'oauth_state',
  'unknown or expired state': 'oauth_state',
}
export function nativeAuthError(value: unknown): AntigravityError {
  return new AntigravityError(typeof value === 'string' ? nativeErrors[value] ?? 'oauth_failed' : 'oauth_failed')
}
export function validateAuthUrl(value: unknown, state: unknown, callbackPort = 51121): string {
  if (typeof value !== 'string' || value.length > 16384 || typeof state !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(state)) throw new AntigravityError('auth_url')
  let url: URL
  try { url = new URL(value) } catch { throw new AntigravityError('auth_url') }
  if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || (url.port && url.port !== '443')
    || url.username || url.password || url.hash || url.pathname !== '/o/oauth2/v2/auth'
    || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state
    || url.searchParams.getAll('redirect_uri').length !== 1
    || url.searchParams.get('redirect_uri') !== `http://localhost:${callbackPort}/oauth-callback`
    || url.searchParams.get('response_type') !== 'code') throw new AntigravityError('auth_url')
  return url.toString()
}

/** Bound before requesting a URL; one matching callback can be transported exactly once. */
export class CallbackRelay {
  private server: Server
  private expectedState?: string
  private accepted = false
  private failure?: AntigravityError
  private submission?: Promise<void>
  constructor(private client: ProxyClient, private runtime: ManagerRuntime, private signal: AbortSignal) {
    this.server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
      response.setHeader('Referrer-Policy', 'no-referrer')
      response.setHeader('Connection', 'close')
      const reply = (status: number) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(status === 200 ? 'Authorization received. Return to Craft.' : 'Authorization callback rejected.') }
      let url: URL
      try { url = new URL(request.url ?? '', `http://localhost:${runtime.callbackPort}`) }
      catch { reply(400); return }
      if (request.method !== 'GET' || url.pathname !== '/oauth-callback'
        || ![`localhost:${runtime.callbackPort}`, `127.0.0.1:${runtime.callbackPort}`].includes(request.headers.host ?? '')
        || !this.expectedState || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== this.expectedState
        || url.searchParams.getAll('code').length > 1 || url.searchParams.getAll('error').length > 1
        || this.signal.aborted) { reply(400); return }
      if (this.accepted) { reply(409); return }
      const code = url.searchParams.get('code') ?? ''
      const error = url.searchParams.get('error') ?? ''
      if ((!code && !error) || code.length > 16384 || error.length > 1024) { reply(400); return }
      this.accepted = true
      reply(200)
      this.submission = this.client.callback(this.expectedState, code, error, signal).then(result => {
        if (result.status !== 'ok') this.failure = new AntigravityError('callback_rejected')
      }).catch(cause => {
        // Lost responses, 409, malformed JSON, and 5xx are ambiguous: poll the same state, never replay the code.
        if (cause instanceof HttpFailure && !cause.transient && cause.status !== 409) this.failure = new AntigravityError('callback_rejected')
      })
    })
    this.server.maxHeadersCount = 32
    this.server.requestTimeout = 5000
    this.server.headersTimeout = 5000
  }
  async bind(): Promise<void> {
    checkAbort(this.signal)
    try {
      await new Promise<void>((resolve, reject) => {
        this.server.once('error', reject)
        this.server.listen({ host: '127.0.0.1', port: this.runtime.callbackPort, exclusive: true }, () => resolve())
      })
      checkAbort(this.signal)
    } catch (error) { checkAbort(this.signal); throw new AntigravityError('port_in_use') }
  }
  setState(state: string) { this.expectedState = state }
  async wait(state: string): Promise<void> {
    for (;;) {
      checkAbort(this.signal)
      if (this.failure) throw this.failure
      try {
        const result = await this.client.authStatus(state, this.signal)
        if (result.status === 'ok') {
          // A definite callback rejection cannot be hidden by a simultaneous status reply.
          await this.submission
          if (this.failure) throw this.failure
          return
        }
        if (result.status === 'error') throw nativeAuthError(result.error)
        if (result.status !== 'wait') throw new AntigravityError('protocol')
      } catch (error) {
        checkAbort(this.signal)
        if (error instanceof HttpFailure ? !error.transient : !(error instanceof AntigravityError && error.code === 'transport')) throw error
      }
      await delay(this.runtime.pollIntervalMs, this.signal)
    }
  }
  async close(): Promise<void> {
    this.server.closeAllConnections()
    if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()))
    await this.submission
  }
}
