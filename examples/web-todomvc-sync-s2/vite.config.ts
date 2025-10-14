import path from 'node:path'
// import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_003,
    fs: {
      strict: false,
    },
  },
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/wa-sqlite'],
  },
  plugins: [
    tanstackStart(),
    react(),
    // TEMPORARY: Disabled due to Vite 7 compatibility issue
    // See: https://github.com/livestorejs/livestore/issues/746
    // Error: "invoke was called before connect" - plugin needs update for Vite 7 module runner API
    // livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
  ],
})
