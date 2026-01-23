import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@livestore/sync-s2',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
})
