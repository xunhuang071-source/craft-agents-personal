import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AntigravityError, checkAbort, safeError } from './types.ts'
import type { Fetcher } from './runtime.ts'

export const CLIPROXY_VERSION = '8.0.13'
export const CLIPROXY_URL = 'https://github.com/router-for-me/CLIProxyAPI/releases/download/v8.0.13/CLIProxyAPI_8.0.13_darwin_aarch64.tar.gz'
export const CLIPROXY_ARCHIVE_SHA256 = '652a192e3e38520253e330c4a094fa8916728370c3f213f127dbc56e35be7938'
/** Independently measured from the verified release archive. */
export const CLIPROXY_BINARY_SHA256 = '1ad2a918f96cc4e8b3e9ea99f305efe4a4c10d11ecb2fc152273e129b6bef576'
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export async function ensureBinary(rootDir: string, fetcher: Fetcher, signal?: AbortSignal): Promise<string> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new AntigravityError('unsupported_platform')
  const directory = join(rootDir, 'runtime', CLIPROXY_VERSION)
  const binary = join(directory, 'cli-proxy-api')
  try {
    const existing = await readFile(binary)
    if (digest(existing) === CLIPROXY_BINARY_SHA256) return binary
    throw new AntigravityError('binary_integrity')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw safeError(error, 'binary_integrity')
  }
  checkAbort(signal)
  const staging = join(rootDir, 'runtime', `.install-${randomUUID()}`)
  await mkdir(staging, { recursive: true, mode: 0o700 })
  try {
    const response = await fetcher(CLIPROXY_URL, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]), redirect: 'follow' })
    if (!response.ok || !response.body) throw new AntigravityError('binary_download')
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength
      if (size > 100 * 1024 * 1024) throw new AntigravityError('binary_download')
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    if (digest(bytes) !== CLIPROXY_ARCHIVE_SHA256) throw new AntigravityError('binary_integrity')
    const archive = join(staging, 'release.tar.gz')
    await writeFile(archive, bytes, { mode: 0o600 })
    // Extract only known regular release entries after verifying the immutable archive.
    await promisify(execFile)('/usr/bin/tar', ['-xzf', archive, '-C', staging, 'cli-proxy-api', 'LICENSE'], { timeout: 15_000, maxBuffer: 1024 })
    checkAbort(signal)
    if (digest(await readFile(join(staging, 'cli-proxy-api'))) !== CLIPROXY_BINARY_SHA256) throw new AntigravityError('binary_integrity')
    await chmod(join(staging, 'cli-proxy-api'), 0o700)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await rename(join(staging, 'LICENSE'), join(directory, 'LICENSE'))
    await rename(join(staging, 'cli-proxy-api'), binary)
    return binary
  } catch (error) {
    if (signal?.aborted) throw new AntigravityError('cancelled')
    throw safeError(error, 'binary_download')
  } finally { await rm(staging, { recursive: true, force: true }) }
}
