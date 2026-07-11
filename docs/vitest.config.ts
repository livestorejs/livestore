import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
