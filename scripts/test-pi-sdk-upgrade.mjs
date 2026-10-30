#!/usr/bin/env node
/** Reproducible local fixture regression. Never uses the real application profile. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bun = process.env.CRAFT_BUN || '/Applications/Craft Agents.app/Contents/Resources/app/vendor/bun/bun';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-pi14-regression-'));
const config = path.join(scratch, 'config');
fs.mkdirSync(config);
fs.copyFileSync(path.join(root, 'apps/electron/resources/config-defaults.json'), path.join(config, 'config-defaults.json'));
const env = { HOME: scratch, USERPROFILE: scratch, XDG_CONFIG_HOME: scratch,
  CRAFT_CONFIG_DIR: config, CRAFT_DEBUG: '0', TMPDIR: scratch, TMP: scratch, TEMP: scratch,
  PATH: `${path.dirname(bun)}:/usr/bin:/bin:/usr/sbin:/sbin` };
const files = [
  'packages/shared/src/agent/__tests__/pi-event-adapter.test.ts',
  'packages/shared/src/agent/__tests__/pi-retry-sdk-integration.test.ts',
  'packages/shared/src/agent/__tests__/pi-compaction.test.ts',
  'packages/shared/src/agent/__tests__/pi-context-usage.test.ts',
  'packages/shared/src/agent/__tests__/pi-agent-error-handling.test.ts',
  'packages/shared/src/agent/__tests__/pi-agent-guarded-mode.test.ts',
  'packages/shared/src/agent/__tests__/pi-query-llm.test.ts',
  'packages/shared/src/agent/__tests__/pi-agent-pretool-labels.test.ts',
  'packages/shared/src/agent/__tests__/pi-agent-branching-capability.test.ts',
  'packages/shared/src/agent/__tests__/pi-browser-tool-toggle.test.ts',
  'packages/shared/tests/models-pi.test.ts',
  'packages/shared/src/config/__tests__/personal-codex-model.test.ts',
  'packages/shared/src/config/__tests__/pi-sdk-upgrade.test.ts',
  'packages/shared/src/prompts/__tests__/developer-context.test.ts',
  'packages/server-core/src/sessions/pi-turn-anchors.test.ts',
  'packages/server-core/src/sessions/pi-retry-streaming.test.ts',
];
// The personal distribution is macOS-only. Fail closed rather than run without an OS network boundary.
const sandbox = '/usr/bin/sandbox-exec';
if (process.platform !== 'darwin' || !fs.existsSync(sandbox)) throw Error('A macOS network sandbox is required');
const policy = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';
const result = spawnSync(sandbox, ['-p', policy, bun, 'test', '--preload', path.join(root, 'packages/pi-agent-server/src/test-fixtures/block-network.ts'), ...files], { cwd: root, env, stdio: 'inherit', timeout: 120_000 });
if (result.error) console.error(result.error.message);
console.log(JSON.stringify({ profile: 'temporary synthetic defaults', commandExit: result.status, realProfileRead: false }));
// Keep only failed fixture diagnostics, not a user-data backup.
if (result.status === 0) fs.rmSync(scratch, { recursive: true });
process.exit(result.status ?? 1);
