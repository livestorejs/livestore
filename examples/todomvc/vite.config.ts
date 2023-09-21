import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Needed for "web" mode to to allow IDB persistence.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
const credentiallessHeaders = {
  // https://developer.chrome.com/blog/coep-credentialless-origin-trial/
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Service-Worker-Allowed': '/',
}

// `DEV_SSL_KEY` is set up via `.infra/setup-certs.sh` script
// const https = { key: process.env.DEV_SSL_KEY, cert: process.env.DEV_SSL_CERT }

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
    exclude: [
      'sqlite-esm', // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    ],
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
  ],
})
