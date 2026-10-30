import assert from 'node:assert/strict';
import { getPiApiKeyProviders, getPiModelsForAuthProvider } from '../../packages/shared/src/config/models-pi.ts';
// Bundle this with the same esbuild platform/format as the Electron host and run
// outside the checkout. It must not rely on source node_modules or catalog files.
for (const provider of ['google', 'openai', 'anthropic', 'azure-openai-responses']) {
  assert.ok(getPiModelsForAuthProvider(provider).length > 0, `Missing bundled catalog: ${provider}`);
}
const sol = getPiModelsForAuthProvider('openai-codex').filter(m => m.id === 'pi/gpt-6.1-sol');
assert.equal(sol.length, 1);
assert.equal(sol[0]?.contextWindow, 500_000);
assert.ok(getPiApiKeyProviders().some(provider => provider.key === 'azure-openai-responses'));
console.log(JSON.stringify({ bundledHostCatalog: 'passed', providers: 4, sol500K: true, realProfileRead: false }));
