import process from 'node:process'

import { cloudflare } from '@cloudflare/vite-plugin'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    fs: { strict: false },
  },
  build: {
    target: 'esnext',
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/wa-sqlite'],
  },
  plugins: [
    cloudflare(),
    svelte(),
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
  ],
})
