// @ts-check

import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 60_000,
    fs: { strict: false },
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
  plugins: [
    react(),
    tailwindcss(),
    livestoreDevtoolsPlugin({ schemaPath: './src/lib/livestore/schema/index.ts' }),
    svgr({
      svgrOptions: {
        svgo: true,
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        svgoConfig: {
          plugins: ['preset-default', 'removeTitle', 'removeDesc', 'removeDoctype', 'cleanupIds'],
        },
      },
    }),
    // Running `wrangler dev` as part of `vite dev` for CF sync
    {
      name: 'wrangler-dev',
      apply: 'serve',
      configureServer: async (server) => {
        const wrangler = spawn('./node_modules/.bin/wrangler', ['dev', '--port', '8787'], {
          stdio: ['ignore', 'inherit', 'inherit'],
        })

        const shutdown = () => {
          if (wrangler.killed === false) {
            wrangler.kill()
          }
          process.exit(0)
        }

        server.httpServer?.on('close', shutdown)
        process.on('SIGTERM', shutdown)
        process.on('SIGINT', shutdown)

        wrangler.on('exit', (code) => console.error(`wrangler dev exited with code ${code}`))
      },
    },
  ],
})
