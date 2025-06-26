/** biome-ignore-all lint/correctness/noEmptyPattern: playwright expects destructuring */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as Playwright from '@livestore/effect-playwright'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Fiber, Layer, Logger, OtelTracer, Schema, Tracer } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import type * as otel from '@opentelemetry/api'
import type * as PW from '@playwright/test'
import { test } from '@playwright/test'

import { checkDevtoolsState } from './shared.js'

const usedPages = new Set<PW.Page>()

const makeTabPair = (url: string, tabName: string) =>
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

    // NOTE we need to start the console listening right away, otherwise we might miss some messages
    const pageConsoleFiber = yield* Playwright.handlePageConsole({
      page,
      name: `${tabName}-page`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.forkScoped)

    usedPages.add(page)
    yield* Effect.addFinalizer(() => Effect.sync(() => usedPages.delete(page)))

    yield* Effect.tryPromise(() => page.goto(`${url}/devtools/todomvc?sessionId=${tabName}`))

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

    const devtools = yield* newPage

    const devtoolsConsoleFiber = yield* Playwright.handlePageConsole({
      page: devtools,
      name: `${tabName}-devtools`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.forkScoped)

    yield* Effect.tryPromise(() => devtools.goto(`${url}_livestore/web#${tabName}`))

    usedPages.add(devtools)

    return { page, devtools, pageConsoleFiber, devtoolsConsoleFiber }
  })

const PWLive = Effect.gen(function* () {
  const persistentContextPath = fs.mkdtempSync(path.join(os.tmpdir(), '/livestore-playwright'))

  return Playwright.browserContextLayer({ persistentContextPath })
}).pipe(Layer.unwrapEffect)

const runTest =
  (eff: Effect.Effect<void, unknown, Playwright.BrowserContext | Scope.Scope>) =>
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

test(
  'single tab',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(`http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/`, 'tab-1')

      yield* Effect.gen(function* () {
        yield* Effect.tryPromise(async () => {
          const el = tab1.page.locator('.new-todo').describe('tab-1:new-todo')
          await el.waitFor({ timeout: 3000 })

          await el.fill('Buy milk')
          await el.press('Enter')

          await tab1.page.locator('.todo-list li label:text("Buy milk")').waitFor()

          await tab1.devtools.locator('a').describe('devtools-tab-1:click').click()

          const tables = ['uiState (1)', 'todos (1)']

          await checkDevtoolsState({
            devtools: tab1.devtools,
            label: 'devtools-tab-1',
            expect: { leader: true, alreadyLoaded: false, tables },
          })

          await test.step('devtools-tab-1:reload', async () => {
            await tab1.page.reload()
          })

          await checkDevtoolsState({
            devtools: tab1.devtools,
            label: 'devtools-tab-1',
            expect: { leader: true, alreadyLoaded: false, tables },
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

test(
  'two tabs',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(`http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/`, 'tab-1')
      const tab2 = yield* makeTabPair(`http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/`, 'tab-2')

      // const browserContext = yield* Playwright.BrowserContext

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
          // await tab2.page.locator('.todo-list li label:text("Buy milk")').waitFor()

          const tab1ChannelId = await tab1.page.evaluate<string>(
            `window.__debugLiveStore.default.clientId + ':' + window.__debugLiveStore.default.clientSession.sessionId`,
          )
          const tab2ChannelId = await tab2.page.evaluate<string>(
            `window.__debugLiveStore.default.clientId + ':' + window.__debugLiveStore.default.clientSession.sessionId`,
          )

          const tables = ['uiState (2)', 'todos (1)']

          // const workersPage = await browserContext.browserContext.newPage()
          // await workersPage.goto('chrome://inspect/#workers')
          // await workersPage.locator('#workers-list div.actions span').getByText('inspect').first().click()

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

          // try {
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
          // } catch (e) {
          //   console.log('pausing devtools', e)
          //   await tab1.devtools.pause()
          // }
        })
      }).pipe(
        Effect.raceFirst(
          Fiber.joinAll([
            tab1.pageConsoleFiber,
            tab1.devtoolsConsoleFiber,
            tab2.pageConsoleFiber,
            tab2.devtoolsConsoleFiber,
            // TODO bring back background
            // backgroundPageConsoleFiber!,
          ]),
        ),
      )
    }),
    // .pipe(Effect.scoped, Effect.retry({ times: 2 })),
  ),
)

const shutdownTab = (tab: PW.Page) =>
  Effect.gen(function* () {
    // yield* Playwright.withPage(() => tab.pause())
    yield* Effect.sleep(1000)
    yield* Playwright.withPage(() => tab.evaluate('console.log(window.__debugLiveStore)'))
    yield* Playwright.withPage(() => tab.evaluate('window.__debugLiveStore.default.shutdown()'), {
      label: 'shutdown',
    }).pipe(Effect.timeout(1000))

    yield* Playwright.withPage(() => tab.getByText('LiveStore Shutdown').waitFor())
  }).pipe(Effect.withSpan('shutdown-tab'))
