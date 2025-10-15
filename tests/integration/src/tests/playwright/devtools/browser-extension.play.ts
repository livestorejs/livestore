/** biome-ignore-all lint/correctness/noEmptyPattern: playwright expects destructuring */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as Playwright from '@livestore/effect-playwright'
import { shouldNeverHappen } from '@livestore/utils'
import {
  Effect,
  FetchHttpClient,
  Fiber,
  FileSystem,
  identity,
  Layer,
  Logger,
  OtelTracer,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { LIVESTORE_DEVTOOLS_CHROME_DIST_PATH } from '@local/shared'
import type * as otel from '@opentelemetry/api'
import type * as PW from '@playwright/test'
import { test } from '@playwright/test'
import { downloadChromeExtension } from '../../../../scripts/download-chrome-extension.ts'
import { checkDevtoolsState } from './shared.ts'

const usedPages = new Set<PW.Page>()

const makeTabPair = (url: string, tabName: string) =>
  Effect.gen(function* () {
    const { browserContext } = yield* Playwright.BrowserContext

    const isDevtools = (p: PW.Page) => p.url().startsWith('devtools://devtools/bundled/devtools_app.html')
    const isUnused = (p: PW.Page) => !usedPages.has(p)

    const newPage = Effect.gen(function* () {
      // const pageEventFiber = yield* Effect.async((cb) => {
      //   browserContext.on('page', () => cb(Effect.void))
      // }).pipe(Effect.fork)

      const page = yield* Effect.tryPromise(() => browserContext.newPage())
      // yield* Fiber.await(pageEventFiber)

      return page
    })

    // Chrome opens with `about:blank` page, so we can use that for the first call
    const page =
      browserContext
        .pages()
        .filter(isUnused)
        .find((p) => p.url() === 'about:blank') ?? (yield* newPage)

    // NOTE we need to start the console listening right away, otherwise we might miss some messages
    const pageConsoleFiber = yield* Playwright.handlePageConsole({
      page,
      name: `${tabName}-page`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.fork)

    usedPages.add(page)

    yield* Effect.tryPromise(() => page.goto(`${url}?sessionId=${tabName}`))

    const devtools =
      browserContext.pages().filter(isUnused).find(isDevtools) ??
      shouldNeverHappen(`No devtools page found. Current pages: ${browserContext.pages().map((_) => _.url())}`)

    const devtoolsConsoleFiber = yield* Playwright.handlePageConsole({
      page: devtools,
      name: `${tabName}-devtools`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.fork)

    usedPages.add(devtools)

    const liveStoreDevtools = yield* getLiveStoreDevtoolsFrame(devtools, `${tabName}-devtools`)

    return {
      page,
      devtools,
      liveStoreDevtools,
      pageConsoleFiber,
      devtoolsConsoleFiber,
    }
  })

// Based on https://gist.github.com/mxschmitt/f891a2f8fb37ce01ed026627f75d7ce6
const getLiveStoreDevtoolsFrame = (devtools: PW.Page, label: string) =>
  Effect.tryPromise(async () => {
    return await test.step(`${label}:getLiveStoreDevtoolsFrame`, async () => {
      await devtools.getByRole('button', { name: 'Customize and control DevTools' }).first().click()
      // TODO sometimes (fairly rarely) gets stuck in this step
      await devtools.getByTitle('Undock into separate window').describe(`${label}:Undock into separate window`).click()

      const liveStoreDevtoolsPromise = new Promise<PW.Frame>((resolve) => {
        devtools.on('framenavigated', (frame) => {
          if (frame.url().includes('_livestore/browser-extension')) {
            resolve(frame)
          }
        })
      })

      await devtools.getByRole('tab', { name: 'LiveStore' }).click()

      return await liveStoreDevtoolsPromise
    })
  })

const runTest =
  (eff: Effect.Effect<void, unknown, Playwright.BrowserContext>) =>
  (
    {}: PW.PlaywrightTestArgs & PW.PlaywrightTestOptions & PW.PlaywrightWorkerArgs & PW.PlaywrightWorkerOptions,
    testInfo: PW.TestInfo,
  ) =>
    Effect.gen(function* () {
      const parentSpanContext = JSON.parse(process.env.SPAN_CONTEXT_JSON ?? '{}') as otel.SpanContext
      const parentSpan = OtelTracer.makeExternalSpan({
        traceId: parentSpanContext.traceId,
        spanId: parentSpanContext.spanId,
      })

      const thread = `playwright-worker-${testInfo.workerIndex}`
      // @ts-expect-error TODO fix types
      globalThis.name = thread

      const extensionPath = yield* getExtensionPath

      const layer = Layer.mergeAll(
        PWLive({ extensionPath }),
        OtelLiveHttp({ serviceName: 'playwright', parentSpan, skipLogUrl: true }),
      )

      yield* eff.pipe(
        Effect.withSpan(testInfo.title),
        Effect.scoped,
        Effect.annotateLogs({ thread }),
        Effect.provide(layer),
      )
    }).pipe(
      Effect.tapCauseLogPretty,
      Effect.provide(Logger.pretty),
      Effect.provide(PlatformNode.NodeContext.layer),
      Effect.provide(FetchHttpClient.layer),
      Effect.runPromise,
    )

const getExtensionPath = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const extensionPathFromEnv = process.env.LIVESTORE_DEVTOOLS_CHROME_DIST_PATH
  if (extensionPathFromEnv) {
    yield* Effect.logInfo(`Using extension path from env LIVESTORE_DEVTOOLS_CHROME_DIST_PATH: ${extensionPathFromEnv}`)
    return extensionPathFromEnv
  }

  const defaultExtensionPath = LIVESTORE_DEVTOOLS_CHROME_DIST_PATH
  if ((yield* fs.exists(defaultExtensionPath)) === false) {
    yield* Effect.logInfo(`Downloading Chrome extension to ${defaultExtensionPath}`)
    yield* downloadChromeExtension({ targetDir: defaultExtensionPath })
  }
  return defaultExtensionPath
}).pipe(
  Effect.tap((path) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      if ((yield* fs.exists(path)) === false) {
        return yield* Effect.fail(new Error(`Chrome extension not found at ${path}`))
      }
    }),
  ),
)

