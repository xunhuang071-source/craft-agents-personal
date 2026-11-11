#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [baseArg, outArg] = process.argv.slice(2);
if (!baseArg || !outArg) throw Error('Usage: node scripts/personal-build-pi-only.mjs BASE_APP NEW_OUTPUT_DIR');
const base = fs.realpathSync(baseArg);
const out = path.resolve(outArg);
if (fs.existsSync(out)) throw Error('Choose a fresh output directory');
const parent = fs.realpathSync(path.dirname(out));
if (parent === '/Applications' || parent.startsWith('/Applications/') || parent === base || parent.startsWith(base + path.sep)) {
  throw Error('Output must be outside the baseline application and Applications directory');
}
const runtime = 'Contents/Resources/app';
const main = `${runtime}/dist/main.cjs`;
const standardPi = `${runtime}/resources/pi-agent-server/index.js`;
const baselinePath = path.join(root, 'docs/personal/baselines/wallee-v1.2.0.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-pi-only-build-'));
const env = { HOME: fixture, USERPROFILE: fixture, CRAFT_CONFIG_DIR: path.join(fixture, 'config'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: os.tmpdir() };
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`${path.basename(command)}: ${result.error || result.stderr}`);
  return result.stdout.trim();
}

try {
  const esbuild = path.join(root, 'node_modules/.bin/esbuild');
  if (run(esbuild, ['--version']) !== baseline.build.esbuild) throw Error('Use the pinned esbuild version');
  run('/usr/bin/python3', ['scripts/personal-app-inventory.py', '--app', base, '--lock', baselinePath, '--output', path.join(fixture, 'baseline.json')]);
  const hostBundle = path.join(fixture, 'main.cjs');
  const metafile = path.join(fixture, 'host-build.json');
  const defines = ['SLACK_OAUTH_CLIENT_ID', 'SLACK_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'SENTRY_ELECTRON_INGEST_URL', 'CRAFT_DEV_RUNTIME']
    .map(key => `--define:process.env.${key}=""`);
  run(esbuild, ['apps/electron/src/main/index.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${hostBundle}`, `--metafile=${metafile}`,
    '--external:electron', '--alias:node-fetch=./apps/electron/src/main/shims/node-fetch.cjs',
    '--alias:abort-controller=./apps/electron/src/main/shims/abort-controller.cjs', ...defines]);
  const graph = fs.readFileSync(metafile, 'utf8');
  if (/claude-agent-sdk|managed-antigravity|antigravity-(menu|service|controller)/.test(graph)) throw Error('Retired runtime found in the host dependency graph');

  fs.mkdirSync(out);
  const app = path.join(out, 'Craft Agents.app');
  const excluded = [`${runtime}/node_modules/@anthropic-ai`, `${runtime}/resources/antigravity-pi-agent-server`];
  fs.cpSync(base, app, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, filter: source => {
    const relative = path.relative(base, source);
    return relative !== main && !excluded.some(entry => relative === entry || relative.startsWith(entry + path.sep));
  }});
  fs.copyFileSync(hostBundle, path.join(app, main));
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const inventoryPath = path.join(out, 'application-files.json');
  const manifest = { version: 'wallee-v1.3.0-rc.1', baselineVersion: baseline.version, mainSha256: digest(path.join(app, main)),
    standardPiSha256: digest(path.join(app, standardPi)), installed: false, published: false };
  if (manifest.standardPiSha256 !== baseline.expectedBuild.standardPiSha256) throw Error('Standard Pi changed');
  const componentLock = path.join(out, 'component-lock.json');
  fs.writeFileSync(componentLock, JSON.stringify({ ...baseline, version: manifest.version, expectedBuild: { mainSha256: manifest.mainSha256, standardPiSha256: manifest.standardPiSha256 } }, null, 2) + '\n');
  run('/usr/bin/python3', ['scripts/personal-app-inventory.py', '--app', app, '--lock', componentLock, '--output', inventoryPath]);
  fs.writeFileSync(path.join(out, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(app);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
