// @ts-check
import path from 'node:path'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from '@tanstack/start/config'
import { visualizer } from 'rollup-plugin-visualizer'

const __dirname = import.meta.dirname

// Needed for OPFS Sqlite to work
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
const credentiallessHeaders = {
  // https://developer.chrome.com/blog/coep-credentialless-origin-trial/
  // 'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Service-Worker-Allowed': '/',
}

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
      headers: credentiallessHeaders,
    },
    // // @ts-expect-error
    // server: { fs: { strict: false } },
    // preview: {
    //   headers: credentiallessHeaders,
    // },
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
      // NOTE vinxi causes the devtools to be served on: http://localhost:3000/_build/_livestore
      livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
      // Needed for OPFS Sqlite to work
      {
        name: 'configure-response-headers',
        configureServer: (server) => {
          server.middlewares.use((_req, res, next) => {
            Object.entries(credentiallessHeaders).forEach(([key, value]) => res.setHeader(key, value))
            next()
          })
        },
      },
      shouldAnalyze
        ? visualizer({ filename: path.resolve('./node_modules/.stats/index.html'), gzipSize: true, brotliSize: true })
        : undefined,
    ],
  },
})
