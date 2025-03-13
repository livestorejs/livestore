import { defineConfig, devices } from '@playwright/test'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI, // Fail the build on CI if we accidentally left test.only in the source code
  workers: 1, // Run tests serially for more accurate performance measurements
  use: { baseURL: 'http://localhost:5173' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm test-app',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
