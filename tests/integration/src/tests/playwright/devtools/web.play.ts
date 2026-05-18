/** biome-ignore-all lint/correctness/noEmptyPattern: playwright expects destructuring */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type * as otel from '@opentelemetry/api'
import type * as PW from '@playwright/test'
import { test } from '@playwright/test'

import * as Playwright from '@livestore/effect-playwright'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Fiber, Layer, Logger, OtelTracer, Schema, Tracer } from '@livestore/utils/effect'

import { checkConnectionRemainsActive, checkDevtoolsState, checkProtocolMismatchOverlay } from './shared.ts'

const usedPages = new Set<PW.Page>()

type AdapterKind = 'persisted' | 'inmemory'

/**
 * Creates a tab pair with an app page and a DevTools page.
 */
const makeTabPair = (
  url: string,
  tabName: string,
  adapter: AdapterKind,
  options?: {
    appVersionOverride?: string
    appDevtoolsProtocolVersionOverride?: number
    devtoolsRoute?: 'session-list' | 'direct-session'
    skipOtelSpanLink?: boolean
  },
) =>
  Effect.gen(function* () {
    const { browserContext } = yield* Playwright.BrowserContext

    browserContext.setDefaultTimeout(10_000)

    const isUnused = (p: PW.Page) => !usedPages.has(p)

    const newPage = Effect.tryPromise(() => browserContext.newPage()).pipe(
      Effect.acquireRelease(
        Effect.fn('close-page')(function* (page, exit) {
          const reason =
            exit._tag === 'Failure' ? exit.cause.toString() : `Closing ${url}#${tabName} due to ${exit._tag}`

          yield* Effect.log(reason)
          yield* Effect.tryPromise(() => page.close({ reason }))
        }, Effect.orDie),
      ),
    )

    // Chrome opens with `about:blank` page, so we can use that for the first call
    const page =
      browserContext
        .pages()
        .filter(isUnused)
        .find((p) => p.url() === 'about:blank') ?? (yield* newPage)

    const session = yield* Effect.tryPromise(() => page.context().newCDPSession(page))

    yield* Effect.tryPromise(() => session.send('Debugger.enable'))

    session.on('Debugger.paused', async (_event) => {
      await page.pause()
    })

    // Inject display version override before page loads for compatibility overlay assertions.
    if (options?.appVersionOverride !== undefined) {
      yield* Effect.tryPromise(() =>
        page.addInitScript(`globalThis.__LIVESTORE_VERSION_OVERRIDE__ = '${options.appVersionOverride}';`),
      )
    }
    if (options?.appDevtoolsProtocolVersionOverride !== undefined) {
      yield* Effect.tryPromise(() =>
        page.addInitScript(
          `globalThis.__LIVESTORE_DEVTOOLS_PROTOCOL_VERSION_OVERRIDE__ = ${options.appDevtoolsProtocolVersionOverride};`,
        ),
      )
    }

    // NOTE we need to start the console listening right away, otherwise we might miss some messages
    const pageConsoleFiber = yield* Playwright.handlePageConsole({
      page,
      name: `${tabName}-page`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.forkScoped)

    usedPages.add(page)
    yield* Effect.addFinalizer(() => Effect.sync(() => usedPages.delete(page)))

    yield* Effect.tryPromise(() =>
      page.goto(`${url}/devtools/todomvc?sessionId=${tabName}&clientId=${tabName}&adapter=${adapter}`),
    )

    // Skip OTel span linking when testing DevTools protocol mismatch (app may not initialize properly)
    if (options?.appDevtoolsProtocolVersionOverride == null && options?.skipOtelSpanLink !== true) {
      const rootSpanContext = yield* Effect.tryPromise(() =>
        page
          .waitForFunction('window.__debugLiveStore?.default !== undefined')
          .then(() => page.evaluate('window.__debugLiveStore.default._dev.otel.rootSpanContext()')),
      ).pipe(Effect.andThen(Schema.decodeUnknown(Schema.Struct({ traceId: Schema.String, spanId: Schema.String }))))

      yield* Effect.linkSpanCurrent(
        Tracer.externalSpan({
          traceId: rootSpanContext.traceId,
          spanId: rootSpanContext.spanId,
        }),
      )
    }

    const devtools = yield* newPage

    const devtoolsConsoleFiber = yield* Playwright.handlePageConsole({
      page: devtools,
      name: `${tabName}-devtools`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.forkScoped)

    const devtoolsRoute =
      options?.devtoolsRoute === 'direct-session'
        ? `/_livestore/web/app-root/${tabName}/${tabName}/default`
        : `/_livestore/web#${tabName}`

    yield* Effect.tryPromise(() => devtools.goto(`${url}${devtoolsRoute}`))

    usedPages.add(devtools)

    return { page, devtools, pageConsoleFiber, devtoolsConsoleFiber }
  })

const PWLive = Effect.gen(function* () {
  const persistentContextPath = fs.mkdtempSync(path.join(os.tmpdir(), '/livestore-playwright'))

  return Playwright.browserContextLayer({ persistentContextPath })
}).pipe(Layer.unwrapEffect)

const runTest =
  <E>(eff: Effect.Effect<void, E, Playwright.BrowserContext | Scope.Scope>) =>
  (
    {}: PW.PlaywrightTestArgs & PW.PlaywrightTestOptions & PW.PlaywrightWorkerArgs & PW.PlaywrightWorkerOptions,
    testInfo: PW.TestInfo,
  ) => {
    const thread = `playwright-worker-${testInfo.workerIndex}`
    // @ts-expect-error TODO fix types
    globalThis.name = thread

    const parentSpanContext = JSON.parse(process.env.SPAN_CONTEXT_JSON ?? '{}') as otel.SpanContext
    const parentSpan = OtelTracer.makeExternalSpan({
      traceId: parentSpanContext.traceId,
      spanId: parentSpanContext.spanId,
    })

    const layer = Layer.mergeAll(PWLive, OtelLiveHttp({ serviceName: 'playwright', parentSpan, skipLogUrl: true }))

    return eff.pipe(
      Effect.withSpan(testInfo.title),
      Effect.scoped,
      Effect.provide(layer),
      Effect.tapCauseLogPretty,
      Effect.annotateLogs({ thread }),
      Effect.provide(Logger.prettyWithThread(thread)),
      Effect.runPromise,
    )
  }

;(['persisted', 'inmemory'] as const).forEach((adapter) => {
  test(
    `single tab (adapter=${adapter})`,
    runTest(
      Effect.gen(function* () {
        const tab1 = yield* makeTabPair(
          `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}`,
          'tab-1',
          adapter,
        )

        yield* Effect.gen(function* () {
          yield* Effect.tryPromise(async () => {
            const el = tab1.page.locator('.new-todo').describe('tab-1:new-todo')
            await el.waitFor({ timeout: 3000 })

            await el.fill('Buy milk')
            await el.press('Enter')

            await tab1.page.locator('.todo-list li label:text("Buy milk")').waitFor()

            const tab1ChannelId = await tab1.page.evaluate<string>(
              `window.__debugLiveStore.default.clientId + ':' + window.__debugLiveStore.default.sessionId`,
            )
            await tab1.devtools.locator(`a:text("${tab1ChannelId}")`).describe('devtools-tab-1:click').click()

            const tables = ['uiState (1)', 'todos (1)']

            await checkDevtoolsState({
              devtools: tab1.devtools,
              label: 'devtools-tab-1',
              expect: { leader: true, alreadyLoaded: false, tables },
            })

            await test.step('devtools-tab-1:reload', async () => {
              await tab1.page.reload()
            })

            // Why: In-memory adapter is volatile; events aren’t persisted, so after reload the eventlog is empty and todos reset to 0.
            const tablesAfterReload = adapter === 'inmemory' ? ['uiState (1)', 'todos (0)'] : tables

            await checkDevtoolsState({
              devtools: tab1.devtools,
              label: 'devtools-tab-1',
              expect: { leader: true, alreadyLoaded: false, tables: tablesAfterReload },
            })
          })

          yield* shutdownTab(tab1.page)

          yield* Effect.sleep(500).pipe(Effect.withSpan('wait-for-otel-flush'))
        }).pipe(
          Effect.raceFirst(
            Fiber.joinAll([
              tab1.pageConsoleFiber,
              tab1.devtoolsConsoleFiber,
              // TODO bring back background
              // backgroundPageConsoleFiber!,
            ]),
          ),
        )
      }),
      // .pipe(Effect.scoped, Effect.retry({ times: 2 })),
    ),
  )

  // Only test two-tabs with persisted adapter: in-memory is per-tab and volatile, so state isn’t shared across tabs.
  if (adapter === 'persisted') {
    test(
      `two tabs (adapter=${adapter})`,
      runTest(
        Effect.gen(function* () {
          const tab1 = yield* makeTabPair(
            `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}`,
            'tab-1',
            adapter,
          )
          const tab2 = yield* makeTabPair(
            `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}`,
            'tab-2',
            adapter,
          )

          yield* Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.all([shutdownTab(tab1.page), shutdownTab(tab2.page)], {
                concurrency: 'unbounded',
              }).pipe(Effect.orDie),
            )

            yield* Effect.tryPromise(async () => {
              await tab1.page.focus('body')

              const el = tab1.page.locator('.new-todo')
              await el.waitFor({ timeout: 3000 })

              await el.fill('Buy milk')
              await el.press('Enter')

              await tab1.page.locator('.todo-list li label:text("Buy milk")').waitFor()

              const tab1ChannelId = await tab1.page.evaluate<string>(
                `window.__debugLiveStore.default.clientId + ':' + window.__debugLiveStore.default.sessionId`,
              )
              const tab2ChannelId = await tab2.page.evaluate<string>(
                `window.__debugLiveStore.default.clientId + ':' + window.__debugLiveStore.default.sessionId`,
              )

              const tables = ['uiState (2)', 'todos (1)']

              await Promise.all([
                tab1.devtools
                  .locator(`a:text("${tab1ChannelId}")`)
                  .describe('devtools-tab-1:click')
                  .click()
                  .then(() =>
                    checkDevtoolsState({
                      devtools: tab1.devtools,
                      label: 'devtools-tab-1',
                      expect: { leader: true, alreadyLoaded: false, tables },
                    }),
                  ),
                tab2.devtools
                  .locator(`a:text("${tab2ChannelId}")`)
                  .describe('devtools-tab-2:click')
                  .click()
                  .then(() =>
                    checkDevtoolsState({
                      devtools: tab2.devtools,
                      label: 'devtools-tab-2',
                      expect: { leader: false, alreadyLoaded: false, tables },
                    }),
                  ),
              ])

              await tab1.page.reload()

              await Promise.all([
                tab1.page.locator('.todo-list li label:text("Buy milk")').describe('tab-1:Buy milk').waitFor(),
                checkDevtoolsState({
                  devtools: tab1.devtools,
                  label: 'devtools-tab-1',
                  expect: { leader: false, alreadyLoaded: true, tables },
                }),
                checkDevtoolsState({
                  devtools: tab2.devtools,
                  label: 'devtools-tab-2',
                  expect: { leader: true, alreadyLoaded: true, tables },
                }),
              ])
            })
          }).pipe(
            Effect.raceFirst(
              Fiber.joinAll([
                tab1.pageConsoleFiber,
                tab1.devtoolsConsoleFiber,
                tab2.pageConsoleFiber,
                tab2.devtoolsConsoleFiber,
              ]),
            ),
          )
        }),
      ),
    )
  }
})

