import { defineProject } from 'vite-plus'

export default defineProject({
  test: {
    name: '@livestore/common',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
