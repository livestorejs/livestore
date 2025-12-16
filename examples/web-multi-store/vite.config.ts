// @ts-check
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import devtoolsJson from 'vite-plugin-devtools-json'
import tsConfigPaths from 'vite-tsconfig-paths'

const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_010,
    fs: { strict: false },
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: [
      '@livestore/wa-sqlite',
      'lightningcss', // Avoid wasm branch looking for missing ../pkg (https://github.com/parcel-bundler/lightningcss/issues/701)
      'fsevents', // Native module, should not be optimized
    ],
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
    livestoreDevtoolsPlugin({ schemaPath: ['./src/stores/workspace/schema.ts', './src/stores/issue/schema.ts'] }),
    devtoolsJson(), // Needed for https://github.com/TanStack/router/issues/2459#issuecomment-2969318833
  ],
})
