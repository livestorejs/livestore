import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@local/tests-package-common',
    include: ['src/**/*.test.ts'],
  },
})
