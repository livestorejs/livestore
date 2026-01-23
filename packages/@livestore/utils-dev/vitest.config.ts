import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@livestore/utils-dev',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
})
