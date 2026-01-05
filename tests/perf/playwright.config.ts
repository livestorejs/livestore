import * as process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * Ensure Playwright tests are run via the mono CLI (or VS Code extension) to guarantee proper environment setup.
 */
const isVSCode = process.env.VSCODE_PID !== undefined
if (process.env.FORCE_PLAYWRIGHT_VIA_CLI !== '1' && !isVSCode) {
  throw new Error(`Playwright tests must be run via 'mono test perf'.`)
}

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
    command: 'bun run test-app',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
