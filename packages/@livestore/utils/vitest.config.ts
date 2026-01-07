import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@livestore/utils',
    include: ['src/**/*.test.ts'],
  },
})
