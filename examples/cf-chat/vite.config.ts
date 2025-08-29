import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), livestoreDevtoolsPlugin({ schemaPath: 'src/livestore/schema.ts' })],
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
})
