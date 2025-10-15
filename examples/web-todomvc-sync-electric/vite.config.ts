// @ts-check
import path from 'node:path'
// import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = import.meta.dirname

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_001,
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
    exclude: [
      '@livestore/wa-sqlite',
      'lightningcss', // Avoid wasm branch looking for missing ../pkg (lightningcss#701)
    ],
  },
  plugins: [
    tanstackStart(),
    viteReact(),
    // TEMPORARY: Disabled due to Vite 7 compatibility issue
    // See: https://github.com/livestorejs/livestore/issues/746
    // Error: "invoke was called before connect" - plugin needs update for Vite 7 module runner API
    // livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
  ],
})
