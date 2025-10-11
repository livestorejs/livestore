import type { PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
  webServer: {
    command: 'PORT=5600 pnpm dev -- --host 127.0.0.1 --port 5600',
    port: 5600,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: {
    headless: true,
    baseURL: 'http://localhost:5600',
  },
}

export default config
