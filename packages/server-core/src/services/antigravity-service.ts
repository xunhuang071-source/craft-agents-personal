import { join } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getLlmConnection, getLlmConnections, getDefaultLlmConnection, addLlmConnection, updateLlmConnection, resolveConfigDir, type LlmConnection, type ModelDefinition } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { setConnectionPreflightHook } from '@craft-agent/shared/agent/connection-preflight'
import type { ManagedAntigravityStatus } from '@craft-agent/shared/protocol'
import { AntigravityManager, AntigravityError, type Model } from '../managed-antigravity/main'

export const ANTIGRAVITY_SLUG = 'antigravity-sub'
const MANAGEMENT_CREDENTIAL = 'antigravity-sub-management'
let managerPromise: Promise<AntigravityManager | null> | null = null
let loginPromise: Promise<void> | null = null
let publicError: string | undefined
let accountChanging = false
let disconnecting = false

/** Compare only opaque fingerprints; existing API keys never leave this process. */
async function captureProtectedApiKeys(): Promise<Array<{ slug: string; fingerprint: string }>> {
  const vault = getCredentialManager()
  const result: Array<{ slug: string; fingerprint: string }> = []
  for (const connection of getLlmConnections()) {
    if (connection.slug === ANTIGRAVITY_SLUG || !['api_key', 'api_key_with_endpoint', 'bearer_token'].includes(connection.authType)) continue
    const value = await vault.getLlmApiKey(connection.slug)
    result.push({ slug: connection.slug, fingerprint: createHash('sha256').update(value ?? '').digest('hex') })
  }
  return result
}
async function verifyProtectedApiKeys(before: Array<{ slug: string; fingerprint: string }>): Promise<void> {
  const vault = getCredentialManager()
  for (const record of before) {
    const value = await vault.getLlmApiKey(record.slug)
    if (createHash('sha256').update(value ?? '').digest('hex') !== record.fingerprint) throw new Error('protected_credentials_changed')
  }
}
function protectedConnections(): string {
  return JSON.stringify({ connections: getLlmConnections().filter(c => c.slug !== ANTIGRAVITY_SLUG), default: getDefaultLlmConnection() })
}

/** Only this module reads the app-owned proxy keys; Google tokens remain in CLIProxy. */
async function getManager(create: boolean): Promise<AntigravityManager | null> {
  if (managerPromise) {
    const pending = managerPromise
    const existing = await pending
    if (existing || !create) return existing
    if (managerPromise === pending) managerPromise = null
    return getManager(true)
  }
  managerPromise = (async () => {
    const stored = getLlmConnection(ANTIGRAVITY_SLUG)
    if (stored && stored.managedProvider !== 'antigravity') throw new Error('connection_conflict')
    const credentials = getCredentialManager()
    let modelKey = await credentials.getLlmApiKey(ANTIGRAVITY_SLUG)
    let managementKey = await credentials.getLlmApiKey(MANAGEMENT_CREDENTIAL)
    if (!modelKey && !managementKey && !create) return null
    // Missing half of an existing key pair is corruption, not a reason to overwrite it.
    if (!!modelKey !== !!managementKey) throw new Error('credentials_unavailable')
    if (!modelKey || !managementKey) {
      const protectedKeys = await captureProtectedApiKeys()
      modelKey = randomBytes(32).toString('base64url')
      managementKey = randomBytes(36).toString('base64url')
      await credentials.setLlmApiKey(ANTIGRAVITY_SLUG, modelKey)
      try { await credentials.setLlmApiKey(MANAGEMENT_CREDENTIAL, managementKey) }
      catch (error) { await credentials.deleteLlmCredentials(ANTIGRAVITY_SLUG).catch(() => {}); throw error }
      await verifyProtectedApiKeys(protectedKeys)
    }
    return new AntigravityManager({
      rootDir: join(resolveConfigDir(), 'managed-antigravity'),
      keys: { modelKey, managementKey },
      ...(process.env.CRAFT_ANTIGRAVITY_BINARY ? { binaryPath: process.env.CRAFT_ANTIGRAVITY_BINARY } : {}),
    })
  })()
  try {
    const manager = await managerPromise
    if (!manager) managerPromise = null
    return manager
  } catch (error) {
    managerPromise = null
    throw error
  }
}

/** Limit metadata to capabilities explicitly reported by CLIProxy. */
export function toAntigravityModels(models: Model[]): ModelDefinition[] {
  return models.map(model => ({
    id: model.id,
    name: model.name || model.id,
    shortName: model.name || model.id,
    description: 'Antigravity via managed CLIProxy',
    provider: 'pi' as const,
    contextWindow: typeof model.contextWindow === 'number' && model.contextWindow > 0 ? model.contextWindow : 131_072,
    supportsImages: model.supportsImages === true,
    supportsThinking: model.reasoning === true,
    ...(typeof model.maxTokens === 'number' && model.maxTokens > 0 ? { maxOutputTokens: model.maxTokens } : {}),
  }))
}

