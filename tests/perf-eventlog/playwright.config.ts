import fs from 'node:fs'
import path from 'node:path'
import * as process from 'node:process'

import { defineConfig, devices } from '@playwright/test'

const localEnvFile = path.resolve(import.meta.dirname, '.env.test.local')
if (fs.existsSync(localEnvFile) === true) {
  process.loadEnvFile(localEnvFile)
}
process.loadEnvFile(path.resolve(import.meta.dirname, '.env.test'))

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  workers: 1,
  reportSlowTests: null,
  reporter: [process.env.CI !== undefined ? ['dot'] : ['line']],
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
