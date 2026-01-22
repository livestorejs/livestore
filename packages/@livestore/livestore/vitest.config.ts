import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    name: '@livestore/livestore',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@livestore/wa-sqlite/dist/wa-sqlite.mjs': '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs',
    },
  },
})