test(
  'direct web session stays connected past heartbeat window',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}`,
        'tab-direct-session',
        'inmemory',
        { devtoolsRoute: 'direct-session', skipOtelSpanLink: true },
      )

      yield* Effect.gen(function* () {
        yield* Effect.tryPromise(async () => {
          await checkDevtoolsState({
            devtools: tab1.devtools,
            label: 'devtools-direct-session',
            expect: { leader: true, alreadyLoaded: false, tables: ['uiState (1)', 'todos (0)'] },
          })

          // The web direct transport previously reused one Ping request id. The app
          // dedupes request ids, so the second heartbeat was ignored and this page
          // reported "Connection to app lost" after roughly 15 seconds.
          await checkConnectionRemainsActive({
            devtools: tab1.devtools,
            label: 'devtools-direct-session',
            durationMs: 22_000,
          })
        })

        yield* shutdownTab(tab1.page, { expectStore: false })

        yield* Effect.sleep(500).pipe(Effect.withSpan('wait-for-otel-flush'))
      }).pipe(Effect.raceFirst(Fiber.joinAll([tab1.pageConsoleFiber, tab1.devtoolsConsoleFiber])))
    }),
  ),
)

const shutdownTab = Effect.fn('shutdown-tab')(function* (tab: PW.Page, options?: { expectStore?: boolean }) {
  // yield* Playwright.withPage(() => tab.pause())
  yield* Effect.sleep(1000)
  yield* Playwright.withPage(() => tab.evaluate('console.log(window.__debugLiveStore)'))

  const didShutdown = yield* Playwright.withPage(
    () =>
      tab.evaluate(() => {
        const store = (window as any).__debugLiveStore?.default
        if (store === undefined) return false

        store.shutdown()
        return true
      }),
    { label: 'shutdown' },
  ).pipe(Effect.timeout(1000))

  if (didShutdown === false && options?.expectStore !== false) {
    yield* Effect.dieMessage('Expected LiveStore debug store to be available for shutdown')
  }

  if (didShutdown === true) {
    yield* Playwright.withPage(() => tab.getByText('LiveStore Shutdown').waitFor())
  }
})

test(
  'protocol mismatch overlay',
  runTest(
    Effect.gen(function* () {
      const fakeAppVersion = '0.0.0-fake-version'
      const tabName = 'tab-protocol-mismatch'

      const tab1 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}`,
        tabName,
        'inmemory',
        { appDevtoolsProtocolVersionOverride: 999, appVersionOverride: fakeAppVersion },
      )

      yield* Effect.gen(function* () {
        yield* Effect.tryPromise(async () => {
          // Wait for the app to load
          const el = tab1.page.locator('.new-todo').describe('tab-protocol-mismatch:new-todo')
          await el.waitFor({ timeout: 3000 })

          // Click on the session in devtools to connect
          await tab1.devtools.locator(`a:text("${tabName}:${tabName}")`).describe('devtools:click-session').click()

          const devtoolsVersion = await tab1.devtools.evaluate<string>(() => {
            return (window as any).__LIVESTORE_DEVTOOLS_VERSION__ ?? 'unknown'
          })

          await checkProtocolMismatchOverlay({
            devtools: tab1.devtools,
            label: 'devtools-protocol-mismatch',
            expect: {
              devtoolsVersion: devtoolsVersion !== 'unknown' ? devtoolsVersion : '0.4', // Partial match
              appVersion: fakeAppVersion,
            },
          })
        })

        yield* shutdownTab(tab1.page, { expectStore: false })

        yield* Effect.sleep(500).pipe(Effect.withSpan('wait-for-otel-flush'))
      }).pipe(Effect.raceFirst(Fiber.joinAll([tab1.pageConsoleFiber, tab1.devtoolsConsoleFiber])))
    }),
  ),
)
