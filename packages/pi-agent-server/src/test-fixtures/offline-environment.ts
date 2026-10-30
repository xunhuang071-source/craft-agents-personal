import { join } from 'node:path';

/** Never inherit provider keys, proxy settings, Bun preloads or real config paths. */
export function createOfflineEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: root,
    USERPROFILE: root,
    XDG_CONFIG_HOME: join(root, 'config'),
    CRAFT_CONFIG_DIR: join(root, 'config'),
    TMPDIR: root,
    TEMP: root,
    TMP: root,
    CRAFT_DEBUG: '0',
  };
  // Only platform launch variables may cross the subprocess boundary.
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'] as const) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}
