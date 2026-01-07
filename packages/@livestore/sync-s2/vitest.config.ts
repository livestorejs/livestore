import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@livestore/sync-s2',
    include: ['src/**/*.test.ts'],
  },
})
