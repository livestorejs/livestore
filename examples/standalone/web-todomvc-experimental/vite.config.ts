// @ts-check
import path from 'node:path'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'

const shouldAnalyze = process.env.VITE_ANALYZE !== undefined
const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: 60_001,
  },
  build: {
    //   sourcemap: true,
    //   minify: false,
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/wa-sqlite'],
  },
  plugins: [
    react(),
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
    // @ts-expect-error plugin types seem to be wrong
    shouldAnalyze
      ? visualizer({ filename: path.resolve('./node_modules/.stats/index.html'), gzipSize: true, brotliSize: true })
      : undefined,
  ],
})
