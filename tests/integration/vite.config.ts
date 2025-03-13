// @ts-check

import { defineConfig } from 'vitest/config'

// Needed for OPFS Sqlite to work
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
const credentiallessHeaders = {
  // https://developer.chrome.com/blog/coep-credentialless-origin-trial/
  // 'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Service-Worker-Allowed': '/',
}

const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config
export default defineConfig({
  test: {
    setupFiles: ['./src/cf-sync-fixtures/vitest-sync-setup.ts'],
  },
  server: {
    port: process.env.DEV_SERVER_PORT ? Number(process.env.DEV_SERVER_PORT) : 61_001,
    headers: credentiallessHeaders,
    fs: { strict: false },
  },
  preview: {
    headers: credentiallessHeaders,
  },
  build: {
    //   sourcemap: true,
    //   minify: false,
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  optimizeDeps: {
    // TODO remove @livestore/wa-sqlite once fixed https://github.com/vitejs/vite/issues/8427
    // TODO figure out why `fsevents` is needed. Otherwise seems to throw error when starting Vite
    // Error: `No loader is configured for ".node" files`
    exclude: ['@livestore/wa-sqlite', 'fsevents'],
  },
  plugins: [
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
  ],
})
