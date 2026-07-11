import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, lazyPlugins } from 'vite-plus'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

export default defineConfig({
  plugins: lazyPlugins(() => [
    cloudflare(),
    react(),
    tailwindcss(),
    livestoreDevtoolsPlugin({ schemaPath: ['./src/stores/mailbox/schema.ts', './src/stores/thread/schema.ts'] }),
  ]),
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
})
