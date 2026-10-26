export interface Model {
  id: string
  name?: string
  supportsImages?: boolean
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
}

/** Execution-only. Never send to renderer, persist, or log. */
export interface Binding { baseUrl: string; apiKey: string }
export interface Status {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  /** A fixed error code, never upstream text. */
  error?: string
  models?: Model[]
}
export interface AntigravityManagerOptions {
  rootDir: string
  /** Trusted packaged v8.0.13 executable; packager owns integrity verification. */
  binaryPath?: string
  keys: { modelKey: string; managementKey: string }
}

export type ErrorCode =
  | 'cancelled' | 'disposed' | 'invalid_keys' | 'storage' | 'state_format'
  | 'not_connected' | 'unsupported_platform' | 'binary_download' | 'binary_integrity'
  | 'port_in_use' | 'process_start' | 'process_exit' | 'process_stop' | 'startup_timeout'
  | 'transport' | 'protocol' | 'management_auth' | 'auth_url' | 'callback_rejected'
  | 'oauth_timeout' | 'oauth_denied' | 'oauth_state' | 'oauth_code' | 'oauth_exchange'
  | 'oauth_userinfo' | 'oauth_save' | 'oauth_failed' | 'account_unavailable'
  | 'catalog_unavailable'

/** Contains only allowlisted text; raw process/network/filesystem errors are discarded. */
export class AntigravityError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code)
    this.name = 'AntigravityError'
  }
}
export function safeError(error: unknown, fallback: ErrorCode = 'transport'): AntigravityError {
  return error instanceof AntigravityError ? error : new AntigravityError(fallback)
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AntigravityError('cancelled')
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}
function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
/** Exact upstream ModelInfo JSON fields, with no model-name-based capability guesses. */
export function parseModel(value: unknown): Model | undefined {
  const row = object(value)
  if (typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+()\-]{0,199}$/.test(row.id)) return
  const result: Model = { id: row.id }
  const name = row.display_name ?? row.name
  if (typeof name === 'string' && name.length <= 160 && !/[@\r\n\x00-\x1f]/.test(name)) result.name = name
  const context = positive(row.context_length) ?? positive(row.inputTokenLimit)
  const output = positive(row.max_completion_tokens) ?? positive(row.outputTokenLimit)
  if (context !== undefined) result.contextWindow = context
  if (output !== undefined) result.maxTokens = output
  if (Array.isArray(row.supportedInputModalities) && row.supportedInputModalities.length) {
    result.supportsImages = row.supportedInputModalities.some(v => typeof v === 'string' && v.toLowerCase() === 'image')
  }
  const thinking = object(row.thinking)
  if (positive(thinking.max) || (Array.isArray(thinking.levels) && thinking.levels.some(v => typeof v === 'string' && v !== 'none'))) {
    result.reasoning = true
  }
  return result
}
