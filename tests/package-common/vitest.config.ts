import { defineProject } from 'vite-plus'

export default defineProject({
  test: {
    name: '@local/tests-package-common',
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
