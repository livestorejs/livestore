import { Effect } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import { defineConfig } from '@playwright/test'

const freePort = await getFreePort.pipe(Effect.runPromise)

console.log(`Running test dev server on port ${freePort}`)

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: `http://127.0.0.1:${freePort}`,
  },
  webServer: {
    command: `pnpm astro dev --host 127.0.0.1 --port ${freePort}`,
    url: `http://127.0.0.1:${freePort}`,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
