import { expect, test } from 'bun:test';
import { createOfflineEnvironment } from './test-fixtures/offline-environment.ts';

test('bundle environments allow only platform launch variables, never provider/config/preload state', () => {
  const poison = {
    OPENAI_API_KEY: 'fixture-not-a-secret', ANTHROPIC_API_KEY: 'fixture-not-a-secret',
    GOOGLE_APPLICATION_CREDENTIALS: '/fixture/never-read.json', AWS_PROFILE: 'fixture-profile',
    HTTP_PROXY: 'http://invalid.test', HTTPS_PROXY: 'http://invalid.test',
    BUN_OPTIONS: '--preload /fixture/never-run.ts', NODE_OPTIONS: '--require /fixture/never-run.js',
    PI_CODING_AGENT_DIR: '/fixture/never-read', CRAFT_CONFIG_DIR: '/fixture/never-read',
  };
  const saved = Object.fromEntries(Object.keys(poison).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, poison);
    const env = createOfflineEnvironment('/fixture/isolated');
    expect(env.HOME).toBe('/fixture/isolated');
    expect(env.USERPROFILE).toBe('/fixture/isolated');
    expect(env.CRAFT_CONFIG_DIR).toBe('/fixture/isolated/config');
    for (const key of Object.keys(poison).filter(key => key !== 'CRAFT_CONFIG_DIR')) expect(env[key]).toBeUndefined();
    expect(Object.keys(env).every(key => [
      'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'CRAFT_CONFIG_DIR', 'TMPDIR', 'TEMP', 'TMP', 'CRAFT_DEBUG',
      'PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
    ].includes(key))).toBe(true);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
