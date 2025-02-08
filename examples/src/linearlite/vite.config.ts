// @ts-check

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import process from 'node:process'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import svgr from 'vite-plugin-svgr'

const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 60000,
    fs: {
      // NOTE currently needed for embedding the `LiveStore` monorepo in another monorepo (e.g. under `/other-monorepo/submodules/livestore`)
      allow: process.env.MONOREPO_ROOT ? [process.env.MONOREPO_ROOT] : [process.env.WORKSPACE_ROOT!],
    },
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/wa-sqlite'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // NOTE This is only in here for convenience while developing the LiveStore devtools (feel free to remove it in your app)
  // resolve: {
  //   alias: {
  //     '@livestore/devtools-react': path.resolve('../../../../packages/@livestore/devtools-react/src'),
  //     // '@livestore/devtools-react': path.resolve('../../../../packages/@livestore/devtools-react/tmp-build/dist'),
  //   },
  // },
  plugins: [
    react(),
    livestoreDevtoolsPlugin({ schemaPath: './src/lib/livestore/schema/index.ts' }),
    VitePWA({
      registerType: 'prompt',
      workbox: {
        maximumFileSizeToCacheInBytes: 4_000_000, // ~4MB
        globPatterns: ['**/*.{js,html,wasm,css,ico,db,lz4,blob}'],
      },
    }),
    svgr({
      svgrOptions: {
        svgo: true,
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        svgoConfig: {
          plugins: ['preset-default', 'removeTitle', 'removeDesc', 'removeDoctype', 'cleanupIds'],
        },
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
  ],
})
