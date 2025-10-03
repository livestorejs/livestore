import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from '@livestore/utils/effect'
import { getFreePort } from '@livestore/utils/node'
import { defineConfig } from '@playwright/test'

const docsRoot = dirname(fileURLToPath(import.meta.url))

const envPort = process.env.LIVESTORE_DOCS_E2E_PORT
const resolvedPort = envPort ? Number.parseInt(envPort, 10) : await getFreePort.pipe(Effect.runPromise)

if (!Number.isFinite(resolvedPort)) {
  throw new Error('Failed to resolve port for docs Playwright tests')
}

if (!envPort) {
  process.env.LIVESTORE_DOCS_E2E_PORT = String(resolvedPort)
}

console.log(`Docs Playwright dev server port: ${resolvedPort}`)

export default defineConfig({
  testDir: './tests/playwright',
  use: {
    baseURL: `http://127.0.0.1:${resolvedPort}`,
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${resolvedPort}`,
    url: `http://127.0.0.1:${resolvedPort}`,
    cwd: docsRoot,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
