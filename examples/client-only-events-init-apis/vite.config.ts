import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 60_006,
    fs: { strict: false },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    livestoreDevtoolsPlugin({ schemaPath: './src/schema.ts' }),
  ],
})
