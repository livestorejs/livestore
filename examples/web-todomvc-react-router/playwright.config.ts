import type { PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
  webServer: {
    command: 'pnpm run build && pnpm run preview -- --host 0.0.0.0 --port 4173',
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
  },
}

export default config
