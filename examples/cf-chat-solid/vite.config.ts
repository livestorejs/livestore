import process from 'node:process'

import { cloudflare } from '@cloudflare/vite-plugin'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_003,
    fs: { strict: false },
  },
  build: {
    target: 'esnext',
  },
  worker: { format: 'es' },
  plugins: [
    cloudflare(),
    solidPlugin({ exclude: ['@livestore/**devtools**', 'react-dom/**'] }),
    tailwindcss(),
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
  ],
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
})
