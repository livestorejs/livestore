import type { PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
  webServer: {
    command: 'pnpm run build && pnpm start',
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    headless: true,
    baseURL: 'http://localhost:3000',
  },
}

export default config
