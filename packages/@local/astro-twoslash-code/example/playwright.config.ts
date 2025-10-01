import { Effect } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import { defineConfig } from '@playwright/test'

// Playwright loads this config multiple times (runner + each worker). We stash the
// randomly chosen port in an env var so workers reuse the same dev server.
const envPort = process.env.ASTRO_TWOSLASH_E2E_PORT
const resolvedPort = envPort ? Number.parseInt(envPort, 10) : await getFreePort.pipe(Effect.runPromise)

if (!Number.isFinite(resolvedPort)) {
  throw new Error('Failed to resolve port for Astro Twoslash Playwright tests')
}

if (!envPort) {
  process.env.ASTRO_TWOSLASH_E2E_PORT = String(resolvedPort)
}

console.log(`Running test dev server on port ${resolvedPort}`)

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: `http://127.0.0.1:${resolvedPort}`,
  },
  webServer: {
    command: `pnpm astro dev --host 127.0.0.1 --port ${resolvedPort}`,
    url: `http://127.0.0.1:${resolvedPort}`,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
