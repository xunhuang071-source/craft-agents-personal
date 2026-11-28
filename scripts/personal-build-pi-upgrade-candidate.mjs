#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [baseArg, outArg, version] = process.argv.slice(2)
if (!baseArg || !outArg || !/^wallee-v\d+\.\d+\.\d+-rc\.\d+$/.test(version ?? '')) {
  throw new Error('Usage: node scripts/personal-build-pi-upgrade-candidate.mjs VERIFIED_BASE_APP NEW_OUTPUT_DIR VERSION')
}
const base = fs.realpathSync(baseArg)
const out = path.resolve(outArg)
const app = path.join(out, 'Craft Agents.app')
if (fs.existsSync(out) || out === '/Applications' || out.startsWith('/Applications/')) {
  throw new Error('Choose a new candidate output directory outside /Applications')
}
const baselinePath = path.join(root, 'docs/personal/baselines/wallee-v1.5.4.json')
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const sdkVersion = '1.7.0'
for (const name of ['pi-ai', 'pi-agent-core', 'pi-coding-agent']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@earendil-works', name, 'package.json'), 'utf8'))
  if (manifest.version !== sdkVersion) throw new Error(`Expected ${name} ${sdkVersion}`)
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-pi-upgrade-'))
const prefix = 'Contents/Resources/app'
const piPath = `${prefix}/resources/pi-agent-server`
const bun = path.join(base, prefix, 'vendor/bun/bun')
const esbuild = path.join(root, 'node_modules/.bin/esbuild')
const env = { HOME: staging, USERPROFILE: staging, CRAFT_CONFIG_DIR: path.join(staging, 'config'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: os.tmpdir() }
function run(command, args) {
  return execFileSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const inventory = (target, lock, output) => run('/usr/bin/python3', ['scripts/personal-app-inventory.py', '--app', target, '--lock', lock, '--output', output])

try {
  if (run(bun, ['--version']) !== baseline.build.bun || run(esbuild, ['--version']) !== baseline.build.esbuild) {
    throw new Error('Use the baseline build tools')
  }
  const baseInventory = path.join(staging, 'baseline-application-files.json')
  inventory(base, baselinePath, baseInventory)
  const piOutput = path.join(staging, 'pi')
  console.log(run(bun, ['run', 'packages/pi-agent-server/build.ts', piOutput]))
  const main = path.join(staging, 'main.cjs')
  const graph = path.join(staging, 'main-graph.json')
  const defines = ['SLACK_OAUTH_CLIENT_ID', 'SLACK_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'SENTRY_ELECTRON_INGEST_URL', 'CRAFT_DEV_RUNTIME']
  run(esbuild, ['apps/electron/src/main/index.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${main}`,
    `--metafile=${graph}`, '--external:electron', '--alias:node-fetch=./apps/electron/src/main/shims/node-fetch.cjs',
    '--alias:abort-controller=./apps/electron/src/main/shims/abort-controller.cjs', ...defines.map(key => `--define:process.env.${key}=""`)])
  if (/claude-agent-sdk|managed-antigravity|antigravity-(menu|service|controller)/.test(fs.readFileSync(graph, 'utf8'))) {
    throw new Error('Retired runtime entered the main bundle')
  }

  fs.mkdirSync(out)
  run('/usr/bin/ditto', ['--norsrc', '--noextattr', '--noacl', base, app])
  fs.copyFileSync(main, path.join(app, prefix, 'dist/main.cjs'))
  const lock = structuredClone(baseline)
  lock.version = version
  lock.upstream.piSdk = sdkVersion
  lock.previousAcceptance = baseline.acceptance
  lock.acceptance = { version, installedByUser: false, manualReview: 'pending', publicationAuthorizedByUser: false }
  lock.expectedBuild.mainSha256 = sha(main)
  lock.expectedBuild.standardPiSha256 = sha(path.join(piOutput, 'index.js'))
  for (const file of ['index.js', 'image-resize-worker.js', 'photon_rs_bg.wasm']) {
    const relative = `${piPath}/${file}`
    const source = path.join(piOutput, file)
    fs.copyFileSync(source, path.join(app, relative))
    if (file !== 'index.js') lock.frozen.files[relative] = sha(source)
  }
  const lockPath = path.join(out, 'component-lock.json')
  const appInventory = path.join(out, 'application-files.json')
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  fs.copyFileSync(baseInventory, path.join(out, path.basename(baseInventory)))
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', app])
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  inventory(app, lockPath, appInventory)
  run('/usr/bin/python3', ['scripts/personal-audit-candidate.py', '--base-app', base, '--app', app,
    '--baseline-inventory', baseInventory, '--inventory', appInventory, '--out', out, '--scope', 'pi-upgrade'])
  const sourceCommit = run('/usr/bin/git', ['rev-parse', 'HEAD'])
  const sourceDirty = Boolean(run('/usr/bin/git', ['status', '--porcelain']))
  const manifest = { schemaVersion: 1, version, baselineVersion: baseline.version, piSdk: sdkVersion, sourceCommit, sourceDirty,
    ...lock.expectedBuild, installed: false, published: false }
  fs.writeFileSync(path.join(out, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(app)
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}
