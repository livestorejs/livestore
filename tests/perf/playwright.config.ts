import * as process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI, // Fail the build on CI if we accidentally left test.only in the source code
  workers: 1, // Run tests serially for more consistent performance measurements
  reportSlowTests: null,
  reporter: [process.env.CI ? ['dot'] : ['line'], ['./tests/measurements-reporter.ts']],
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm test-app',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
