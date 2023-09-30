// @ts-check
import path from 'node:path'

import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'

// Needed for "web" mode to to allow IDB persistence.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
const credentiallessHeaders = {
  // https://developer.chrome.com/blog/coep-credentialless-origin-trial/
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Service-Worker-Allowed': '/',
}

const shouldAnalyze = process.env.VITE_ANALYZE !== undefined

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 8082,
    hmr: process.env.DISABLE_HMR === undefined ? true : false,
    // https,
    headers: credentiallessHeaders,
  },
  preview: {
    headers: credentiallessHeaders,
  },
  build: {
    sourcemap: true,
  },
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/livestore', 'sqlite-esm'],
    include: ['react', 'react-dom'],
  },
  plugins: [
    react(),
    // Needed to allow IDB persistence.
    // https://github.com/jlongster/absurd-sql#requirements
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
    shouldAnalyze
      ? visualizer({ filename: path.resolve('./tmp/stats/index.html'), gzipSize: true, brotliSize: true })
      : undefined,
  ],
})
