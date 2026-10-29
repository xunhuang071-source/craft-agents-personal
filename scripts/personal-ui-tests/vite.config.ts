import { defineConfig, mergeConfig } from 'vite'
import base from '../../apps/electron/vite.config'
import { resolve } from 'node:path'
export default mergeConfig(base, defineConfig({
  root: resolve(import.meta.dirname),
  server: { host: '127.0.0.1', port: 5196, strictPort: true, open: false },
  build: { outDir: resolve(import.meta.dirname, '../../.personal-build/pele/fixture'), rollupOptions: { input: resolve(import.meta.dirname, 'index.html') } },
}))
