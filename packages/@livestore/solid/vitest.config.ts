import { defineConfig } from 'vitest/config'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin({ ssr: false })],
  test: {
    // Use node environment with DOM globals for Solid tests
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // Setup DOM globals in Node environment
    globals: true,
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