import path from 'node:path'

import { defineConfig } from 'vite-plus'

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
