import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession, SessionManager, type BeforeAgentStartEvent, type ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { createCraftSettingsManager } from './session-settings.ts';
import { createCraftResourceLoader, createSystemPromptOverride } from './system-prompt-override.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(managed: boolean, beforeStart: (event: BeforeAgentStartEvent) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'craft-pi-run-'));
  const model: Model<'openai-responses'> = {
    id: 'offline-startup', name: 'Offline', api: 'openai-responses', provider: 'openai',
    baseUrl: 'https://invalid.test', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
  };
  const override = createSystemPromptOverride();
  override.set('EXACT_CRAFT_PROMPT');
  const extension = override.extension;
  const factory = typeof extension === 'function' ? extension : extension.factory;
  const settingsManager = createCraftSettingsManager('main');
  const resourceLoader = await createCraftResourceLoader({
    cwd: root, agentDir: join(root, 'agent'), settingsManager,
    systemPromptOverride: { ...override, extension: { name: 'offline-run', factory: async pi => {
      await factory(pi);
      pi.on('before_agent_start', beforeStart);
    } } },
  });
  const { session } = await createAgentSession({
    cwd: root, agentDir: join(root, 'agent'), model, settingsManager, resourceLoader,
    sessionManager: SessionManager.inMemory(root), tools: [],
    modelRuntime: {
      hasConfiguredAuth: () => true, getModel: () => model, getAvailableSnapshot: () => [model],
      streamSimple: () => { throw new Error('External provider access is forbidden'); },
    } as unknown as ModelRuntime,
  });
  const calls: string[] = [];
  const events: string[] = [];
  session.subscribe(event => { events.push(event.type); });
  session.agent.streamFunction = (_model, context, options) => {
    // Agent core may enter a stream function with an already-aborted signal.
    // Model transports must honor that signal before opening a request.
    const aborted = options?.signal?.aborted === true;
    if (!aborted) calls.push(JSON.stringify(context));
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: 'assistant', content: [{ type: 'text', text: 'offline-done' }], api: model.api, provider: model.provider,
      model: model.id, timestamp: Date.now(), stopReason: aborted ? 'aborted' : 'stop',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    stream.push({ type: 'start', partial: { ...message, content: [], stopReason: 'pending' } });
    if (aborted) stream.push({ type: 'error', reason: 'aborted', error: message });
    else stream.push({ type: 'done', reason: 'stop', message });
    return stream;
  };
  return { session, calls, events, dispose: async () => {
    session.clearQueue();
    await session.abort();
    session.dispose();
    await rm(root, { recursive: true, force: true });
  } };
}

for (const managed of [false]) {
  const label = managed ? 'managed' : 'normal';
  test(`${label}: a starting run is busy, batches steer, and settles exactly once`, async () => {
    const entered = deferred(); const release = deferred();
    const f = await fixture(managed, async event => {
      expect(event.messageType).toBe('user');
      entered.resolve(); await release.promise;
    });
    const turn = f.session.prompt('initial');
    try {
      await entered.promise;
      expect(f.session.isStreaming).toBe(true);
      expect(f.session.isIdle).toBe(false);
      expect(f.calls).toHaveLength(0);
      await f.session.steer('startup-steer-A');
      await f.session.steer('startup-steer-B');
      release.resolve();
      await turn;
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]).toContain('startup-steer-A');
      expect(f.calls[0]).toContain('startup-steer-B');
      expect(f.calls[0]).toContain('EXACT_CRAFT_PROMPT');
      expect(f.events.filter(type => type === 'agent_end')).toHaveLength(1);
      expect(f.events.filter(type => type === 'agent_settled')).toHaveLength(1);
      expect(f.events.indexOf('agent_end')).toBeLessThan(f.events.indexOf('agent_settled'));
      expect(f.session.isIdle).toBe(true);
    } finally { release.resolve(); await turn; await f.dispose(); }
  }, 5000);

  test(`${label}: cancel during before_agent_start performs no model request`, async () => {
    const entered = deferred(); const release = deferred();
    const f = await fixture(managed, async () => { entered.resolve(); await release.promise; });
    const turn = f.session.prompt('cancel before provider call');
    try {
      await entered.promise;
      const abort = f.session.abort();
      release.resolve();
      await Promise.all([turn, abort]);
      expect(f.calls).toHaveLength(0);
      expect(f.events.filter(type => type === 'agent_settled')).toHaveLength(1);
      expect(f.session.isIdle).toBe(true);
    } finally { release.resolve(); await turn; await f.dispose(); }
  }, 5000);

  test(`${label}: idle custom runs also receive the exact Craft system prompt`, async () => {
    const messageTypes: string[] = [];
    const f = await fixture(managed, async event => { messageTypes.push(event.messageType); });
    try {
      await f.session.sendCustomMessage({ customType: 'fixture', content: 'offline-custom', display: false }, { triggerTurn: true });
      expect(messageTypes).toEqual(['custom']);
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]).toContain('EXACT_CRAFT_PROMPT');
      expect(f.events.filter(type => type === 'agent_settled')).toHaveLength(1);
    } finally { await f.dispose(); }
  }, 5000);
}
