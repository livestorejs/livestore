import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
