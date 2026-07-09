import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import type { PlaywrightTestConfig } from '@playwright/test'
import { devices } from '@playwright/test'

const localEnvFile = path.resolve(import.meta.dirname, '.env.test.local')
if (fs.existsSync(localEnvFile) === true) {
  process.loadEnvFile(localEnvFile)
}
process.loadEnvFile(path.resolve(import.meta.dirname, '.env.test'))

const envTruish = (env: string | undefined) =>
  env !== undefined && env.toLowerCase() !== 'false' && env.toLowerCase() !== '0'

const devServerPort = Number.parseInt(process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT ?? '4444', 10)
const chromiumUse = {
  ...devices['Desktop Chrome'],
  deviceScaleFactor: 2,
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const config: PlaywrightTestConfig = {
  testDir: './src/tests/playwright',
  /* Maximum time one test can run for. */
  timeout: 1 * 60 * 1000, // 1 minute
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText();`
     */
    timeout: 5000,
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI !== undefined ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  // workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['html', { open: process.env.CI !== undefined ? 'never' : 'on' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */

  use: {
    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout: 0,
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://localhost:3000',

    ignoreHTTPSErrors: true,

    screenshot: 'on',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on',

    headless: envTruish(process.env.PLAYWRIGHT_HEADLESS),
  },

  projects: [
    {
      name: 'misc',
      testMatch: /misc-tests\.play\.ts/,
      outputDir: 'test-results/misc',
      use: chromiumUse,
    },
    {
      name: 'todomvc',
      testMatch: /todomvc\.play\.ts/,
      outputDir: 'test-results/todomvc',
      use: chromiumUse,
    },
    {
      name: 'devtools',
      testMatch: /devtools\/.*\.play\.ts/,
      outputDir: 'test-results/devtools',
      use: chromiumUse,
    },
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  // outputDir: 'test-results/',

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `./node_modules/.bin/vite --config src/tests/playwright/fixtures/vite.config.ts dev --port ${devServerPort}`,
    port: devServerPort,
    reuseExistingServer: !process.env.CI,
  },
}

export default config
