import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    name: '@livestore/livestore',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@livestore/wa-sqlite/dist/wa-sqlite.mjs': '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs',
    },
  },
})
