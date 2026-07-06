import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@livestore/sqlite-wasm',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
