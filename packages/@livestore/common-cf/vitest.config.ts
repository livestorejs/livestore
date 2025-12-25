import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@livestore/common-cf',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
})
