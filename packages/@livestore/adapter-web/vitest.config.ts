import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@livestore/adapter-web',
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
