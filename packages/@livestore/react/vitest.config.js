import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    // Needed for React hook tests
    environment: 'jsdom',
    snapshotSerializers: ['./src/__tests__/serializers/codePath.js'],
  },
  esbuild: {
    // TODO remove once `using` keyword supported OOTB with Vite https://github.com/vitejs/vite/issues/15464#issuecomment-1872485703
    target: 'es2020',
  },
  resolve: {
    alias: {
      '@livestore/wa-sqlite/dist/wa-sqlite.mjs': '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs',
    },
  },
})
