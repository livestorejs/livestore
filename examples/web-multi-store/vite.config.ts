// @ts-check
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'

const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_010,
    fs: { strict: false },
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  plugins: [
    tsConfigPaths(),
    tanstackStart({
      spa: { enabled: true },
    }),
    viteReact(),
    livestoreDevtoolsPlugin({ schemaPath: ['./src/stores/workspace/schema.ts', './src/stores/issue/schema.ts'] }),
  ],
})