const PWLive = ({ extensionPath }: { extensionPath: string }) =>
  Effect.gen(function* () {
    const persistentContextPath = fs.mkdtempSync(path.join(os.tmpdir(), '/livestore-playwright'))

    return Playwright.browserContextLayer({
      persistentContextPath,
      extensionPath,
      launchOptions: { devtools: true },
    })
  }).pipe(Layer.unwrapEffect)

test(
  'single tab',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
        'tab-1',
      )

      yield* Effect.tryPromise(async () => {
        const el = tab1.page.locator('.new-todo')
        await el.waitFor({ timeout: 10_000 })

        await el.fill('Buy milk')
        await el.press('Enter')

        await tab1.page.locator('.todo-list li label:text("Buy milk")').waitFor()

        await checkDevtoolsState({
          devtools: tab1.liveStoreDevtools,
          label: 'devtools-tab-1',
          expect: {
            leader: true,
            alreadyLoaded: false,
            tables: ['uiState (1)', 'todos (1)'],
          },
        })
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
    // .pipe(Effect.retry({ times: 2 })),
  ),
)

test.skip(
  'single tab (two stores)',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
        'tab-1',
      )

      yield* Effect.tryPromise(async () => {
        await tab1.page.getByText('Notes').waitFor()
        await tab1.page.getByText('Todos').waitFor()

        // await checkDevtoolsState({
        //   devtools: tab1.liveStoreDevtools,
        //   expect: { leader: true, alreadyLoaded: false, tables: ['uiState (1)', 'todos (1)'] },
        // })
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
    // .pipe(Effect.retry({ times: 2 })),
  ),
)

// Flaky error case:
// NotReadableError: The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.
test(
  'two tabs',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
        'tab-1',
      )
      const tab2 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
        'tab-2',
      )

      yield* Effect.tryPromise(async () => {
        await tab1.page.focus('body')

        const el = tab1.page.locator('.new-todo').describe('tab-1:new-todo')
        await el.waitFor({ timeout: 10_000 })

        await el.fill('Buy milk')
        await el.press('Enter')

        await tab1.page.locator('.todo-list li label:text("Buy milk")').describe('tab-1:Buy milk').waitFor()
        await tab2.page.locator('.todo-list li label:text("Buy milk")').describe('tab-2:Buy milk').waitFor()

        const tables = ['uiState (2)', 'todos (1)']

        await checkDevtoolsState({
          devtools: tab1.liveStoreDevtools,
          label: 'devtools-tab-1',
          expect: { leader: true, alreadyLoaded: false, tables },
        })
        await checkDevtoolsState({
          devtools: tab2.liveStoreDevtools,
          label: 'devtools-tab-2',
          expect: { leader: false, alreadyLoaded: false, tables },
        })

        await test.step('tab-1:reload', async () => {
          await tab1.page.reload()
        })

        await tab1.page.locator('.todo-list li label:text("Buy milk")').describe('tab-1:Buy milk').waitFor()

        await test.step('devtools-tab-2:reload', async () => {
          await tab2.devtools.reload()
        })

        tab2.liveStoreDevtools = await getLiveStoreDevtoolsFrame(tab2.devtools, 'devtools-tab-2').pipe(
          Effect.runPromise,
        )

        await checkDevtoolsState({
          devtools: tab1.liveStoreDevtools,
          label: 'devtools-tab-1',
          expect: { leader: false, alreadyLoaded: false, tables },
        })
        await checkDevtoolsState({
          devtools: tab2.liveStoreDevtools,
          label: 'devtools-tab-2',
          expect: { leader: true, alreadyLoaded: false, tables },
        })
      }).pipe(
        process.env.CI
          ? identity
          : Effect.tapErrorTag('UnknownException', () => Effect.promise(() => tab1.page.pause())),
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
    // .pipe(Effect.retry({ times: 2 })),
  ),
)

test(
  'no livestore',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/no-livestore`,
        'tab-1',
      )

      yield* Effect.tryPromise(async () => {
        await tab1.page.getByText('No Livestore').waitFor()

        // TODO bring back once we restructured the playwright tests
        // this test relies on the devtools vite plugin not being loaded but currently it is loaded
        // await tab1.devtools.getByText('LiveStore Devtools entrypoint not found').waitFor()
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
  ),
)
