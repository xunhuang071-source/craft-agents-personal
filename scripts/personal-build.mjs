#!/usr/bin/env node
/** Build only the host main and managed Pi adapter. Never touches the installed app. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'personal-release.json'), 'utf8'));
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--verify-current') options.verify = true;
  else if (['--engine-root', '--out', '--bun'].includes(key) && process.argv[i + 1]) options[key.slice(2)] = process.argv[++i];
  else throw Error('Use --engine-root PATH --bun PATH [--out PATH] [--verify-current]');
}
const engine = path.resolve(options['engine-root'] || process.env.CRAFT_PERSONAL_ENGINE || path.join(root, '../craft-antigravity-native-engine'));
const out = path.resolve(options.out || path.join(root, '.personal-build'));
const bun = options.bun || process.env.CRAFT_BUN || 'bun';
if (out === '/Applications' || out.startsWith('/Applications/')) throw Error('Build output cannot be the installed application');
function run(command, args, cwd = root) {
  const p = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (p.error || p.status !== 0) throw Error(`Build command failed: ${path.basename(command)} (${p.error?.code || p.status})`);
  return p.stdout.trim();
}
const esbuild = path.join(root, 'node_modules/.bin/esbuild');
if (run(bun, ['--version']) !== lock.build.bun) throw Error('Use the pinned Bun version');
if (run(esbuild, ['--version']) !== lock.build.esbuild) throw Error('Use the pinned esbuild dependency');
if (run('git', ['rev-parse', 'HEAD'], engine) !== lock.engineCommit) throw Error('Engine commit differs from personal-release.json');
if (run('git', ['status', '--porcelain', '--untracked-files=no'], engine)) throw Error('Commit engine source changes before building a release');
fs.mkdirSync(out, { recursive: true });
const main = path.join(out, 'main.cjs');
const managed = path.join(out, 'managed-pi.js');
// This release intentionally has empty build-time OAuth defines. Runtime account credentials are never read.
const defines = ['SLACK_OAUTH_CLIENT_ID', 'SLACK_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'SENTRY_ELECTRON_INGEST_URL', 'CRAFT_DEV_RUNTIME'].map(k => `--define:process.env.${k}=""`);
run(esbuild, [
  'apps/electron/src/main/index.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${main}`,
  '--external:electron', '--external:@anthropic-ai/claude-agent-sdk',
  '--alias:node-fetch=./apps/electron/src/main/shims/node-fetch.cjs',
  '--alias:abort-controller=./apps/electron/src/main/shims/abort-controller.cjs', ...defines,
]);
run(bun, ['build', 'packages/pi-agent-server/src/index.ts', '--outfile', managed, '--target', 'bun', '--format', 'esm', '--external', 'koffi'], engine);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result = { version: lock.version, engineCommit: lock.engineCommit, main, managed, mainSha256: sha(main), managedPiSha256: sha(managed) };
if (options.verify && (result.mainSha256 !== lock.expectedBuild.mainSha256 || result.managedPiSha256 !== lock.expectedBuild.managedPiSha256)) throw Error('Rebuilt code differs from the recorded release; do not publish as that version');
console.log(JSON.stringify(result, null, 2));
