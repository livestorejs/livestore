// @ts-check
import path from 'node:path'

import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: 60_002,
    hmr: process.env.DISABLE_HMR === undefined ? true : false,
    headers: credentiallessHeaders,
    fs: {
      // NOTE currently needed for embedding the `LiveStore` monorepo in another monorepo (e.g. under `/other-monorepo/submodules/livestore`)
      // Feel free to remove this if you're just copying this example
      allow: ['../../../..'],
    },
  },
  preview: {
    headers: credentiallessHeaders,
  },
  build: {
    sourcemap: true,
  },
  esbuild: {
    target: 'esnext',
  },
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/livestore', 'sqlite-esm'],
    include: ['react', 'react-dom'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      workbox: {
        maximumFileSizeToCacheInBytes: 4_000_000, // ~4MB
        globPatterns: ['**/*.{js,html,wasm,css,ico,db,lz4,blob}'],
      },
    }),
    // Needed for OPFS Sqlite to work
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          next()
        })
      },
    },
    // @ts-expect-error plugin types seem to be wrong
    shouldAnalyze
      ? visualizer({ filename: path.resolve('./tmp/stats/index.html'), gzipSize: true, brotliSize: true })
      : undefined,
  ],
})
