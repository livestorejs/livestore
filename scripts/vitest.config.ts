import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      WORKSPACE_ROOT: path.resolve(import.meta.dirname, '..'),
    },
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
