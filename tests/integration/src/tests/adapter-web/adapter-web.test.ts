import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserContext, browserContextLayer } from '@livestore/effect-playwright'
import { Duration, Effect, FetchHttpClient, HttpClient, Layer, Schedule } from '@livestore/utils/effect'
import { getFreePort, PlatformNode } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'
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
        cwd: integrationRoot,
        env: {
          TEST_LIVESTORE_SCHEMA_PATH_JSON: undefined, // ensure devtools plugin is disabled
          LSD_DEVTOOLS_LOCAL_PREVIEW: undefined,
        },
      }).pipe(Effect.forkScoped)

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
})
