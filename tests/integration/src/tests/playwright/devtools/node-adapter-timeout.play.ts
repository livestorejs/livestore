/**
 * Playwright test to reproduce the devtools timeout issue with Node adapter.
 *
 * Bug report: https://github.com/bohdanbirdie/livestore-devtools-issue-repro
 *
 * The issue: After ~30 seconds, the devtools lose connection to the app and show
 * "Connection to app lost" error with a red background.
 *
 * This test:
 * 1. Starts a Node.js app with LiveStore devtools enabled
 * 2. Opens the devtools in a browser
 * 3. Waits for 35 seconds (to exceed the 30 second timeout)
 * 4. Verifies that the devtools still show connected (or catches the timeout error)
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'

import { expect, test } from '@playwright/test'

import { schema } from '../fixtures/devtools/node-adapter-timeout/schema.ts'
import { checkConnectionRemainsActive } from './shared.ts'

const FIXTURE_DIR = path.join(import.meta.dirname, '../fixtures/devtools/node-adapter-timeout')
const TIMEOUT_WAIT_MS = 35_000 // 35 seconds, to exceed the 30 second timeout
const DEVTOOLS_READY_TIMEOUT_MS = 120_000

let nodeProcess: ChildProcess | undefined
let devtoolsPort: number
let storeId: string

/**
 * Get an available port by binding to port 0 and reading the assigned port.
 */
const getAvailablePort = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address()
      if (address !== null && typeof address === 'object') {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('Failed to get port')))
      }
    })
    server.on('error', reject)
  })
}

/**
 * Start the Node.js fixture app with devtools enabled.
 */
const startNodeApp = async (): Promise<void> => {
  devtoolsPort = await getAvailablePort()
  storeId = `test-store-${Date.now()}`

  return new Promise((resolve, reject) => {
    const mainPath = path.join(FIXTURE_DIR, 'main.ts')
    console.log(`Starting Node app: ${mainPath} on port ${devtoolsPort}`)

    nodeProcess = spawn('bun', ['run', mainPath], {
      cwd: FIXTURE_DIR,
      env: {
        ...process.env,
        DEVTOOLS_PORT: String(devtoolsPort),
        STORE_ID: storeId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let started = false

    nodeProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      console.log('[node-app stdout]', output)

      if (output.includes('DEVTOOLS_READY') === true && started === false) {
        started = true
        // Give the Vite devtools server more time to fully start
        // Vite needs to warm up before it can serve requests
        setTimeout(resolve, 3000)
      }
    })

    nodeProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[node-app stderr]', data.toString())
    })

    nodeProcess.on('error', (err) => {
      if (started === false) {
        reject(err)
      }
    })

    nodeProcess.on('close', (code) => {
      console.log(`Node app exited with code ${code}`)
      if (started === false && code !== 0) {
        reject(new Error(`Node app exited with code ${code}`))
      }
    })

    // Timeout for app startup
    setTimeout(() => {
      if (started === false) {
        reject(new Error('Node app did not start within timeout'))
      }
    }, 30_000)
  })
}

/**
 * Stop the Node.js fixture app.
 */
const stopNodeApp = (): void => {
  if (nodeProcess !== undefined && nodeProcess.killed === false) {
    console.log('Stopping Node app...')
    nodeProcess.kill('SIGTERM')
    nodeProcess = undefined
  }
}

test.describe('Node adapter devtools timeout', () => {
  // Run tests serially since each test needs its own Node process
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  test.beforeEach(async () => {
    await startNodeApp()
  })

  test.afterEach(async () => {
    stopNodeApp()
  })

  test('should maintain connection to devtools after 30+ seconds', async ({ page }) => {
    // Capture browser console output to debug what's being loaded
    page.on('console', (msg) => {
      const text = msg.text()
      // Log all messages related to debugging the timeout issue
      if (
        text.includes('proxy-channel') === true ||
        text.includes('LOADING LOCAL SOURCE') === true ||
        text.includes('webmesh') === true ||
        text.includes('runPingPong') === true ||
        text.includes('devtools-api') === true ||
        text.includes('mesh-node') === true ||
        text.includes('devtools heartbeat') === true ||
        text.includes('ProxyChannel') === true ||
        text.includes('Pong') === true ||
        text.includes('Ping') === true ||
        text.includes('message=status') === true ||
        text.includes('recv') === true ||
        text.includes('listenQueue') === true ||
        msg.type() === 'error' ||
        msg.type() === 'warning'
      ) {
        console.log(`[browser console:${msg.type()}] ${text}`)
      }
    })
    page.on('pageerror', (error) => console.log(`[browser pageerror] ${error.message}`))
    page.on('requestfailed', (request) => {
      console.log(`[browser requestfailed] ${request.url()} ${request.failure()?.errorText ?? 'unknown error'}`)
    })
    page.on('response', (response) => {
      if (response.status() >= 400) {
        console.log(`[browser response] ${response.status()} ${response.url()}`)
      }
    })

    const devtoolsUrl = `http://localhost:${devtoolsPort}/_livestore/node/${storeId}/test-client/static/${schema.devtools.alias}`
    console.log(`Navigating to devtools: ${devtoolsUrl}`)

    // Retry navigation a few times in case Vite is still warming up
    let navigationSuccess = false
    for (let attempt = 0; attempt < 3 && navigationSuccess === false; attempt++) {
      try {
        await page.goto(devtoolsUrl, { timeout: 15_000 })
        navigationSuccess = true
      } catch (_err) {
        console.log(`Navigation attempt ${attempt + 1} failed, retrying...`)
        await page.waitForTimeout(2000)
      }
    }

    if (navigationSuccess === false) {
      throw new Error('Failed to navigate to devtools after 3 attempts')
    }

    await expect(page).toHaveURL(/\/_livestore\/node\/test-store-/, { timeout: 10_000 })
    try {
      await page
        .getByRole('tab', { name: 'Database' })
        .describe('node-devtools:Database')
        .waitFor({ state: 'attached', timeout: DEVTOOLS_READY_TIMEOUT_MS })
    } catch (error) {
      console.log(`[devtools diagnostics] url=${page.url()}`)
      console.log(`[devtools diagnostics] title=${await page.title().catch(() => '<unavailable>')}`)
      const bodyText = await page
        .locator('body')
        .innerText({ timeout: 1000 })
        .catch(() => '<unavailable>')
      console.log(`[devtools diagnostics] body=${bodyText.slice(0, 2000)}`)
      throw error
    }
    console.log('Devtools connected to session')

    console.log(`Watching connection for ${TIMEOUT_WAIT_MS / 1000} seconds...`)
    await checkConnectionRemainsActive({ devtools: page, label: 'node-devtools', durationMs: TIMEOUT_WAIT_MS })

    await expect(page).toHaveURL(/\/_livestore\/node\/test-store-/)
  })
})
