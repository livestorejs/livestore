import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@livestore/webmesh',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
