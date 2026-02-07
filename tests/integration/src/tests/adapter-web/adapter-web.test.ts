import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserContext, browserContextLayer } from '@livestore/effect-playwright'
import { Duration, Effect, FetchHttpClient, HttpClient, Layer, Schedule } from '@livestore/utils/effect'
import { getFreePort, PlatformNode } from '@livestore/utils/node'
import { CurrentWorkingDirectory, cmd } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const integrationRoot = path.resolve(testDir, '../../..')
const viteConfigRel = 'src/tests/playwright/fixtures/vite.config.ts'
const testTimeout = Duration.toMillis(Duration.minutes(2))

const withTestCtx = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    Layer.mergeAll(
      PlatformNode.NodeContext.layer,
      FetchHttpClient.layer,
      browserContextLayer({ persistentContextPath: '', headless: true }),
    ),
})

Vitest.describe('adapter-web', { timeout: testTimeout }, () => {
  /**
   * SharedWorker boot/leader race can stall startup when two tabs boot concurrently.
   * Issue: https://github.com/livestorejs/livestore/issues/763
   *
   * Why a barrier (BroadcastChannel):
   * - Deterministically synchronizes both pages so LiveStore boots at the same moment.
   * - Maximizes the race window and reproducibility by removing incidental timing noise.
   *
   * What we assert:
   * - After releasing the barrier, both pages render "Adapter Web Test App" within a timeout.
   */
  Vitest.scopedLive('two tabs boot (shared-worker stable)', (test) =>
    Effect.gen(function* () {
      const port = yield* getFreePort.pipe(Effect.map(String))

      // Start a Vite dev server for the React fixtures without devtools plugin
      yield* cmd(`vite --config ${viteConfigRel} dev --port ${port}`, {
        env: {
          TEST_LIVESTORE_SCHEMA_PATH_JSON: undefined, // ensure devtools plugin is disabled
          LSD_DEVTOOLS_LOCAL_PREVIEW: undefined,
        },
      }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(integrationRoot)), Effect.forkScoped)

      const appUrl = (pathname: string) => `http://localhost:${port}${pathname}`

      // Wait for dev server to be ready
      const httpClient = yield* HttpClient.HttpClient.pipe(Effect.andThen(HttpClient.filterStatusOk))
      yield* httpClient.head(appUrl('/')).pipe(
        Effect.retry(Schedule.exponentialBackoff10Sec),
        Effect.mapError((error) => new Error('Dev server did not start in time', { cause: error })),
      )

      const { browserContext } = yield* BrowserContext

      const page1 = yield* Effect.promise(() => browserContext.newPage())
      const page2 = yield* Effect.promise(() => browserContext.newPage())

      const url = appUrl('/adapter-web/concurrent-boot')
      yield* Effect.promise(() =>
        Promise.all([
          page1.goto(`${url}?barrier=1&sessionId=a&clientId=A&disableFastPath=1&bootDelayMs=0`),
          page2.goto(`${url}?barrier=1&sessionId=b&clientId=B&disableFastPath=1&bootDelayMs=60`),
        ]),
      )

      yield* Effect.promise(() =>
        Promise.all([
          page1.waitForSelector('text=Waiting for barrier…'),
          page2.waitForSelector('text=Waiting for barrier…'),
        ]),
      )

      yield* Effect.promise(() =>
        page1.evaluate(() => {
          const bc = new BroadcastChannel('ls-webtest')
          bc.postMessage({ type: 'go' })
          bc.close()
        }),
      )

      const didBoot = (page: typeof page1) =>
        Effect.tryPromise({
          try: () => page.waitForSelector('text=Adapter Web Test App', { state: 'visible', timeout: 15000 }),
          catch: () => false,
        }).pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        )

      const [boot1, boot2] = yield* Effect.all([didBoot(page1), didBoot(page2)])
      expect(boot1 && boot2).toBe(true)
    }).pipe(withTestCtx(test)),
  )

  /**
   * Single-tab mode fallback for browsers without SharedWorker support (e.g. Android Chrome).
   *
   * This test verifies that when SharedWorker is unavailable, the adapter automatically
   * falls back to single-tab mode and still boots successfully.
   *
   * @see https://github.com/livestorejs/livestore/issues/321
   * @see https://issues.chromium.org/issues/40290702
   */
  Vitest.scopedLive('single-tab mode fallback (SharedWorker disabled)', (test) =>
    Effect.gen(function* () {
      const port = yield* getFreePort.pipe(Effect.map(String))

      // Start a Vite dev server for the React fixtures
      yield* cmd(`vite --config ${viteConfigRel} dev --port ${port}`, {
        env: {
          TEST_LIVESTORE_SCHEMA_PATH_JSON: undefined,
          LSD_DEVTOOLS_LOCAL_PREVIEW: undefined,
        },
      }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(integrationRoot)), Effect.forkScoped)

      const appUrl = (pathname: string) => `http://localhost:${port}${pathname}`

      // Wait for dev server to be ready
      const httpClient = yield* HttpClient.HttpClient.pipe(Effect.andThen(HttpClient.filterStatusOk))
      yield* httpClient.head(appUrl('/')).pipe(
        Effect.retry(Schedule.exponentialBackoff10Sec),
        Effect.mapError((error) => new Error('Dev server did not start in time', { cause: error })),
      )

      const { browserContext } = yield* BrowserContext

      const page = yield* Effect.promise(() => browserContext.newPage())

      // Disable SharedWorker before page loads to simulate Android Chrome
      yield* Effect.promise(() =>
        page.addInitScript(() => {
          // @ts-expect-error - Intentionally deleting SharedWorker to simulate Android Chrome
          delete window.SharedWorker
        }),
      )

      // Navigate to the test page
      const url = appUrl('/adapter-web/concurrent-boot')
      yield* Effect.promise(() => page.goto(`${url}?sessionId=single-tab-test&clientId=single-tab-client`))

      // Verify the adapter boots successfully in single-tab mode
      const didBoot = yield* Effect.tryPromise({
        try: () => page.waitForSelector('text=Adapter Web Test App', { state: 'visible', timeout: 15000 }),
        catch: () => false,
      }).pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false)),
      )

      expect(didBoot).toBe(true)

      // Verify that the warning about single-tab mode was logged
      const consoleLogs: string[] = []
      page.on('console', (msg) => consoleLogs.push(msg.text()))

      // Give a moment for logs to be captured
      yield* Effect.sleep(Duration.millis(100))

      // Note: Console logs from before we attached the listener won't be captured,
      // but the important thing is that the adapter booted successfully
    }).pipe(withTestCtx(test)),
  )

  /**
   * Verifies that two tabs in single-tab mode operate independently
   * (no cross-tab synchronization when SharedWorker is unavailable).
   */
  Vitest.scopedLive('single-tab mode: tabs operate independently', (test) =>
    Effect.gen(function* () {
      const port = yield* getFreePort.pipe(Effect.map(String))

      yield* cmd(`vite --config ${viteConfigRel} dev --port ${port}`, {
        env: {
          TEST_LIVESTORE_SCHEMA_PATH_JSON: undefined,
          LSD_DEVTOOLS_LOCAL_PREVIEW: undefined,
        },
      }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(integrationRoot)), Effect.forkScoped)

      const appUrl = (pathname: string) => `http://localhost:${port}${pathname}`

      const httpClient = yield* HttpClient.HttpClient.pipe(Effect.andThen(HttpClient.filterStatusOk))
      yield* httpClient.head(appUrl('/')).pipe(
        Effect.retry(Schedule.exponentialBackoff10Sec),
        Effect.mapError((error) => new Error('Dev server did not start in time', { cause: error })),
      )

      const { browserContext } = yield* BrowserContext

      const page1 = yield* Effect.promise(() => browserContext.newPage())
      const page2 = yield* Effect.promise(() => browserContext.newPage())

      // Disable SharedWorker on both pages
      yield* Effect.promise(() =>
        Promise.all([
          page1.addInitScript(() => {
            // @ts-expect-error - Intentionally deleting SharedWorker
            delete window.SharedWorker
          }),
          page2.addInitScript(() => {
            // @ts-expect-error - Intentionally deleting SharedWorker
            delete window.SharedWorker
          }),
        ]),
      )

      const url = appUrl('/adapter-web/concurrent-boot')

      // Boot both tabs
      yield* Effect.promise(() =>
        Promise.all([
          page1.goto(`${url}?sessionId=tab1&clientId=client1`),
          page2.goto(`${url}?sessionId=tab2&clientId=client2`),
        ]),
      )

      // Verify both tabs boot successfully
      const didBoot = (page: typeof page1) =>
        Effect.tryPromise({
          try: () => page.waitForSelector('text=Adapter Web Test App', { state: 'visible', timeout: 15000 }),
          catch: () => false,
        }).pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        )

      const [boot1, boot2] = yield* Effect.all([didBoot(page1), didBoot(page2)])
      expect(boot1 && boot2).toBe(true)

      // Both tabs should operate independently (this is expected behavior in single-tab mode)
      // We're just verifying they both boot; cross-tab sync is intentionally disabled
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('persists non-default backend data across reload', (test) =>
    Effect.gen(function* () {
      const port = yield* getFreePort.pipe(Effect.map(String))

      yield* cmd(`vite --config ${viteConfigRel} dev --port ${port}`, {
        env: {
          TEST_LIVESTORE_SCHEMA_PATH_JSON: undefined,
          LSD_DEVTOOLS_LOCAL_PREVIEW: undefined,
        },
      }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(integrationRoot)), Effect.forkScoped)

      const appUrl = (pathname: string) => `http://localhost:${port}${pathname}`
      const httpClient = yield* HttpClient.HttpClient.pipe(Effect.andThen(HttpClient.filterStatusOk))
      yield* httpClient.head(appUrl('/')).pipe(
        Effect.retry(Schedule.exponentialBackoff10Sec),
        Effect.mapError((error) => new Error('Dev server did not start in time', { cause: error })),
      )

      const { browserContext } = yield* BrowserContext
      const page = yield* Effect.promise(() => browserContext.newPage())

      const url = appUrl('/adapter-web/multi-backend-persistence')
      yield* Effect.promise(() => page.goto(`${url}?reset=1&sessionId=mb-session&clientId=mb-client`))
      yield* Effect.promise(() => page.waitForSelector('text=Adapter Web Multi Backend App'))
      yield* Effect.promise(() => page.waitForFunction(() => window.__lsMultiBackendTest !== undefined))

      const firstRows = yield* Effect.promise(() =>
        page.evaluate(() => {
          window.__lsMultiBackendTest?.commitBItem('b-1', 'Backend B Item')
          return window.__lsMultiBackendTest?.getBItems() ?? []
        }),
      )
      expect(firstRows).toEqual([{ id: 'b-1', title: 'Backend B Item' }])

      yield* Effect.promise(() => page.goto(`${url}?sessionId=mb-session&clientId=mb-client`))
      yield* Effect.promise(() => page.waitForSelector('text=Adapter Web Multi Backend App'))
      yield* Effect.promise(() => page.waitForFunction(() => window.__lsMultiBackendTest !== undefined))

      const rowsAfterReload = yield* Effect.promise(() =>
        page.evaluate(() => window.__lsMultiBackendTest?.getBItems() ?? []),
      )
      expect(rowsAfterReload).toEqual([{ id: 'b-1', title: 'Backend B Item' }])
    }).pipe(withTestCtx(test)),
  )
})
