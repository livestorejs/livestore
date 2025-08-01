// @ts-check
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from 'vite'

const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_004,
    fs: { strict: false },
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  plugins: [livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
})
