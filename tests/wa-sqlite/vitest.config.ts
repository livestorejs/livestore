import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30_000, // Increased timeout for large database operations
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/setup/database-setup.ts'],
  },
})
