import process from 'node:process'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: rootDir,
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 46001,
    fs: { strict: false },
  },
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
  build: {
    sourcemap: true,
    rollupOptions: { output: { sourcemapIgnoreList: false } },
  },
})
