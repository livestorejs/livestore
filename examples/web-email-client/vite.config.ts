import { cloudflare } from '@cloudflare/vite-plugin'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    cloudflare(),
    react(),
    tailwindcss(),
    livestoreDevtoolsPlugin({ schemaPath: ['./src/stores/mailbox/schema.ts', './src/stores/thread/schema.ts'] }),
  ],
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
})
