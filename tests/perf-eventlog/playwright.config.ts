import * as process from 'node:process'

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  workers: 1,
  reportSlowTests: null,
  reporter: [process.env.CI ? ['dot'] : ['line']],
  use: { baseURL: 'http://localhost:46001' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:46001',
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @local/tests-perf-streaming-loopback dev',
    url: 'http://localhost:46001',
    reuseExistingServer: !process.env.CI,
  },
})
