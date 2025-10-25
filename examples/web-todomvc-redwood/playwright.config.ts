import type { PlaywrightTestConfig } from '@playwright/test'

/**
 * Default config runs build+preview scenario to test production build.
 * Use playwright.dev.config.ts for dev server testing.
 */
const config: PlaywrightTestConfig = {
  webServer: {
    command: 'pnpm run build && pnpm run preview -- --host 0.0.0.0 --port 4173',
    port: 4173,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
  },
}

export default config
