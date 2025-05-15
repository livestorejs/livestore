import { spawn } from 'node:child_process'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 60_001,
    fs: { strict: false },
  },
  worker: { format: 'es' },
  plugins: [
    react(),
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
    // Running `wrangler dev` as part of `vite dev` needed for `@livestore/sync-cf`
    {
      name: 'wrangler-dev',
      configureServer: async (server) => {
        const wrangler = spawn('./node_modules/.bin/wrangler', ['dev', '--port', '8787'], {
          stdio: ['ignore', 'inherit', 'inherit'],
          shell: true,
        })

        server.httpServer?.on('close', () => wrangler.kill())

        wrangler.on('exit', (code) => console.error(`wrangler dev exited with code ${code}`))
      },
    },
  ],
})
