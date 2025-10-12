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
  worker: { format: 'es' },
  plugins: [cloudflare(), react(), tailwindcss(), livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
})
