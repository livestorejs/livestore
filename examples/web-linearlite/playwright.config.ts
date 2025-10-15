import http from 'node:http'
import type { PlaywrightTestConfig } from '@playwright/test'

// Support passing in a full URL (e.g., for deployed apps or manually running dev server)
// If BASE_URL is provided, skip starting the web server
const baseURL = process.env.BASE_URL

// Use PORT from environment variable, or get a random free port
// Cache the port in an environment variable so it's consistent across config reloads
if (!process.env.PLAYWRIGHT_PORT && !process.env.PORT) {
  process.env.PLAYWRIGHT_PORT = String(await getFreePort())
}
const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : Number.parseInt(process.env.PLAYWRIGHT_PORT!, 10)

const config: PlaywrightTestConfig = {
  // Only start web server if BASE_URL is not provided
  webServer: baseURL
    ? undefined
    : {
        command: 'pnpm vite --force --host 127.0.0.1',
        port,
        reuseExistingServer: true,
        timeout: 180_000,
        env: {
          PORT: String(port),
        },
      },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: {
    headless: true,
    baseURL: baseURL ?? `http://localhost:${port}`,
  },
}

export default config

// Helper functions

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to get port'))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}
