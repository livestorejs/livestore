// @ts-check
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_010,
    fs: { strict: false },
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  plugins: [react(), livestoreDevtoolsPlugin({ schemaPath: ['src/store/workspace/schema.ts', 'src/store/issue/schema.ts'] })],
})
