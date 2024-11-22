/* eslint-disable unicorn/prefer-module */
// @ts-check
import path from 'node:path'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { vitePlugin as remix } from '@remix-run/dev'
import { RemixVitePWA } from '@vite-pwa/remix'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'

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

const { RemixVitePWAPlugin, RemixPWAPreset } = RemixVitePWA()

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_001,
    headers: credentiallessHeaders,
  },
  preview: {
    headers: credentiallessHeaders,
  },
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
    remix({
      appDirectory: 'src/app',

      ssr: false,
      // ssr: false,
      presets: [RemixPWAPreset()],
    }),
    livestoreDevtoolsPlugin({ schemaPath: './src/schema/index.ts' }),
    RemixVitePWAPlugin({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 4_000_000, // ~4MB
        // disableDevLogs: false,
        navigateFallback: '/',
        navigateFallbackAllowlist: [/.*/],
      },
      // devOptions: {
      //   enabled: true,
      //   navigateFallback: '/',
      //   navigateFallbackAllowlist: [/.*/],
      //   // suppressWarnings: true,
      // },
    }),
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
    // @ts-expect-error plugin types seem to be wrong
    shouldAnalyze
      ? visualizer({ filename: path.resolve('./node_modules/.stats/index.html'), gzipSize: true, brotliSize: true })
      : undefined,
  ],
})
