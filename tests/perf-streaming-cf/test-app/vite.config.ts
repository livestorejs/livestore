import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const wranglerConfigPath = fileURLToPath(new URL('../wrangler.toml', import.meta.url))

export default defineConfig({
  root: rootDir,
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 46001,
    fs: { strict: false },
  },
  worker: { format: 'es' },
  plugins: [cloudflare({ configPath: wranglerConfigPath }), react()],
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
  build: {
    sourcemap: true,
    rollupOptions: { output: { sourcemapIgnoreList: false } },
  },
})
