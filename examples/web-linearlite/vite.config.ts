// @ts-check

import process from 'node:process'
import { cloudflare } from '@cloudflare/vite-plugin'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_000,
    fs: { strict: false },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/wa-sqlite'],
  },
  plugins: [
    // https://tanstack.com/start/latest/docs/framework/react/guide/hosting#cloudflare-workers--official-partner
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    react(),
    tailwindcss(),
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema/index.ts' }),
    svgr({
      svgrOptions: {
        svgo: true,
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        svgoConfig: {
          plugins: ['preset-default', 'removeTitle', 'removeDesc', 'removeDoctype', 'cleanupIds'],
        },
      },
    }),
  ],
})
