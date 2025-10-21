/** biome-ignore-all lint/correctness/noEmptyPattern: playwright expects destructuring */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as Playwright from '@livestore/effect-playwright'
import { Effect, Fiber, Layer, Logger, OtelTracer, Scope, Tracer } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import type * as otel from '@opentelemetry/api'
import type * as PW from '@playwright/test'
import { expect, test } from '@playwright/test'

import { checkDevtoolsState } from './shared.ts'

const usedPages = new Set<PW.Page>()

const makeTabPair = (url: string, tabName: string) =>
  Effect.gen(function* () {
    const { browserContext } = yield* Playwright.BrowserContext

    browserContext.setDefaultTimeout(10_000)

    const isUnused = (p: PW.Page) => !usedPages.has(p)

    const newPage = Effect.tryPromise(() => browserContext.newPage())

    const page =
      browserContext
        .pages()
        .filter(isUnused)
        .find((p) => p.url() === 'about:blank') ?? (yield* newPage)

    // Console listeners
    const pageConsoleFiber = yield* Playwright.handlePageConsole({
      page,
      name: `${tabName}-page`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.forkScoped)

    usedPages.add(page)

    yield* Effect.tryPromise(() => page.goto(`${url}/devtools/todomvc?sessionId=${tabName}`))

    const rootSpanContext = yield* Effect.tryPromise(() =>
      page
        .waitForFunction('window.__debugLiveStore?.default !== undefined')
        .then(() => page.evaluate('window.__debugLiveStore.default._dev.otel.rootSpanContext()')),
    )

    yield* Effect.linkSpanCurrent(
      Tracer.externalSpan({
        traceId: (rootSpanContext as any).traceId,
        spanId: (rootSpanContext as any).spanId,
      }),
    )

    const devtools = yield* Effect.tryPromise(() => browserContext.newPage())

    const devtoolsConsoleFiber = yield* Playwright.handlePageConsole({
      page: devtools,
      name: `${tabName}-devtools`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.forkScoped)

    yield* Effect.tryPromise(() => devtools.goto(`${url}/_livestore/web#${tabName}`))

    usedPages.add(devtools)

    return { page, devtools, pageConsoleFiber, devtoolsConsoleFiber }
  })

const PWLive = Effect.gen(function* () {
  const persistentContextPath = fs.mkdtempSync(path.join(os.tmpdir(), '/livestore-playwright'))
  return Playwright.browserContextLayer({ persistentContextPath })
}).pipe(Layer.unwrapEffect)

const runTest =
  (eff: Effect.Effect<void, unknown, Scope.Scope | Playwright.BrowserContext>) =>
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
  'SessionInfo leaks across origins (web devtools)',
  runTest(
    Effect.gen(function* () {
      const port = process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT
      if (!port) return yield* Effect.fail(new Error('LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT not set'))

      const tabLocalhost = yield* makeTabPair(`http://localhost:${port}`, 'tab-localhost')
      const tabLoopback = yield* makeTabPair(`http://127.0.0.1:${port}`, 'tab-127')

      yield* Effect.tryPromise(async () => {
        // Create data in one tab
        const el = tabLocalhost.page.locator('.new-todo')
        await el.waitFor({ timeout: 10_000 })
        await el.fill('Buy milk')
        await el.press('Enter')

        // Both devtools should stabilize
        const tables = ['uiState (2)', 'todos (1)']
        await Promise.all([
          checkDevtoolsState({
            devtools: tabLocalhost.devtools,
            label: 'devtools-tab-1',
            expect: { leader: true, alreadyLoaded: false, tables },
          }),
          checkDevtoolsState({
            devtools: tabLoopback.devtools,
            label: 'devtools-tab-2',
            expect: { leader: false, alreadyLoaded: false, tables },
          }),
        ])

        // Navigate both to sessions index and assert both sessions are present
        const getLabel = async (p: PW.Page) =>
          p.evaluate<string>(
            `window.__debugLiveStore.default.clientId + ':' + window.__debugLiveStore.default.clientSession.sessionId`,
          )
        const [lhs, rhs] = await Promise.all([getLabel(tabLocalhost.page), getLabel(tabLoopback.page)])

        await tabLocalhost.devtools.goto(`${tabLocalhost.devtools.url().replace(/autoconnect&?/, '')}`)
        await tabLoopback.devtools.goto(`${tabLoopback.devtools.url().replace(/autoconnect&?/, '')}`)

        await expect(tabLocalhost.devtools.getByText(lhs, { exact: false }).first()).toBeVisible()
        await expect(tabLocalhost.devtools.getByText(rhs, { exact: false }).first()).toBeVisible()
        await expect(tabLoopback.devtools.getByText(rhs, { exact: false }).first()).toBeVisible()
        await expect(tabLoopback.devtools.getByText(lhs, { exact: false }).first()).toBeVisible()
      }).pipe(
        Effect.raceFirst(
          Fiber.joinAll([
            tabLocalhost.pageConsoleFiber,
            tabLocalhost.devtoolsConsoleFiber,
            tabLoopback.pageConsoleFiber,
            tabLoopback.devtoolsConsoleFiber,
          ]),
        ),
      )
    }),
  ),
)
