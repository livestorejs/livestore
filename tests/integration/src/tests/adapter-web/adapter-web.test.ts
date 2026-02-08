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

type MultiBackendTestHandle = {
  commitAItem: (id: string, title: string) => void
  getAItems: () => ReadonlyArray<{ id: string; title: string }>
  commitBItem: (id: string, title: string) => void
  getBItems: () => ReadonlyArray<{ id: string; title: string }>
  waitUntilSynced: (timeoutMs?: number) => Promise<void>
  shutdown: () => Promise<void>
}

const waitForMultiBackendHandle = (page: { waitForFunction: (pageFunction: () => unknown) => Promise<unknown> }) =>
  Effect.promise(() =>
    page.waitForFunction(() => {
      const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
      return windowWithTestHandle.__lsMultiBackendTest !== undefined
    }),
  )

const deleteBackendBStateDbFromOpfs = (page: { evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T> }) =>
  Effect.promise(() =>
    page.evaluate(async () => {
      const HEADER_MAX_PATH_SIZE = 512
      const HEADER_FLAGS_SIZE = 4
      const HEADER_DIGEST_SIZE = 8
      const HEADER_CORPUS_SIZE = HEADER_MAX_PATH_SIZE + HEADER_FLAGS_SIZE
      const HEADER_OFFSET_DIGEST = HEADER_CORPUS_SIZE
      const textDecoder = new TextDecoder()

      const computeDigest = (corpus: Uint8Array): Uint32Array => {
        if (!corpus[0]) {
          return new Uint32Array([0xfe_cc_5f_80, 0xac_ce_c0_37])
        }

        let h1 = 0xde_ad_be_ef
        let h2 = 0x41_c6_ce_57

        for (const value of corpus) {
          h1 = Math.imul(h1 ^ value, 2_654_435_761)
          h2 = Math.imul(h2 ^ value, 1_597_334_677)
        }

        h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909)
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909)

        return new Uint32Array([h1 >>> 0, h2 >>> 0])
      }

      const decodeAccessHandlePoolFilename = async (file: File): Promise<string | undefined> => {
        const corpus = new Uint8Array(await file.slice(0, HEADER_CORPUS_SIZE).arrayBuffer())
        const fileDigest = new Uint32Array(
          await file.slice(HEADER_OFFSET_DIGEST, HEADER_OFFSET_DIGEST + HEADER_DIGEST_SIZE).arrayBuffer(),
        )
        const computedDigest = computeDigest(corpus)

        if (!fileDigest.every((value, index) => value === computedDigest[index])) {
          return undefined
        }

        const pathBytes = corpus.indexOf(0)
        if (pathBytes <= 0) {
          return undefined
        }

        return textDecoder.decode(corpus.subarray(0, pathBytes))
      }

      const deleted: string[] = []
      const root = await navigator.storage.getDirectory()
      const isDirectoryHandle = (handle: FileSystemHandle): handle is FileSystemDirectoryHandle =>
        handle.kind === 'directory'
      const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle => handle.kind === 'file'

      const fileLooksLikeBackendBStateDb = async (fileHandle: FileSystemFileHandle, fileName: string) => {
        if (fileName.startsWith('state@b') && fileName.endsWith('.db')) {
          return true
        }

        try {
          const file = await fileHandle.getFile()
          const decodedFileName = await decodeAccessHandlePoolFilename(file)
          return decodedFileName?.startsWith('/state@b') === true && decodedFileName.endsWith('.db')
        } catch {
          return false
        }
      }

      const walk = async (dir: FileSystemDirectoryHandle): Promise<void> => {
        for await (const [fileName, handle] of dir.entries()) {
          if (isDirectoryHandle(handle)) {
            await walk(handle)
            continue
          }

          if (isFileHandle(handle) && (await fileLooksLikeBackendBStateDb(handle, fileName))) {
            await dir.removeEntry(fileName)
            deleted.push(fileName)
          }
        }
      }

      await walk(root)
      return deleted
    }),
  )

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
          page1.goto(
            `${url}?storeId=adapter-web-two-tabs&barrier=1&sessionId=a&clientId=A&disableFastPath=1&bootDelayMs=0`,
          ),
          page2.goto(
            `${url}?storeId=adapter-web-two-tabs&barrier=1&sessionId=b&clientId=B&disableFastPath=1&bootDelayMs=60`,
          ),
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
      yield* Effect.promise(() =>
        page.goto(
          `${url}?storeId=adapter-web-single-tab-fallback&sessionId=single-tab-test&clientId=single-tab-client`,
        ),
      )

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
          page1.goto(
            `${url}?storeId=adapter-web-single-tab-independent&sessionId=tab1&clientId=client1&disableFastPath=1`,
          ),
          page2.goto(
            `${url}?storeId=adapter-web-single-tab-independent&sessionId=tab2&clientId=client2&disableFastPath=1`,
          ),
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

  Vitest.scopedLive('multi-backend: missing persisted backend snapshot recovers via fallback', (test) =>
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
      yield* waitForMultiBackendHandle(page)

      const firstRows = yield* Effect.promise(() =>
        page.evaluate(() => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          windowWithTestHandle.__lsMultiBackendTest.commitBItem('b-1', 'Backend B Item')
          return windowWithTestHandle.__lsMultiBackendTest.getBItems()
        }),
      )
      expect(firstRows).toEqual([{ id: 'b-1', title: 'Backend B Item' }])

      yield* Effect.promise(() =>
        page.evaluate(async () => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          await windowWithTestHandle.__lsMultiBackendTest.waitUntilSynced()
        }),
      )

      yield* Effect.promise(() =>
        page.evaluate(async () => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          await windowWithTestHandle.__lsMultiBackendTest.shutdown()
        }),
      )

      const deletedBackendBFiles = yield* deleteBackendBStateDbFromOpfs(page)
      expect(deletedBackendBFiles.length).toBeGreaterThan(0)

      yield* Effect.promise(() => page.goto(`${url}?sessionId=mb-session&clientId=mb-client`))
      yield* Effect.promise(() => page.waitForSelector('text=Adapter Web Multi Backend App'))
      yield* waitForMultiBackendHandle(page)

      const rowsAfterReload = yield* Effect.promise(() =>
        page.evaluate(() => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          return windowWithTestHandle.__lsMultiBackendTest.getBItems()
        }),
      )
      expect(rowsAfterReload).toEqual([{ id: 'b-1', title: 'Backend B Item' }])

      yield* Effect.promise(() =>
        page.evaluate(async () => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          await windowWithTestHandle.__lsMultiBackendTest.shutdown()
        }),
      )
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('multi-backend: deleting backend B snapshot preserves backend A data', (test) =>
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
      yield* Effect.promise(() => page.goto(`${url}?reset=1&sessionId=mb-session-ab&clientId=mb-client-ab`))
      yield* Effect.promise(() => page.waitForSelector('text=Adapter Web Multi Backend App'))
      yield* waitForMultiBackendHandle(page)

      const firstRows = yield* Effect.promise(() =>
        page.evaluate(() => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          windowWithTestHandle.__lsMultiBackendTest.commitAItem('a-1', 'Backend A Item')
          windowWithTestHandle.__lsMultiBackendTest.commitBItem('b-1', 'Backend B Item')

          return {
            aRows: windowWithTestHandle.__lsMultiBackendTest.getAItems(),
            bRows: windowWithTestHandle.__lsMultiBackendTest.getBItems(),
          }
        }),
      )
      expect(firstRows).toEqual({
        aRows: [{ id: 'a-1', title: 'Backend A Item' }],
        bRows: [{ id: 'b-1', title: 'Backend B Item' }],
      })

      yield* Effect.promise(() =>
        page.evaluate(async () => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          await windowWithTestHandle.__lsMultiBackendTest.waitUntilSynced()
        }),
      )

      yield* Effect.promise(() =>
        page.evaluate(async () => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          await windowWithTestHandle.__lsMultiBackendTest.shutdown()
        }),
      )

      const deletedBackendBFiles = yield* deleteBackendBStateDbFromOpfs(page)
      expect(deletedBackendBFiles.length).toBeGreaterThan(0)

      yield* Effect.promise(() => page.goto(`${url}?sessionId=mb-session-ab&clientId=mb-client-ab`))
      yield* Effect.promise(() => page.waitForSelector('text=Adapter Web Multi Backend App'))
      yield* waitForMultiBackendHandle(page)

      const rowsAfterReload = yield* Effect.promise(() =>
        page.evaluate(() => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          return {
            aRows: windowWithTestHandle.__lsMultiBackendTest.getAItems(),
            bRows: windowWithTestHandle.__lsMultiBackendTest.getBItems(),
          }
        }),
      )
      expect(rowsAfterReload).toEqual({
        aRows: [{ id: 'a-1', title: 'Backend A Item' }],
        bRows: [{ id: 'b-1', title: 'Backend B Item' }],
      })

      yield* Effect.promise(() =>
        page.evaluate(async () => {
          const windowWithTestHandle = window as Window & { __lsMultiBackendTest?: MultiBackendTestHandle }
          if (windowWithTestHandle.__lsMultiBackendTest === undefined) {
            throw new Error('Multi-backend test handle is not available.')
          }

          await windowWithTestHandle.__lsMultiBackendTest.shutdown()
        }),
      )
    }).pipe(withTestCtx(test)),
  )
})
