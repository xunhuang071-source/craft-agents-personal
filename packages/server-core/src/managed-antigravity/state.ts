import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AntigravityError, object, type Model } from './types.ts'
import { Mutex } from './runtime.ts'

export interface Account { id: string; port: number }
export interface StoredState {
  schemaVersion: 1
  port: number
  accounts: Account[]
  active?: { id: string; authorizedAt: string }
  models: Model[]
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
const port = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535
function parse(value: unknown): StoredState {
  const row = object(value)
  if (row.schemaVersion !== 1 || !port(row.port) || !Array.isArray(row.accounts) || !Array.isArray(row.models)
    || Object.keys(row).some(k => !['schemaVersion', 'port', 'accounts', 'active', 'models'].includes(k))) throw new AntigravityError('state_format')
  const accounts: Account[] = []
  for (const entry of row.accounts) {
    const account = object(entry)
    if (!uuid(account.id) || !port(account.port) || Object.keys(account).some(k => !['id', 'port'].includes(k)) || accounts.some(a => a.id === account.id)) throw new AntigravityError('state_format')
    accounts.push({ id: account.id, port: account.port })
  }
  let active: StoredState['active']
  if (row.active !== undefined) {
    const item = object(row.active)
    if (!uuid(item.id) || typeof item.authorizedAt !== 'string' || !Number.isFinite(Date.parse(item.authorizedAt))
      || !accounts.some(a => a.id === item.id) || Object.keys(item).some(k => !['id', 'authorizedAt'].includes(k))) throw new AntigravityError('state_format')
    active = { id: item.id, authorizedAt: item.authorizedAt }
  }
  const models: Model[] = row.models.map(value => {
    const item = object(value)
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+()\-]{0,199}$/.test(item.id)
      || Object.keys(item).some(k => !['id', 'name', 'supportsImages', 'contextWindow', 'maxTokens', 'reasoning'].includes(k))) throw new AntigravityError('state_format')
    const model: Model = { id: item.id }
    if (item.name !== undefined) {
      if (typeof item.name !== 'string' || item.name.length > 160 || /[@\r\n\x00-\x1f]/.test(item.name)) throw new AntigravityError('state_format')
      model.name = item.name
    }
    for (const key of ['supportsImages', 'reasoning'] as const) {
      if (item[key] !== undefined) {
        if (typeof item[key] !== 'boolean') throw new AntigravityError('state_format')
        model[key] = item[key]
      }
    }
    for (const key of ['contextWindow', 'maxTokens'] as const) {
      if (item[key] !== undefined) {
        if (typeof item[key] !== 'number' || !Number.isSafeInteger(item[key]) || item[key] <= 0) throw new AntigravityError('state_format')
        model[key] = item[key]
      }
    }
    return model
  })
  return { schemaVersion: 1, port: row.port, accounts, ...(active ? { active } : {}), models }
}
/** No secrets, account filenames, email addresses, URLs, or OAuth state in metadata. */
export class StateStore {
  private loaded?: Promise<StoredState | undefined>
  private value?: StoredState
  private mutex = new Mutex()
  constructor(readonly rootDir: string) {}
  async read(): Promise<StoredState | undefined> {
    await (this.loaded ??= this.load())
    return this.value === undefined ? undefined : structuredClone(this.value)
  }
  private async load(): Promise<StoredState | undefined> {
    let text: string
    try { text = await readFile(join(this.rootDir, 'state.json'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new AntigravityError('storage') }
    try { this.value = parse(JSON.parse(text)); return this.value }
    catch { throw new AntigravityError('state_format') }
  }
  async update(fn: (state: StoredState | undefined) => StoredState): Promise<StoredState> {
    return this.mutex.run(async () => {
      const current = await this.read()
      const next = parse(fn(current))
      const temporary = join(this.rootDir, `.state-${randomUUID()}.tmp`)
      try {
        await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
        const handle = await open(temporary, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify(next)); await handle.sync() } finally { await handle.close() }
        await rename(temporary, join(this.rootDir, 'state.json'))
        this.value = next
        return structuredClone(next)
      } catch { throw new AntigravityError('storage') }
      finally { await rm(temporary, { force: true }).catch(() => {}) }
    })
  }
}
