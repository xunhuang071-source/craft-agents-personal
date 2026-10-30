import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager, type ExtensionAPI, type InlineExtension, type BeforeAgentStartEvent } from '@earendil-works/pi-coding-agent';
import { resolveCraftAgentDir } from './agent-dir.ts';
import { createCraftSettingsManager } from './session-settings.ts';
import {
  CRAFT_SYSTEM_PROMPT_EXTENSION_NAME,
  createCraftResourceLoader,
  createSystemPromptOverride,
  loadCraftWorkspaceInstructions,
} from './system-prompt-override.ts';

/**
 * Regression contract for craft-agents-oss#648.
 *
 * Pi rebuilds its own system prompt on every `session.prompt()` and whenever the
 * tool loadout changes. The only supported way to replace the whole prompt is a
 * `before_agent_start` handler returning `{ systemPrompt }`, which the SDK applies
 * per run. These tests pin that the override registers exactly that handler,
 * stays silent until Craft sets a prompt, and always returns the latest prompt.
 */

type Handler = (event: unknown, ctx: unknown) => unknown;

function loadInline(extension: InlineExtension): Map<string, Handler[]> {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
  } as unknown as ExtensionAPI;
  const factory = typeof extension === 'function' ? extension : extension.factory;
  void factory(pi);
  return handlers;
}

function invoke(handlers: Map<string, Handler[]>, messageType: 'user' | 'custom' = 'user', contextFiles: Array<{ path: string; content: string }> = []): unknown {
  const [handler, ...rest] = handlers.get('before_agent_start') ?? [];
  expect(handler).toBeDefined();
  expect(rest).toHaveLength(0);
  const base = { type: 'before_agent_start' as const, systemPrompt: 'SDK PROMPT', systemPromptOptions: {
    cwd: '/fixture', selectedTools: [], hiddenTools: [], toolSnippets: {}, toolGuidelines: {}, promptGuidelines: [],
    appendSystemPrompt: '', sections: {}, contextFiles, skills: [],
  } };
  const event: BeforeAgentStartEvent = messageType === 'user'
    ? { ...base, messageType, prompt: 'hi' }
    : { ...base, messageType, message: { role: 'custom', customType: 'fixture', content: 'hi', display: false, timestamp: 0 } };
  return handler!(event, {});
}

describe('createSystemPromptOverride', () => {
  it('registers a single hidden before_agent_start handler under a stable inline name', () => {
    const override = createSystemPromptOverride();
    expect(override.extension).toMatchObject({ name: CRAFT_SYSTEM_PROMPT_EXTENSION_NAME, hidden: true });
    const handlers = loadInline(override.extension);
    expect([...handlers.keys()]).toEqual(['before_agent_start']);
  });

  it('leaves the SDK prompt alone until a prompt is set', () => {
    const override = createSystemPromptOverride();
    const handlers = loadInline(override.extension);
    expect(override.current()).toBeUndefined();
    expect(invoke(handlers)).toBeUndefined();
  });

  it('forces the exact Craft prompt once set, on every run', () => {
    const override = createSystemPromptOverride();
    const handlers = loadInline(override.extension);
    override.set('CRAFT_PROMPT');
    expect(invoke(handlers)).toEqual({ systemPrompt: 'CRAFT_PROMPT' });
    expect(invoke(handlers)).toEqual({ systemPrompt: 'CRAFT_PROMPT' });
    expect(override.current()).toBe('CRAFT_PROMPT');
  });

  it('keeps workspace instructions for both user and custom-triggered runs', () => {
    const override = createSystemPromptOverride(); override.set('CRAFT_PROMPT');
    const files = [{ path: '/workspace/AGENTS.md', content: 'WORKSPACE_ONLY' }];
    for (const kind of ['user', 'custom'] as const) {
      expect(invoke(loadInline(override.extension), kind, files)).toEqual({ systemPrompt:
        'CRAFT_PROMPT\n\n<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/workspace/AGENTS.md">\nWORKSPACE_ONLY\n</project_instructions>\n</project_context>' });
    }
  });

  it('a later set() replaces the forced prompt for the next run', () => {
    const override = createSystemPromptOverride();
    const handlers = loadInline(override.extension);
    override.set('FIRST');
    override.set('SECOND');
    expect(invoke(handlers)).toEqual({ systemPrompt: 'SECOND' });
  });
});

