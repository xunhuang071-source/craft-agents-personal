import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createOfflineEnvironment } from './test-fixtures/offline-environment.ts';

const bundle = process.env.CRAFT_PI_TEST_BUNDLE;
const integration = bundle ? test : test.skip;
const model = 'fixture-kimi';
const summary = '## Goal\nFind the attachments in example.docx before confirming folder names.';
const latest = 'Find the remaining attachments before changing any names.';

function reply(text: string): Response {
  const chunk = (delta: object, finishReason: string | null = null) => ({
    id: 'fixture', object: 'chat.completion.chunk', model, created: 1,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
  const frames = [chunk({ role: 'assistant', content: text }), chunk({}, 'stop')];
  return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

for (const { name, historyTokens, window, threshold, expectedCount, failSummary, switchModel } of [
  { name: 'Kimi-sized old session', historyTokens: 726_216, window: 1_048_576, threshold: 400_000, expectedCount: 2 },
  { name: 'below configured threshold', historyTokens: 380_000, window: 1_048_576, threshold: 400_000, expectedCount: 1 },
  { name: 'smaller model preserves native headroom', historyTokens: 104_000, window: 120_000, threshold: 400_000, expectedCount: 2 },
  { name: 'failed summary keeps the original context', historyTokens: 726_216, window: 1_048_576, threshold: 400_000, expectedCount: 2, failSummary: true },
  { name: 'same model resized after connection refresh', historyTokens: 320_000, window: 1_048_576, threshold: 400_000, expectedCount: 2, switchModel: true },
  { name: 'no setting preserves native default', historyTokens: 726_216, window: 1_048_576, threshold: undefined, expectedCount: 1 },
]) {
  integration(`packaged Pi compaction: ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-pi-window-'));
    const session = join(root, 'sessions', 'fixture');
    const sessionDir = join(session, '.pi-sessions');
    await mkdir(sessionDir, { recursive: true });
    const requests: Array<{ compact: boolean; messages: string }> = [];
    const gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const body = await request.json() as { messages: unknown[] };
      const messages = JSON.stringify(body.messages);
      const compact = messages.includes('Create a structured context checkpoint summary') ||
        messages.includes('earlier context from an ongoing conversation');
      requests.push({ compact, messages });
      if (compact && failSummary) return Response.json({ error: { message: 'fixture rejected summary' } }, { status: 400 });
      return reply(compact ? summary : 'Found the remaining files. Waiting for the naming decision.');
    } });
    const child = spawn(process.execPath, [
      '--preload', join(import.meta.dir, 'test-fixtures/openai-loopback-network.ts'), bundle!,
    ], { cwd: root, env: { ...createOfflineEnvironment(root), CRAFT_PI_TEST_ORIGIN: gateway.url.origin }, stdio: 'pipe' });
    const closed = new Promise(resolve => child.once('close', resolve));
    const rows: Array<Record<string, any>> = [];
    let stderr = '';
    child.stderr.on('data', data => { stderr += String(data); });
    createInterface({ input: child.stdout }).on('line', line => {
      try { rows.push(JSON.parse(line)); } catch { /* Ignore non-protocol output. */ }
    });
    const send = (row: object) => child.stdin.write(JSON.stringify(row) + '\n');
    async function waitFor(predicate: () => boolean, message: string) {
      for (let attempt = 0; attempt < 500; attempt++) {
        if (predicate()) return;
        if (child.exitCode !== null) break;
        await Bun.sleep(20);
      }
      throw new Error(`${message}: ${JSON.stringify(rows.map(row => [row.type, row.event?.type, row.message]))}\n${stderr}`);
    }
    try {
      const journal = join(sessionDir, '2026-11-25T02-55-17-473Z_fixture.jsonl');
      const timestamp = '2026-11-25T02:55:17.473Z';
      const entries: object[] = [{ type: 'session', version: 3, id: 'fixture', timestamp, cwd: root }];
      let parentId: string | null = null;
      function append(id: string, entry: object) {
        entries.push({ id, parentId, timestamp, ...entry });
        parentId = id;
      }
      append('model', { type: 'model_change', provider: 'custom-endpoint', modelId: model });
      for (let index = 0; index < 6; index++) {
        append(`user${index}`, { type: 'message', message: {
          role: 'user', content: `Fixture instruction ${index} ` + 'previous details '.repeat(1900), timestamp: Date.parse(timestamp),
        } });
        append(`assistant${index}`, { type: 'message', message: {
          role: 'assistant', content: [{ type: 'text', text: `Earlier decision ${index}` }], timestamp: Date.parse(timestamp),
          provider: 'custom-endpoint', api: 'openai-completions', model, stopReason: 'stop',
          usage: { input: 0, output: 10, cacheRead: historyTokens, cacheWrite: 0, totalTokens: historyTokens + 10,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        } });
      }
      const original = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      await writeFile(journal, original);
      send({ type: 'init', apiKey: 'local-fixture-key', model, cwd: root, workingDirectory: root,
        thinkingLevel: 'off', workspaceRootPath: root, workspaceId: 'fixture', sessionId: 'fixture',
        sessionPath: session, plansFolderPath: join(session, 'plans'), autoCompactWindow: threshold,
        providerType: 'pi_compat', authType: 'api_key_with_endpoint', baseUrl: `${gateway.url.origin}/v1`,
        customEndpoint: { api: 'openai-completions' }, customModels: [{ id: model, contextWindow: window, maxTokens: 4096 }],
      });
      await waitFor(() => rows.some(row => row.type === 'ready'), 'initialize');
      send({ type: 'set_auto_compaction', id: 'enable', enabled: true });
      await waitFor(() => rows.some(row => row.type === 'set_auto_compaction_result' && row.success), 'enable auto-compaction');
      if (switchModel) {
        send({ type: 'update_runtime_config', id: 'resize', model, baseUrl: `${gateway.url.origin}/v1`,
          customEndpoint: { api: 'openai-completions' }, customModels: [{ id: model, contextWindow: 300_000, maxTokens: 4096 }],
        });
        await waitFor(() => rows.some(row => row.type === 'update_runtime_config_result' && row.success), 'resize model');
        send({ type: 'set_auto_compaction', id: 'enable-again', enabled: true });
        await waitFor(() => rows.some(row => row.id === 'enable-again' && row.success), 'enable again');
      }
      send({ type: 'prompt', id: 'prompt', message: latest, systemPrompt: 'Handle a disposable synthetic attachment case.' });
      await waitFor(() => rows.some(row => row.type === 'event' && row.event?.type === 'agent_end'), 'finish prompt');
      expect(rows.filter(row => row.type === 'error')).toEqual([]);
      const expectedRequests = expectedCount === 2 ? [true, false] : [false];
      const requestKinds = requests.map(request => request.compact);
      if (failSummary) {
        expect(requestKinds.slice(0, 2)).toEqual(expectedRequests);
        expect(requestKinds.filter(kind => !kind)).toHaveLength(1);
      } else {
        expect(requestKinds).toEqual(expectedRequests);
      }
      const normal = requests.find(request => !request.compact)!.messages;
      expect(normal.split(latest)).toHaveLength(2);
      const persisted = await readFile(journal, 'utf8');
      expect(persisted.startsWith(original)).toBe(true);
      if (expectedCount === 2 && !failSummary) {
        expect(normal).toContain('example.docx');
        expect(normal).toContain('Earlier decision 5');
        expect(normal).not.toContain('Earlier decision 0');
        expect(persisted).toContain('"type":"compaction"');
        const events = rows.filter(row => row.type === 'event').map(row => row.event?.type);
        expect(events).toContain('compaction_start');
        expect(events).toContain('compaction_end');
      } else {
        expect(normal).toContain('Earlier decision 0');
        expect(persisted).not.toContain('"type":"compaction"');
        if (failSummary) {
          const failed = rows.find(row => row.type === 'event' && row.event?.type === 'compaction_end');
          expect(failed?.event.errorMessage).toContain('fixture rejected summary');
        }
      }
    } finally {
      child.kill();
      await closed;
      gateway.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);
}
