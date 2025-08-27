import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm wrangler dev --port 8788',
      port: 8788,
      reuseExistingServer: true,
    },
    {
      command: 'pnpm vite dev --port 5175',
      port: 5175,
      reuseExistingServer: true,
    },
  ],
})
