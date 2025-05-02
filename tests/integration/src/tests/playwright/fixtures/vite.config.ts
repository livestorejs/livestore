import { defineConfig } from 'vite'

// https://vitejs.dev/config
export default defineConfig({
  server: { fs: { strict: false } },
  root: import.meta.dirname,
  optimizeDeps: {
    // TODO remove @livestore/wa-sqlite once fixed https://github.com/vitejs/vite/issues/8427
    // TODO figure out why `fsevents` is needed. Otherwise seems to throw error when starting Vite
    // Error: `No loader is configured for ".node" files`
    exclude: ['@livestore/wa-sqlite', 'fsevents'],
  },
})
