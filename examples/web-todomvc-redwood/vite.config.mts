import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { redwood } from 'rwsdk/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: 'worker' } }), redwood()],
  // Always resolve sqlite-wasm to the browser loader so SSR never sees
  // workerd’s raw WASM import path. This mirrors the original working setup.
  resolve: {
    alias: {
      '@livestore/sqlite-wasm/load-wasm': path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../packages/@livestore/sqlite-wasm/dist/load-wasm/mod.browser.js',
      ),
    },
  },
})
