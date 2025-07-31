import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./src/do-rpc/test-fixtures/vitest-setup.ts'],
    testTimeout: 60000,
  },
})
