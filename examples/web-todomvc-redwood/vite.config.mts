import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import { redwood } from 'rwsdk/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'worker' },
    }),
    redwood(),
  ],
  resolve: {
    // Force browser loader for SQLite WASM instead of workerd loader
    // The Cloudflare plugin sets "workerd" condition, but LiveStore workers
    // run as browser Web Workers, not in Cloudflare Workers isolate.
    // The workerd loader has direct WASM imports incompatible with Vite builds.
    alias: {
      '@livestore/sqlite-wasm/load-wasm': path.resolve(
        __dirname,
        'node_modules/@livestore/sqlite-wasm/dist/load-wasm/mod.browser.js',
      ),
    },
  },
})
