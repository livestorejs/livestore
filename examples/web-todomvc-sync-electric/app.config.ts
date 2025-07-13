// @ts-check
import path from 'node:path'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from '@tanstack/react-start/config'
import { visualizer } from 'rollup-plugin-visualizer'

const __dirname = import.meta.dirname

const shouldAnalyze = process.env.VITE_ANALYZE !== undefined
const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config
export default defineConfig({
  tsr: {
    appDirectory: './src',
  },
  vite: {
    // @ts-expect-error TODO
    server: {
      port: process.env.PORT ? Number(process.env.PORT) : 60_001,
      fs: {
        strict: false,
      },
    },
    // // @ts-expect-error
    // server: { fs: { strict: false } },
    worker: isProdBuild ? { format: 'es' } : undefined,
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
      livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
      shouldAnalyze
        ? visualizer({ filename: path.resolve('./node_modules/.stats/index.html'), gzipSize: true, brotliSize: true })
        : undefined,
    ],
  },
})
