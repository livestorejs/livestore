import process from 'node:process'

import { cloudflare } from '@cloudflare/vite-plugin'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_004,
    fs: { strict: false },
  },
  worker: { format: 'es' },
  plugins: [cloudflare(), livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
})
