import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
// import devtools from 'solid-devtools/vite';

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

export default defineConfig({
  plugins: [
    /* 
    Uncomment the following line to enable solid-devtools.
    For more info see https://github.com/thetarnav/solid-devtools/tree/main/packages/extension#readme
    */
    // devtools(),
    solidPlugin(),
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
  server: {
    port: 3000,
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
    // target: 'esnext',
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/wa-sqlite'],
  },
})
