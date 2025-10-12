import process from 'node:process'

import { cloudflare } from '@cloudflare/vite-plugin'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const defaultPort = 60_002

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : defaultPort,
    fs: { strict: false },
  },
  worker: { format: 'es' },
  plugins: [cloudflare(), react(), livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
})
