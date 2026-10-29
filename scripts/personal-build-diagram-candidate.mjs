#!/usr/bin/env node
/** Approved renderer + host Mermaid-validator exception. Never installs or reads profiles. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = {}
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]
  if (key === '--record-lock') options.record = true
  else if (['--base-app', '--out'].includes(key) && process.argv[i + 1]) options[key.slice(2)] = process.argv[++i]
  else throw Error('Use [--base-app PATH] [--out PATH] [--record-lock]')
}
const lockPath = path.join(root, 'personal-release.json')
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
const base = fs.realpathSync(options['base-app'] || '/Applications/Craft Agents.app')
const baselineLock = path.join(root, 'docs/personal/baselines/wallee-v1.0.0.json')
const baseline = JSON.parse(fs.readFileSync(baselineLock, 'utf8'))
const build = path.join(root, '.personal-build/pele')
const code = path.join(build, 'candidate-code')
const renderer = path.join(build, 'candidate-renderer')
const out = path.resolve(options.out || path.join(root, 'native-artifacts', lock.version))
const app = path.join(out, 'Craft Agents.app')
if (out.startsWith('/Applications/') || out === '/Applications' || app.startsWith(base + path.sep) || base.startsWith(app + path.sep) || app === base) throw Error('Candidate must not overlap the installed/base application')
if (!options.record && fs.existsSync(out)) throw Error('Candidate output already exists; choose a fresh directory')
const bun = path.join(base, 'Contents/Resources/app/vendor/bun/bun')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=6144' } })
  if (result.error || result.status !== 0) throw Error(`Command failed: ${path.basename(command)} (${result.error?.code || result.status})`)
}
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function tree(directory) {
  const files = []
  function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) throw Error('Unexpected link in renderer')
      if (entry.isDirectory()) collect(file)
      else if (entry.isFile()) files.push(file)
    }
  }
  collect(directory)
  const hash = crypto.createHash('sha256')
  for (const file of files.sort()) hash.update(path.relative(directory, file)).update('\0').update(Buffer.from(sha(file), 'hex'))
  return hash.digest('hex')
}
// Validate the immutable base using its own release lock, never the new renderer hash.
run('python3', ['scripts/personal-app-inventory.py', '--app', base, '--lock', baselineLock, '--output', path.join(build, 'baseline-inventory.json')])
fs.mkdirSync(build, { recursive: true })
run('node', ['scripts/personal-build.mjs', '--bun', bun, '--out', code, ...(options.record ? [] : ['--verify-current'])])
run(bun, ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/electron/vite.config.ts', '--outDir', renderer, '--emptyOutDir'])
const mainSha256 = sha(path.join(code, 'main.cjs'))
const managedPiSha256 = sha(path.join(code, 'managed-pi.js'))
const rendererTreeSha256 = tree(renderer)
if (managedPiSha256 !== baseline.expectedBuild.managedPiSha256) throw Error('Managed Pi must remain byte-identical')
if (options.record) {
  lock.version = 'wallee-v1.1.0-rc.1'
  lock.expectedBuild.mainSha256 = mainSha256
  lock.frozen.rendererTreeSha256 = rendererTreeSha256
  lock.rendererUpdate = {
    renderer: 'pele@1.12.0', interactions: 'one app-owned zoom/selection/annotation layer',
    baselineLock: 'docs/personal/baselines/wallee-v1.0.0.json',
    scope: 'Mermaid renderer, editor type detection, annotation overlay, host validation handler',
    retainedPiStaticCode: 'Frozen Pi bundles retain upstream static validator code, but registered session tools proxy to the host Pele handler; both paths are integration-tested.',
    installedAutomatically: false, published: false,
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  console.log(JSON.stringify({ recorded: true, mainSha256, managedPiSha256, rendererTreeSha256 }))
  process.exit(0)
}
if (lock.expectedBuild.mainSha256 !== mainSha256 || lock.frozen.rendererTreeSha256 !== rendererTreeSha256) throw Error('Candidate code differs from reviewed release lock')
// Copy only application code. Omit superseded renderer chunks instead of leaving
// an unused second diagram renderer in the new renderer directory.
const rendererRel = 'Contents/Resources/app/dist/renderer'
const mainRel = 'Contents/Resources/app/dist/main.cjs'
fs.mkdirSync(out, { recursive: false })
fs.cpSync(base, app, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, filter(source) {
  const rel = path.relative(base, source)
  return rel !== mainRel && rel !== rendererRel && !rel.startsWith(rendererRel + path.sep)
} })
fs.cpSync(renderer, path.join(app, rendererRel), { recursive: true, preserveTimestamps: true })
fs.copyFileSync(path.join(code, 'main.cjs'), path.join(app, mainRel))
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', app])
run('python3', ['scripts/personal-app-inventory.py', '--app', app, '--output', path.join(out, 'application-files.json')])
run('python3', ['scripts/personal-audit-candidate.py', '--base-app', base, '--app', app, '--baseline-inventory', path.join(build, 'baseline-inventory.json'), '--inventory', path.join(out, 'application-files.json'), '--out', out])
const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const manifest = { schemaVersion: 1, version: lock.version, sourceCommit, engineCommit: lock.engineCommit,
  application: 'Craft Agents.app', mainSha256, managedPiSha256, rendererTreeSha256,
  baselineVersion: baseline.version, installed: false, published: false,
}
fs.writeFileSync(path.join(out, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ ...manifest, application: app }))
