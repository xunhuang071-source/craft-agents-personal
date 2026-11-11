#!/usr/bin/env node
/** Approved inline Mermaid reading / preview gesture exception; renderer only. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [baseArg, outArg, version] = process.argv.slice(2)
if (!baseArg || !outArg || !/^wallee-v\d+\.\d+\.\d+-rc\.\d+$/.test(version || '')) throw Error('Usage: node scripts/personal-build-reading-candidate.mjs VERIFIED_BASE_APP NEW_OUTPUT_DIR NEW_CANDIDATE_VERSION')
const base = fs.realpathSync(baseArg), out = path.resolve(outArg), app = path.join(out, 'Craft Agents.app')
if (fs.existsSync(out) || out.startsWith('/Applications/') || app === base || app.startsWith(base + path.sep) || base.startsWith(app + path.sep)) throw Error('Choose a fresh, non-overlapping candidate directory')
const lockPath = path.join(root, 'personal-release.json'), baseline = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
if (baseline.version !== 'wallee-v1.4.0') throw Error('Review the stable baseline before using this build')
const work = path.join(root, '.personal-build'); fs.mkdirSync(work, { recursive: true })
const staging = fs.mkdtempSync(path.join(work, 'diagram-reading-')), renderer = path.join(staging, 'renderer')
const bun = path.join(base, 'Contents/Resources/app/vendor/bun/bun')
function run(command, args) { const p = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=6144' } }); if (p.error || p.status !== 0) throw Error(`${path.basename(command)} failed (${p.error?.message || p.status})`) }
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function tree(directory) {
  const files = []
  function collect(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isSymbolicLink()) throw Error('Unexpected renderer symlink'); if (e.isDirectory()) collect(f); else if (e.isFile()) files.push(f) } }
  collect(directory); const hash = crypto.createHash('sha256'); for (const file of files.sort()) hash.update(path.relative(directory, file)).update('\0').update(Buffer.from(sha(file), 'hex')); return hash.digest('hex')
}
run('python3', ['scripts/personal-app-inventory.py', '--app', base, '--lock', lockPath, '--output', path.join(staging, 'baseline-application-files.json')])
// Vite only. Never rebuild main, Pi, preloads, interceptor or the workbench.
run(bun, ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/electron/vite.config.ts', '--outDir', renderer, '--emptyOutDir'])
const lock = structuredClone(baseline); lock.version = version; lock.frozen.rendererTreeSha256 = tree(renderer)
lock.previousAcceptance = baseline.acceptance
lock.acceptance = { version, installedByUser: false, manualReview: 'pending', publicationAuthorizedByUser: false }
lock.readingUpdate = { baselineVersion: baseline.version, scope: 'inline Mermaid sizing and shared image/diagram preview gestures', renderer: 'pele@1.12.0', installedAutomatically: false }
fs.mkdirSync(out)
const relRenderer = 'Contents/Resources/app/dist/renderer'
fs.cpSync(base, app, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, filter: source => { const rel = path.relative(base, source); return rel !== relRenderer && !rel.startsWith(relRenderer + path.sep) } })
fs.cpSync(renderer, path.join(app, relRenderer), { recursive: true, preserveTimestamps: true })
fs.writeFileSync(path.join(out, 'component-lock.json'), JSON.stringify(lock, null, 2) + '\n')
fs.copyFileSync(path.join(staging, 'baseline-application-files.json'), path.join(out, 'baseline-application-files.json'))
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', app])
run('python3', ['scripts/personal-app-inventory.py', '--app', app, '--lock', path.join(out, 'component-lock.json'), '--output', path.join(out, 'application-files.json')])
const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim()
fs.writeFileSync(path.join(out, 'candidate-manifest.json'), JSON.stringify({ schemaVersion: 1, version, baselineVersion: baseline.version, sourceCommit, sourceDirty: !!dirty, rendererTreeSha256: lock.frozen.rendererTreeSha256, mainSha256: lock.expectedBuild.mainSha256, standardPiSha256: lock.expectedBuild.standardPiSha256, installed: false, published: false }, null, 2) + '\n')
run('python3', ['scripts/personal-audit-candidate.py', '--base-app', base, '--app', app, '--baseline-inventory', path.join(out, 'baseline-application-files.json'), '--inventory', path.join(out, 'application-files.json'), '--out', out, '--scope', 'diagram-reading'])
console.log(JSON.stringify({ version, app, installed: false, published: false }))
