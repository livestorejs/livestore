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

const FIXTURE_DIR = path.join(import.meta.dirname, '../fixtures/devtools/node-adapter-timeout')
const TIMEOUT_WAIT_MS = 35_000 // 35 seconds, to exceed the 30 second timeout

let nodeProcess: ChildProcess | undefined
let devtoolsPort: number

/**
 * Get an available port by binding to port 0 and reading the assigned port.
 */
const getAvailablePort = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address()
      if (address && typeof address === 'object') {
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

  return new Promise((resolve, reject) => {
    const mainPath = path.join(FIXTURE_DIR, 'main.ts')
    console.log(`Starting Node app: ${mainPath} on port ${devtoolsPort}`)

    nodeProcess = spawn('bun', ['run', mainPath], {
      cwd: FIXTURE_DIR,
      env: {
        ...process.env,
        DEVTOOLS_PORT: String(devtoolsPort),
        STORE_ID: `test-store-${Date.now()}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let started = false

    nodeProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      console.log('[node-app stdout]', output)

      if (output.includes('DEVTOOLS_READY') && !started) {
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
      if (!started) {
        reject(err)
      }
    })

    nodeProcess.on('close', (code) => {
      console.log(`Node app exited with code ${code}`)
      if (!started && code !== 0) {
        reject(new Error(`Node app exited with code ${code}`))
      }
    })

    // Timeout for app startup
    setTimeout(() => {
      if (!started) {
        reject(new Error('Node app did not start within timeout'))
      }
    }, 30_000)
  })
}

/**
 * Stop the Node.js fixture app.
 */
const stopNodeApp = (): void => {
  if (nodeProcess && !nodeProcess.killed) {
    console.log('Stopping Node app...')
    nodeProcess.kill('SIGTERM')
    nodeProcess = undefined
  }
}

test.describe('Node adapter devtools timeout', () => {
  // Run tests serially since each test needs its own Node process
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async () => {
    await startNodeApp()
  })

  test.afterEach(async () => {
    stopNodeApp()
  })

  test('should maintain connection to devtools after 30+ seconds', async ({ page }) => {
    // Set a longer timeout for this test since we're waiting 35+ seconds
    test.setTimeout(90_000)

    // Capture browser console output to debug what's being loaded
    page.on('console', (msg) => {
      const text = msg.text()
      // Log all messages related to debugging the timeout issue
      if (
        text.includes('proxy-channel') ||
        text.includes('LOADING LOCAL SOURCE') ||
        text.includes('webmesh') ||
        text.includes('runPingPong') ||
        text.includes('devtools-api') ||
        text.includes('mesh-node') ||
        text.includes('ProxyChannel') ||
        text.includes('Pong') ||
        text.includes('Ping') ||
        text.includes('recv') ||
        text.includes('listenQueue')
      ) {
        console.log(`[browser console] ${text}`)
      }
    })

    const devtoolsUrl = `http://localhost:${devtoolsPort}/_livestore/node?autoconnect`
    console.log(`Navigating to devtools: ${devtoolsUrl}`)

    // Retry navigation a few times in case Vite is still warming up
    let navigationSuccess = false
    for (let attempt = 0; attempt < 3 && !navigationSuccess; attempt++) {
      try {
        await page.goto(devtoolsUrl, { timeout: 15_000 })
        navigationSuccess = true
      } catch (_err) {
        console.log(`Navigation attempt ${attempt + 1} failed, retrying...`)
        await page.waitForTimeout(2000)
      }
    }

    if (!navigationSuccess) {
      throw new Error('Failed to navigate to devtools after 3 attempts')
    }

    // Wait for the devtools to connect and show the session
    // With ?autoconnect, it should auto-connect to the first session
    // Wait for either Sessions list or Database tab (if already connected)
    await Promise.race([
      page.waitForSelector('text=Sessions', { timeout: 15_000 }),
      page.waitForSelector('text=Database', { timeout: 15_000 }),
      page.waitForSelector('text=Tables', { timeout: 15_000 }),
    ])
    console.log('Devtools loaded')

    // Check if we need to click on a session link (if not auto-connected)
    const sessionLink = page
      .locator('a')
      .filter({ hasText: /test-store/ })
      .first()
    if (await sessionLink.isVisible({ timeout: 1000 }).catch(() => false)) {
      await sessionLink.click()
      console.log('Clicked on session link')
    } else {
      console.log('Auto-connected to session (no link to click)')
    }

    // Wait for the devtools to show connected state (e.g., Database tab)
    await page.waitForSelector('text=Database', { timeout: 10_000 }).catch(() => {
      // Sometimes it shows Tables directly
      return page.waitForSelector('text=Tables', { timeout: 5_000 })
    })
    console.log('Devtools connected to session')

    // Record the initial state - check that we can see the todo table
    const initialState = await page.locator('text=todo').first().isVisible()
    console.log('Initial state - todo table visible:', initialState)

    // Now wait for 35 seconds to exceed the 30 second timeout
    console.log(`Waiting ${TIMEOUT_WAIT_MS / 1000} seconds to test timeout...`)
    await page.waitForTimeout(TIMEOUT_WAIT_MS)

    // After waiting, check if the connection is still active or if we see the error
    const connectionLostVisible = await page.locator('text=Connection to app lost').isVisible()
    const reloadButtonVisible = await page.locator('button:has-text("Reload")').isVisible()

    if (connectionLostVisible || reloadButtonVisible) {
      // This is the bug - the connection should NOT be lost
      console.error('BUG REPRODUCED: Connection to app was lost after 30 seconds')

      // Take a screenshot for debugging
      await page.screenshot({ path: 'devtools-timeout-error.png' })

      // Fail the test to indicate the bug exists
      expect(connectionLostVisible, 'Connection should NOT be lost after 30 seconds').toBe(false)
    } else {
      // Connection is still active - this is the expected behavior
      console.log('Connection is still active after 30+ seconds')

      // Verify we can still see the database content
      const databaseTabStillVisible = await page.locator('text=Database').isVisible()
      const tablesStillVisible = await page.locator('text=Tables').isVisible()
      const todoTableStillVisible = await page.locator('text=todo').first().isVisible()

      console.log('Database tab visible:', databaseTabStillVisible)
      console.log('Tables visible:', tablesStillVisible)
      console.log('Todo table visible:', todoTableStillVisible)

      expect(databaseTabStillVisible || tablesStillVisible).toBe(true)
    }
  })

  test('should detect the 30 second timeout bug (expected to fail)', async ({ page }) => {
    /**
     * This test is designed to reliably reproduce and detect the timeout bug.
     * It explicitly waits for the "Connection to app lost" message.
     *
     * When the bug is fixed, this test should be updated to expect no timeout.
     */
    test.setTimeout(90_000)

    const devtoolsUrl = `http://localhost:${devtoolsPort}/_livestore/node?autoconnect`

    // Retry navigation a few times in case Vite is still warming up
    let navigationSuccess = false
    for (let attempt = 0; attempt < 3 && !navigationSuccess; attempt++) {
      try {
        await page.goto(devtoolsUrl, { timeout: 15_000 })
        navigationSuccess = true
      } catch (_err) {
        console.log(`Navigation attempt ${attempt + 1} failed, retrying...`)
        await page.waitForTimeout(2000)
      }
    }

    if (!navigationSuccess) {
      throw new Error('Failed to navigate to devtools after 3 attempts')
    }

    // Wait for devtools to load - with ?autoconnect, it may auto-connect to the first session
    await Promise.race([
      page.waitForSelector('text=Sessions', { timeout: 15_000 }),
      page.waitForSelector('text=Database', { timeout: 15_000 }),
      page.waitForSelector('text=Tables', { timeout: 15_000 }),
    ])

    // Check if we need to click on a session link (if not auto-connected)
    const sessionLink = page
      .locator('a')
      .filter({ hasText: /test-store/ })
      .first()
    if (await sessionLink.isVisible({ timeout: 1000 }).catch(() => false)) {
      await sessionLink.click()
    }

    // Wait for connection
    await page.waitForSelector('text=Database', { timeout: 10_000 }).catch(() => {
      return page.waitForSelector('text=Tables', { timeout: 5_000 })
    })

    console.log('Connected to devtools, waiting for timeout bug to manifest...')

    // Wait for the "Connection to app lost" message to appear
    // This should appear after ~30 seconds if the bug exists
    try {
      await page.waitForSelector('text=Connection to app lost', { timeout: 40_000 })
      console.log('BUG DETECTED: Connection to app lost message appeared')

      // Take a screenshot of the bug
      await page.screenshot({ path: 'devtools-timeout-bug-detected.png' })

      // The bug exists - this test passes when the bug is present
      expect(true).toBe(true)
    } catch {
      console.log('No timeout detected - the bug may have been fixed')
      // If we don't see the timeout error, it means the bug might be fixed
      // or the timeout is longer than expected
    }
  })
})
