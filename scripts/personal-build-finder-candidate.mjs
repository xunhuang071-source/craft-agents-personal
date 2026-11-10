#!/usr/bin/env node
/** Approved local file link fix. Builds a candidate only; never installs or launches it. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = {}
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]
  if (key === '--record-lock') options.record = true
  else if (['--base-app', '--baseline-lock', '--out'].includes(key) && process.argv[i + 1]) options[key.slice(2)] = process.argv[++i]
  else throw Error('Use [--base-app PATH] [--baseline-lock PATH] [--out PATH] [--record-lock]')
}
const lockPath = path.join(root, 'personal-release.json')
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
const baselineLock = path.resolve(root, options['baseline-lock'] || `docs/personal/baselines/${lock.version}.json`)
const baseline = JSON.parse(fs.readFileSync(baselineLock, 'utf8'))
const base = fs.realpathSync(options['base-app'] || '/Applications/Craft Agents.app')
const build = path.join(root, '.personal-build/finder-links')
const code = path.join(build, 'code')
// Retain the established renderer output location for stable source-map paths.
const renderer = path.join(root, '.personal-build/pele/candidate-renderer')
const out = path.resolve(options.out || path.join(root, 'native-artifacts', lock.version))
const app = path.join(out, 'Craft Agents.app')
if (out === '/Applications' || out.startsWith('/Applications/') || app === base || app.startsWith(base + path.sep) || base.startsWith(app + path.sep)) throw Error('Candidate must not overlap the installed application')
if (!options.record && fs.existsSync(out)) throw Error('Choose a fresh candidate output directory')
if (lock.engineCommit !== baseline.engineCommit) throw Error('Engine source must remain pinned')
const bun = path.join(base, 'Contents/Resources/app/vendor/bun/bun')
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-finder-build-'))
const buildEnv = {
  HOME: testHome, USERPROFILE: testHome, CRAFT_CONFIG_DIR: path.join(testHome, 'config'),
  PATH: [path.dirname(process.execPath), path.dirname(bun), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
  TMPDIR: os.tmpdir(), NODE_OPTIONS: '--max-old-space-size=6144',
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: buildEnv })
  if (result.error || result.status !== 0) throw Error(`Command failed: ${path.basename(command)} (${result.error?.code || result.status})`)
}
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function tree(directory) {
  const files = []
  function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) throw Error('Unexpected renderer link')
      if (entry.isDirectory()) collect(file)
      else if (entry.isFile()) files.push(file)
    }
  }
  collect(directory)
  const hash = crypto.createHash('sha256')
  for (const file of files.sort()) hash.update(path.relative(directory, file)).update('\0').update(Buffer.from(sha(file), 'hex'))
  return hash.digest('hex')
}
try {
  run('python3', ['scripts/personal-app-inventory.py', '--app', base, '--lock', baselineLock, '--output', path.join(build, 'baseline-inventory.json')])
  run('node', ['scripts/personal-build.mjs', '--bun', bun, '--out', code, ...(options.record ? [] : ['--verify-current'])])
  if (sha(path.join(code, 'managed-pi.js')) !== baseline.expectedBuild.managedPiSha256 || sha(path.join(code, 'standard-pi.js')) !== baseline.expectedBuild.standardPiSha256) throw Error('Pi bundles changed')
  run(bun, ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/electron/vite.config.ts', '--outDir', renderer, '--emptyOutDir'])
  const mainSha256 = sha(path.join(code, 'main.cjs'))
  const rendererTreeSha256 = tree(renderer)
  if (options.record) {
    lock.expectedBuild.mainSha256 = mainSha256
    lock.frozen.rendererTreeSha256 = rendererTreeSha256
    lock.fileLinkUpdate = {
      baselineLock: path.relative(root, baselineLock),
      scope: 'Local file link recognition, Finder routing, directory/existence and line-reference handling',
      installedAutomatically: false, published: false,
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
    console.log(JSON.stringify({ recorded: true, mainSha256, rendererTreeSha256 }))
    process.exitCode = 0
  } else {
    if (lock.expectedBuild.mainSha256 !== mainSha256 || lock.frozen.rendererTreeSha256 !== rendererTreeSha256) throw Error('Candidate differs from reviewed component lock')
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
    run('python3', ['scripts/personal-audit-candidate.py', '--scope', 'finder-links', '--base-app', base, '--app', app, '--baseline-inventory', path.join(build, 'baseline-inventory.json'), '--inventory', path.join(out, 'application-files.json'), '--out', out])
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', env: buildEnv })
    if (git.status !== 0) throw Error('Cannot identify source commit')
    const manifest = { schemaVersion: 1, version: lock.version, sourceCommit: git.stdout.trim(), engineCommit: lock.engineCommit, baselineVersion: baseline.version,
      application: 'Craft Agents.app', mainSha256, rendererTreeSha256,
      managedPiSha256: baseline.expectedBuild.managedPiSha256, standardPiSha256: baseline.expectedBuild.standardPiSha256,
      installed: false, published: false }
    fs.writeFileSync(path.join(out, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(JSON.stringify({ ...manifest, application: app }))
  }
} finally {
  // Only this script's empty temporary build profile is disposable.
  fs.rmSync(testHome, { recursive: true, force: true })
}
