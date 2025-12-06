import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// Required for use of performance.measureUserAgentSpecificMemory()
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  root: rootDir,
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 46001,
    fs: { strict: false },
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  plugins: [react(), livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
  build: {
    sourcemap: true,
    rollupOptions: { output: { sourcemapIgnoreList: false } },
  },
})
