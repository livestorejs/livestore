import process from 'node:process'

import { cloudflare } from '@cloudflare/vite-plugin'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_002,
    fs: { strict: false },
  },
  build: {
    sourcemap: true,
    target: ['es2022'],
  },
  esbuild: {
    target: 'esnext',
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/wa-sqlite'],
  },
  plugins: [cloudflare(), react(), tailwindcss(), livestoreDevtoolsPlugin({ schemaPath: './src/schema.ts' })],
})
