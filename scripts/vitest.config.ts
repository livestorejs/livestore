import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@local/scripts',
    // Without this, `vitest run --config scripts/vitest.config.ts` from the workspace root
    // resolves `include` against the root and finds nothing.
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      WORKSPACE_ROOT: path.resolve(import.meta.dirname, '..'),
    },
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
