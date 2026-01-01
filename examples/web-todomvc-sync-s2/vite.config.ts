import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import devtoolsJson from 'vite-plugin-devtools-json'

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_003,
    fs: {
      strict: false,
    },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: [
      '@livestore/wa-sqlite',
      'lightningcss', // Avoid wasm branch looking for missing ../pkg (https://github.com/parcel-bundler/lightningcss/issues/701)
      'fsevents', // Native module, should not be optimized
    ],
  },
  plugins: [
    tanstackStart(),
    react(),
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
    devtoolsJson(), // Needed for https://github.com/TanStack/router/issues/2459#issuecomment-2969318833
  ],
})
