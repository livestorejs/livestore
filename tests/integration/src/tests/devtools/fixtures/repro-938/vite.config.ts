import path from 'node:path'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  server: {
    host: '127.0.0.1',
    fs: { strict: false },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
  plugins: [
    livestoreDevtoolsPlugin({
      schemaPath: './schema.ts',
    }),
  ],
})
