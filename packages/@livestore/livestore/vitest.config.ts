import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@livestore/livestore',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
  resolve: {
    alias: {
      '@livestore/wa-sqlite/dist/wa-sqlite.mjs': '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs',
    },
  },
})
