import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./fixtures/vitest-sync-setup.ts'],
  },
})
