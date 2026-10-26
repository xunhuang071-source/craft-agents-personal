import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { CLIPROXY_BINARY_SHA256 } from './binary.ts'
import { spawnOwnedProcess, reservePort, delay } from './runtime.ts'
import { object, parseModel } from './types.ts'

/** Explicit opt-in; no OAuth endpoint, browser, credential import, or upstream request. */
const binary = process.env.CLIPROXY_NATIVE_BINARY
const native = binary && process.platform === 'darwin' && process.arch === 'arm64' ? test : test.skip
native('verified v8.0.13 native binary: local health, management auth, quiet config and shutdown', async () => {
  expect(createHash('sha256').update(await readFile(binary!)).digest('hex')).toBe(CLIPROXY_BINARY_SHA256)
  const root = await mkdtemp(join(import.meta.dir, '.native-'))
  const reserved = await reservePort()
  const port = reserved.port
  await reserved.release()
  const authDir = join(root, 'auth')
  await mkdir(authDir, { mode: 0o700 })
  const configPath = join(root, 'config.yaml')
  const managementKey = 'native-test-management-key-000000001'
  const modelKey = 'native-test-model-key-00000000000001'
  await writeFile(configPath, JSON.stringify({
    'config-version': 8,
    server: { host: '127.0.0.1', port, 'commercial-mode': true, discovery: { enabled: false } },
    management: { 'allow-remote': false, 'secret-key': managementKey, 'disable-control-panel': true, 'disable-auto-update-panel': true },
    access: { 'api-keys': [modelKey] }, oauth: { 'auth-dir': authDir },
    routing: { retry: { 'request-retry': 0, 'max-retry-credentials': 1, 'max-retry-interval': 0 } },
    observability: { logs: { 'logging-to-file': false, 'request-log': false }, usage: { 'usage-statistics-enabled': false }, pprof: { enable: false } },
  }), { mode: 0o600 })
  // --local-model is smoke-test-only, ensuring no remote catalog update during this test.
  const { spawn } = await import('node:child_process')
  const child = spawn(binary!, ['-config', configPath, '-local-model'], { cwd: root, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.resume()
  child.stderr.resume()
  let exited = false
  child.once('exit', () => { exited = true })
  child.once('error', () => { exited = true })
  try {
    const base = `http://127.0.0.1:${port}`
    let healthy = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (exited) break
      try { healthy = (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(300) })).ok } catch {}
      if (healthy) break
      await delay(50)
    }
    expect(healthy).toBe(true)
    const accounts = await fetch(`${base}/v0/management/auth-files`, { headers: { Authorization: `Bearer ${managementKey}` } })
    expect(accounts.status).toBe(200)
    expect(object(await accounts.json()).files).toEqual([])
    expect((await fetch(`${base}/v0/management/auth-files`, { headers: { Authorization: `Bearer ${modelKey}` } })).status).toBe(401)
    const models = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${modelKey}` } })
    expect(models.status).toBe(200)
    expect(object(await models.json()).data).toEqual([])
    const definitions = await fetch(`${base}/v0/management/model-definitions/antigravity`, { headers: { Authorization: `Bearer ${managementKey}` } })
    expect(definitions.status).toBe(200)
    const catalog = object(await definitions.json()).models
    expect(Array.isArray(catalog) && catalog.length > 0).toBe(true)
    const parsedModels = Array.isArray(catalog) ? catalog.map(parseModel) : []
    expect(parsedModels.some(model => model?.supportsImages === true)).toBe(true)
    expect(parsedModels.some(model => model?.supportsImages === false)).toBe(true)
    expect((await fetch(`${base}/management.html`)).status).toBe(404)
    expect((await stat(configPath)).mode & 0o777).toBe(0o600)
    expect(await readdir(authDir)).toEqual([])
    expect(await readdir(root)).not.toContain('logs')
  } finally {
    child.kill('SIGTERM')
    for (let i = 0; i < 60 && !exited; i++) await delay(50)
    if (!exited) child.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
  }
})

test('real owned process wrapper consumes both pipes and tolerates repeated stop', async () => {
  const root = await mkdtemp(join(import.meta.dir, '.process-'))
  const executable = join(root, 'fixture')
  await writeFile(executable, '#!/bin/sh\ni=0; while [ "$i" -lt 3000 ]; do printf "secret-not-captured\\n"; printf "secret-not-captured\\n" >&2; i=$((i+1)); done\nexec sleep 30\n', { mode: 0o700 })
  const owned = spawnOwnedProcess({ binaryPath: executable, configPath: '/unused', cwd: root })
  try {
    await delay(100)
    expect(owned.alive).toBe(true)
    await owned.stop()
    await owned.stop()
    expect(owned.alive).toBe(false)
  } finally { await owned.stop(); await rm(root, { recursive: true, force: true }) }
})
