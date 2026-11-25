import type { CallbackServer } from '@craft-agent/shared/auth/callback-server'
import type { SourceOAuthProgress, SourceOAuthResult } from '../shared/types'

interface OAuthFlow {
  authUrl: string
  flowId: string
  state: string
}

interface SourceOAuthDependencies {
  createListener(): Promise<CallbackServer>
  start(callbackUrl: string): Promise<OAuthFlow>
  openBrowser(url: string): Promise<void>
  complete(flow: OAuthFlow, code: string): Promise<SourceOAuthResult>
  cancel(flow: OAuthFlow): Promise<void>
}

// Match the server-side OAuth flow lifetime.
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

export async function runSourceOAuth(
  dependencies: SourceOAuthDependencies,
  signal: AbortSignal,
  onProgress?: (progress: SourceOAuthProgress) => void,
  timeoutMs = SIGN_IN_TIMEOUT_MS,
): Promise<SourceOAuthResult> {
  let listener: CallbackServer | undefined
  let flow: OAuthFlow | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let waiting = false
  let cancelWait: (() => void) | undefined
  try {
    listener = await dependencies.createListener()
    // Observe listener errors even if they happen during the start RPC.
    void listener.promise.catch(() => {})
    flow = await dependencies.start(`${listener.url}/callback`)
    if (signal.aborted) throw new Error('Sign-in cancelled.')

    const interrupted = new Promise<never>((_, reject) => {
      cancelWait = () => reject(new Error('Sign-in cancelled.'))
      signal.addEventListener('abort', cancelWait, { once: true })
      timeout = setTimeout(() => reject(new Error('The sign-in expired before it was completed.')), timeoutMs)
    })
    const callback = Promise.race([listener.promise, interrupted])
    void callback.catch(() => {})
    waiting = true
    const url = flow.authUrl
    onProgress?.({ stage: 'ready', url })
    const browserOpen = Promise.resolve().then(() => dependencies.openBrowser(url))
    if (onProgress) {
      void browserOpen.catch(() => {
        if (waiting) onProgress({ stage: 'browser-failed', url })
      }).catch(() => {})
    } else {
      // Callers without a fallback link must receive browser launch errors.
      await Promise.race([callback, browserOpen])
    }

    const { query } = await callback
    waiting = false
    onProgress?.({ stage: 'completing' })
    if (query.error) throw new Error(query.error_description || query.error)
    if (!query.code) throw new Error('No authorization code received')
    const result = await dependencies.complete(flow, query.code)
    flow = undefined
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'OAuth flow failed' }
  } finally {
    waiting = false
    if (timeout) clearTimeout(timeout)
    if (cancelWait) signal.removeEventListener('abort', cancelWait)
    listener?.close()
    if (flow) void dependencies.cancel(flow).catch(() => {})
  }
}
