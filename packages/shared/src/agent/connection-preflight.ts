/** Host-owned optional transport preparation. No SDK or Electron dependency. */
export type ConnectionPreflight = (connectionSlug: string) => Promise<void>
let preflight: ConnectionPreflight | undefined

export function setConnectionPreflightHook(hook: ConnectionPreflight | undefined): void {
  preflight = hook
}

/** Used before every Pi operation, including already-running agent subprocesses. */
export async function ensureConnectionReady(slug: string | undefined): Promise<void> {
  if (slug && preflight) await preflight(slug)
}