async function saveManagedConnection(manager: AntigravityManager, models: Model[], rotateCredentials = false): Promise<void> {
  if (models.length === 0) throw new Error('catalog_unavailable')
  const binding = await manager.ensureReady()
  const existing = getLlmConnection(ANTIGRAVITY_SLUG)
  if (existing && existing.managedProvider !== 'antigravity') throw new Error('connection_conflict')
  const definitions = toAntigravityModels(models)
  const defaultModel = existing?.defaultModel && definitions.some(m => m.id === existing.defaultModel)
    ? existing.defaultModel : (definitions.find(m => m.id.toLowerCase().startsWith('gemini')) ?? definitions[0])!.id
  const connection: LlmConnection = {
    slug: ANTIGRAVITY_SLUG,
    name: existing?.name ?? 'Antigravity',
    providerType: 'pi_compat',
    authType: 'api_key_with_endpoint',
    // Pi requires a credential namespace even for a custom Anthropic endpoint.
    piAuthProvider: 'anthropic',
    managedProvider: 'antigravity',
    managedCredentialVersion: rotateCredentials ? randomUUID() : existing?.managedCredentialVersion ?? randomUUID(),
    baseUrl: binding.baseUrl.replace(/\/v1\/?$/, ''),
    customEndpoint: { api: 'anthropic-messages' },
    models: definitions,
    defaultModel,
    midStreamBehavior: existing?.midStreamBehavior ?? 'queue',
    createdAt: existing?.createdAt ?? Date.now(),
  }
  const before = protectedConnections()
  const allowFirstDefault = getLlmConnections().length === 0 && !getDefaultLlmConnection()
  const result = existing ? updateLlmConnection(ANTIGRAVITY_SLUG, connection) : addLlmConnection(connection)
  if (!result) throw new Error('connection_save_failed')
  if (!allowFirstDefault && protectedConnections() !== before) throw new Error('protected_configuration_changed')
}

/** Registration itself performs no disk writes, downloads, or process startup. */
export function initializeAntigravityService(): void {
  setConnectionPreflightHook(async slug => {
    const connection = getLlmConnection(slug)
    if (connection?.managedProvider !== 'antigravity') return
    if (accountChanging || disconnecting) throw new Error('Antigravity account change is in progress; retry after it completes')
    if (slug !== ANTIGRAVITY_SLUG) throw new Error('Unsupported managed Antigravity connection identity')
    const manager = await getManager(false)
    if (!manager) throw new Error('Connect Antigravity from the native menu before using this model')
    const binding = await manager.ensureReady()
    if (binding.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '') !== connection.baseUrl?.replace(/\/$/, '')) {
      throw new Error('Antigravity endpoint changed; refresh the connection from the native menu')
    }
  })
}

export async function getAntigravityStatus(): Promise<ManagedAntigravityStatus> {
  try {
    const manager = await getManager(false)
    if (!manager) return { state: 'disconnected', version: '8.0.13' }
    const status = await manager.getStatus()
    return {
      state: accountChanging ? 'connecting' : status.state,
      ...(publicError || status.error ? { error: publicError ?? status.error } : {}),
      modelCount: status.models?.length ?? 0,
      version: '8.0.13',
    }
  } catch { return { state: 'error', error: 'credentials_unavailable', version: '8.0.13' } }
}

/** OAuth is backgrounded so the RPC request cannot time out while a browser is open. */
export async function startAntigravityLogin(openExternal: (url: string) => Promise<void>, onChanged: () => void | Promise<void>): Promise<void> {
  if (accountChanging || disconnecting) return
  accountChanging = true
  let manager: AntigravityManager | null
  try { manager = await getManager(true) }
  catch (error) { accountChanging = false; throw error }
  if (!manager) { accountChanging = false; throw new Error('credentials_unavailable') }
  publicError = undefined
  loginPromise = (async () => {
    try {
      const { models } = await manager.connect(async url => {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'accounts.google.com' || parsed.username || parsed.password) {
          throw new Error('invalid_authorization_url')
        }
        await openExternal(url)
      })
      await saveManagedConnection(manager, models, true)
      await onChanged()
    } catch (error) { publicError = error instanceof AntigravityError ? error.code : 'connection_failed' }
    finally { loginPromise = null; accountChanging = false }
  })()
}

export async function cancelAntigravityLogin(): Promise<void> {
  const manager = await getManager(false)
  if (manager) await manager.cancelLogin()
  if (loginPromise) await loginPromise
  publicError = undefined
}

export async function refreshAntigravityModels(): Promise<void> {
  if (loginPromise) throw new Error('login_in_progress')
  const manager = await getManager(false)
  if (!manager) throw new Error('not_connected')
  try {
    await saveManagedConnection(manager, await manager.refreshModels())
    publicError = undefined
  } catch { publicError = 'catalog_unavailable'; throw new Error('catalog_unavailable') }
}

export async function disconnectAntigravity(): Promise<void> {
  disconnecting = true
  try {
  await cancelAntigravityLogin()
  const manager = await getManager(false)
  if (manager) await manager.disconnect()
  // Preserve the named connection and history. Only its app-owned model key is removed.
  // The next explicit login can safely create a fresh pair after this manager is disposed.
  if (manager) await manager.dispose()
  const connection = getLlmConnection(ANTIGRAVITY_SLUG)
  if (connection?.managedProvider === 'antigravity') {
    if (!updateLlmConnection(ANTIGRAVITY_SLUG, { managedCredentialVersion: randomUUID() })) throw new Error('connection_save_failed')
  }
  const credentials = getCredentialManager()
  await credentials.deleteLlmCredentials(ANTIGRAVITY_SLUG)
  await credentials.deleteLlmCredentials(MANAGEMENT_CREDENTIAL)
  managerPromise = null
  publicError = undefined
  } finally { disconnecting = false }
}

export async function disposeAntigravityService(): Promise<void> {
  // Never instantiate a manager merely because the app is quitting.
  if (!managerPromise) return
  const manager = await managerPromise.catch(() => null)
  if (manager) await manager.dispose()
  managerPromise = null
  setConnectionPreflightHook(undefined)
}
