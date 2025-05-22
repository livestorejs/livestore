import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: { output: { sourcemapIgnoreList: false } },
  },
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'], // Needed until https://github.com/vitejs/vite/issues/8427 is resolved
  },
})
