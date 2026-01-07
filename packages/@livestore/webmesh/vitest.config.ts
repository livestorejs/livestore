import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@livestore/webmesh',
    include: ['src/**/*.test.ts'],
  },
})
