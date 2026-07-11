import { defineProject } from 'vite-plus'

export default defineProject({
  test: {
    root: import.meta.dirname,
    include: ['*.test.ts'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