describe('createCraftResourceLoader', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('loads the override as an inline extension through the SDK loader', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pi-loader-'));
    dirs.push(root);
    const loader = await createCraftResourceLoader({
      cwd: root,
      agentDir: join(root, '.pi-agent'),
      settingsManager: SettingsManager.inMemory(),
      systemPromptOverride: createSystemPromptOverride(),
    });
    const { extensions, errors } = loader.getExtensions();
    expect(errors).toEqual([]);
    expect(extensions.some(ext => ext.path === `<inline:${CRAFT_SYSTEM_PROMPT_EXTENSION_NAME}>`)).toBe(true);
  });

  it('loads only the Craft workspace AGENTS, not cwd or ancestor instructions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pi-context-')); dirs.push(root);
    const workspace = join(root, 'workspace'), cwd = join(root, 'other', 'repo');
    mkdirSync(workspace, { recursive: true }); mkdirSync(cwd, { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), 'ANCESTOR_MUST_NOT_LOAD');
    writeFileSync(join(cwd, 'AGENTS.md'), 'CWD_MUST_NOT_LOAD');
    writeFileSync(join(workspace, 'AGENTS.md'), 'WORKSPACE_ONLY');
    const loader = await createCraftResourceLoader({ cwd, workspaceRootPath: workspace,
      agentDir: join(root, 'empty-agent'), settingsManager: createCraftSettingsManager(),
      systemPromptOverride: createSystemPromptOverride() });
    expect(loader.getAgentsFiles().agentsFiles).toEqual([{ path: join(workspace, 'AGENTS.md'), content: 'WORKSPACE_ONLY' }]);
    expect(loadCraftWorkspaceInstructions(join(root, 'missing'))).toEqual({ agentsFiles: [] });
    mkdirSync(join(root, 'directory', 'AGENTS.md'), { recursive: true });
    expect(loadCraftWorkspaceInstructions(join(root, 'directory'))).toEqual({ agentsFiles: [] });
  });

  /** A working directory whose `.pi/extensions` would leave a marker file when loaded. */
  function repoWithProjectExtension(): { cwd: string; marker: string } {
    const cwd = mkdtempSync(join(tmpdir(), 'craft-pi-repo-'));
    dirs.push(cwd);
    const marker = join(cwd, 'extension-ran');
    mkdirSync(join(cwd, '.pi', 'extensions'), { recursive: true });
    writeFileSync(
      join(cwd, '.pi', 'extensions', 'repo-extension.ts'),
      `import { writeFileSync } from 'node:fs';\n` +
        `export default function repoExtension() { writeFileSync(${JSON.stringify(marker)}, 'ran'); }\n`,
    );
    return { cwd, marker };
  }

  it('loads nothing but the override for Craft sessions (no project, global or built-in extensions)', async () => {
    const { cwd, marker } = repoWithProjectExtension();
    const sessionPath = mkdtempSync(join(tmpdir(), 'craft-pi-session-'));
    dirs.push(sessionPath);
    for (const purpose of ['main', 'ephemeral'] as const) {
      const loader = await createCraftResourceLoader({
        cwd,
        agentDir: resolveCraftAgentDir({ sessionPath }),
        settingsManager: createCraftSettingsManager(purpose),
        systemPromptOverride: createSystemPromptOverride(),
      });
      const { extensions, errors } = loader.getExtensions();
      expect(errors).toEqual([]);
      expect(extensions.map(ext => ext.path)).toEqual([`<inline:${CRAFT_SYSTEM_PROMPT_EXTENSION_NAME}>`]);
    }
    expect(existsSync(marker)).toBe(false);
  });

  it('control: a trusted project (the SDK default) would run the repository extension', async () => {
    const { cwd, marker } = repoWithProjectExtension();
    const loader = await createCraftResourceLoader({
      cwd,
      agentDir: join(cwd, '.pi-agent'),
      settingsManager: SettingsManager.inMemory(),
      systemPromptOverride: createSystemPromptOverride(),
    });
    expect(loader.getExtensions().extensions.some(ext => ext.path.endsWith('repo-extension.ts'))).toBe(true);
    expect(existsSync(marker)).toBe(true);
  });
});
