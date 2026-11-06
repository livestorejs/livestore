import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type * as otel from '@opentelemetry/api'
import type * as PW from '@playwright/test'
import { expect, test } from '@playwright/test'

import * as Playwright from '@livestore/effect-playwright'
import { shouldNeverHappen } from '@livestore/utils'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import {
  Effect,
  FetchHttpClient,
  Fiber,
  FileSystem,
  identity,
  Layer,
  Logger,
  OtelTracer,
  Schema,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { LIVESTORE_DEVTOOLS_CHROME_DIST_PATH } from '@local/shared'

import { downloadChromeExtension } from '../../../../scripts/download-chrome-extension.ts'
import { makeDevtoolsFixtureUrl } from './fixture-url.ts'
import { checkDevtoolsState, checkProtocolMismatchOverlay } from './shared.ts'

const appStoreId = 'app-root'

export class TestError extends Schema.TaggedError<TestError>()('TestError', {
  message: Schema.String,
}) {}

const usedPages = new Set<PW.Page>()

type AdapterKind = 'persisted' | 'inmemory'

/**
 * Creates a tab pair with an app page and a DevTools page (browser extension).
 */
const makeTabPair = (
  url: string,
  tabName: string,
  adapter: AdapterKind,
  options?: { appVersionOverride?: string; appDevtoolsProtocolVersionOverride?: number },
) =>
  Effect.gen(function* () {
    const { browserContext } = yield* Playwright.BrowserContext

    const isDevtools = (p: PW.Page) => p.url().startsWith('devtools://devtools/bundled/devtools_app.html')
    const isUnused = (p: PW.Page) => !usedPages.has(p)

    const newPage = Effect.gen(function* () {
      // const pageEventFiber = yield* Effect.callback((cb) => {
      //   browserContext.on('page', () => cb(Effect.void))
      // }).pipe(Effect.forkChild)

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
    }).pipe(Effect.forkChild)

    usedPages.add(page)

    yield* Effect.tryPromise(() => page.goto(makeDevtoolsFixtureUrl(url, tabName, adapter)))

    const openPages = browserContext.pages().map((_) => _.url())
    const devtools =
      browserContext.pages().filter(isUnused).find(isDevtools) ??
      shouldNeverHappen('No devtools page found. Current pages:', openPages)

    const devtoolsConsoleFiber = yield* Playwright.handlePageConsole({
      page: devtools,
      name: `${tabName}-devtools`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.forkChild)

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
      await devtools
        .getByRole('button', { name: 'Undock into separate window' })
        .describe(`${label}:Undock into separate window`)
        .click()

      const liveStoreDevtoolsPromise = new Promise<PW.Frame>((resolve) => {
        devtools.on('framenavigated', (frame) => {
          if (frame.url().includes('_livestore/browser-extension') === true) {
            resolve(frame)
          }
        })
      })

      await devtools.getByRole('tab', { name: 'LiveStore' }).click()

      return await liveStoreDevtoolsPromise
    })
  })

const runTest =
  <E>(eff: Effect.Effect<void, E, Playwright.BrowserContext>) =>
  (
    {}: PW.PlaywrightTestArgs & PW.PlaywrightTestOptions & PW.PlaywrightWorkerArgs & PW.PlaywrightWorkerOptions,
    testInfo: PW.TestInfo,
  ) => {
    const outerLayer = Layer.mergeAll(
      Logger.layer([Logger.consolePretty()]),
      PlatformNode.NodeServices.layer,
      FetchHttpClient.layer,
    )

    return Effect.gen(function* () {
      const parentSpanContext = (yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
        process.env.SPAN_CONTEXT_JSON ?? '{}',
      )) as otel.SpanContext
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
    }).pipe(Effect.tapCauseLogPretty, Effect.provide(outerLayer), Effect.runPromise)
  }

const getExtensionPath = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  const extensionPathFromEnv = process.env.LIVESTORE_DEVTOOLS_CHROME_DIST_PATH
  if (extensionPathFromEnv !== undefined) {
    yield* Effect.logInfo(`Using extension path from env LIVESTORE_DEVTOOLS_CHROME_DIST_PATH: ${extensionPathFromEnv}`)
    return extensionPathFromEnv
  }

  const defaultExtensionPath = LIVESTORE_DEVTOOLS_CHROME_DIST_PATH
  if ((yield* fileSystem.exists(defaultExtensionPath)) === false) {
    yield* Effect.logInfo(`Downloading Chrome extension to ${defaultExtensionPath}`)
    yield* downloadChromeExtension({ targetDir: defaultExtensionPath })
  }
  return defaultExtensionPath
}).pipe(
  Effect.tap((extensionPath) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      if ((yield* fileSystem.exists(extensionPath)) === false) {
        return yield* new TestError({ message: `Chrome extension not found at ${extensionPath}` })
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
      launchOptions: { args: ['--auto-open-devtools-for-tabs'] },
    })
  }).pipe(Layer.unwrap)

;(['persisted', 'inmemory'] as const).forEach((adapter) => {
  test(
    `single tab (adapter=${adapter})`,
    runTest(
      Effect.gen(function* () {
        const tab1 = yield* makeTabPair(
          `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
          'tab-1',
          adapter,
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
              tables: ['todos (1)'],
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
    `single tab (two stores) (adapter=${adapter})`,
    runTest(
      Effect.gen(function* () {
        const tab1 = yield* makeTabPair(
          `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
          'tab-1',
          adapter,
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
    `two tabs (adapter=${adapter})`,
    runTest(
      Effect.gen(function* () {
        const tab1 = yield* makeTabPair(
          `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
          'tab-1',
          adapter,
        )
        // Finish the first fixture boot before the second tab participates in leader election.
        // Keep this fixture-specific wait out of makeTabPair, which also opens pages without LiveStore.
        yield* Effect.tryPromise(() => tab1.page.locator('.new-todo').waitFor({ timeout: 10_000 }))
        const tab2 = yield* makeTabPair(
          `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
          'tab-2',
          adapter,
        )

        yield* Effect.tryPromise(async () => {
          const identities = await Promise.all(
            [tab1, tab2].map((tab) =>
              tab.page.evaluate((storeId) => {
                const store = globalThis.__debugLiveStore![storeId]!
                return { clientId: store.clientId, sessionId: store.sessionId }
              }, appStoreId),
            ),
          )
          expect(identities[0]!.clientId === identities[1]!.clientId).toBe(adapter === 'persisted')
          expect(identities[0]!.sessionId).not.toBe(identities[1]!.sessionId)

          // Autoconnect chooses the first discovered origin-wide session, not necessarily this tab.
          for (const [index, tab] of [tab1, tab2].entries()) {
            const { clientId, sessionId } = identities[index]!
            await tab.liveStoreDevtools.getByRole('button', { name: /Client session selector/ }).click()
            await tab.liveStoreDevtools
              .getByRole('option', { name: `${appStoreId}:${clientId}:${sessionId}:default`, exact: true })
              .click()
          }

          await tab1.page.focus('body')

          const el = tab1.page.locator('.new-todo').describe('tab-1:new-todo')
          await el.waitFor({ timeout: 10_000 })

          await el.fill('Buy milk')
          await el.press('Enter')

          await tab1.page.locator('.todo-list li label:text("Buy milk")').describe('tab-1:Buy milk').waitFor()
          if (adapter === 'persisted') {
            await tab2.page.locator('.todo-list li label:text("Buy milk")').describe('tab-2:Buy milk').waitFor()
          } else {
            // In-memory tabs have separate databases and leaders, with no sync backend.
            await expect(tab2.page.locator('.todo-list li')).toHaveCount(0)
            await tab2.page.locator('.new-todo').fill('Buy eggs')
            await tab2.page.locator('.new-todo').press('Enter')
            await tab2.page.locator('.todo-list li label:text("Buy eggs")').waitFor()
            await expect(tab1.page.locator('.todo-list li label:text("Buy eggs")')).toHaveCount(0)
          }

          const tables = [adapter === 'persisted' ? 'uiState (2)' : 'uiState (1)', 'todos (1)']

          await checkDevtoolsState({
            devtools: tab1.liveStoreDevtools,
            label: 'devtools-tab-1',
            expect: { leader: true, alreadyLoaded: false, tables },
          })
          await checkDevtoolsState({
            devtools: tab2.liveStoreDevtools,
            label: 'devtools-tab-2',
            expect: { leader: adapter === 'inmemory', alreadyLoaded: false, tables },
          })

          await test.step('tab-1:reload', async () => {
            await tab1.page.reload()
          })

          if (adapter === 'persisted') {
            await tab1.page.locator('.todo-list li label:text("Buy milk")').describe('tab-1:Buy milk').waitFor()
          } else {
            await tab1.page.locator('.new-todo').waitFor({ timeout: 10_000 })
            await expect(tab1.page.locator('.todo-list li')).toHaveCount(0)
            await tab1.page.locator('.new-todo').fill('Buy bread')
            await tab1.page.locator('.new-todo').press('Enter')
            await tab1.page.locator('.todo-list li label:text("Buy bread")').waitFor()
            await tab2.page.locator('.todo-list li label:text("Buy eggs")').waitFor()
          }

          await test.step('devtools-tab-2:reload', async () => {
            await tab2.devtools.reload()
          })

          tab2.liveStoreDevtools = await getLiveStoreDevtoolsFrame(tab2.devtools, 'devtools-tab-2').pipe(
            Effect.runPromise,
          )
          await tab2.liveStoreDevtools.getByRole('button', { name: /Client session selector/ }).click()
          await tab2.liveStoreDevtools
            .getByRole('option', {
              name: `${appStoreId}:${identities[1]!.clientId}:${identities[1]!.sessionId}:default`,
              exact: true,
            })
            .click()

          await checkDevtoolsState({
            devtools: tab1.liveStoreDevtools,
            label: 'devtools-tab-1',
            expect: { leader: adapter === 'inmemory', alreadyLoaded: false, tables },
          })
          await checkDevtoolsState({
            devtools: tab2.liveStoreDevtools,
            label: 'devtools-tab-2',
            expect: { leader: true, alreadyLoaded: false, tables },
          })
        }).pipe(
          process.env.CI !== undefined
            ? identity
            : Effect.tapErrorTag('UnknownError', () => Effect.promise(() => tab1.page.pause())),
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
    `sessions list is origin isolated (adapter=${adapter})`,
    runTest(
      Effect.gen(function* () {
        const port = process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT
        if (port == null) {
          return yield* new TestError({ message: 'LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT not set' })
        }

        // Open two tabs on different origins
        const tabLocalhost = yield* makeTabPair(`http://localhost:${port}/devtools/todomvc`, 'tab-localhost', adapter)
        const tabLoopback = yield* makeTabPair(`http://127.0.0.1:${port}/devtools/todomvc`, 'tab-127', adapter)

        yield* Effect.tryPromise(async () => {
          // Ensure both apps are ready and activate a session
          const input1 = tabLocalhost.page.locator('.new-todo').describe('tab-localhost:new-todo')
          await input1.waitFor({ timeout: 20_000 })
          const input2 = tabLoopback.page.locator('.new-todo').describe('tab-127:new-todo')
          await input2.waitFor({ timeout: 20_000 })

          await input1.fill('Buy milk')
          await input1.press('Enter')
          await tabLocalhost.page.locator('.todo-list li label:text("Buy milk")').waitFor()

          // Derive labels used in the session links
          const [localClientId, localSessionId] = await tabLocalhost.page.evaluate<[string, string], string>(
            (storeId) => {
              const store = (window as any).__debugLiveStore[storeId]
              return [store.clientId, store.sessionId]
            },
            appStoreId,
          )
          const [loopClientId, loopSessionId] = await tabLoopback.page.evaluate<[string, string], string>((storeId) => {
            const store = (window as any).__debugLiveStore[storeId]
            return [store.clientId, store.sessionId]
          }, appStoreId)

          const localLabel = `${localClientId}:${localSessionId}`
          const loopLabel = `${loopClientId}:${loopSessionId}`

          // Navigate DevTools frames to the sessions index route
          const toIndexUrl = (u: string) => {
            const cur = new URL(u)
            const base = new URL('/_livestore/browser-extension/', cur.origin)
            const tabId = cur.searchParams.get('tabId')
            if (tabId !== null) base.searchParams.set('tabId', tabId)
            return base.toString()
          }
          await tabLocalhost.liveStoreDevtools.goto(toIndexUrl(tabLocalhost.liveStoreDevtools.url()))
          await tabLoopback.liveStoreDevtools.goto(toIndexUrl(tabLoopback.liveStoreDevtools.url()))

          // Isolation assertions: specific items must appear / not appear
          await expect(tabLocalhost.liveStoreDevtools.getByText(localLabel, { exact: false }).first()).toBeVisible({
            timeout: 60_000,
          })
          await expect(tabLocalhost.liveStoreDevtools.getByText(loopLabel, { exact: false })).toHaveCount(0)

          await expect(tabLoopback.liveStoreDevtools.getByText(loopLabel, { exact: false }).first()).toBeVisible({
            timeout: 60_000,
          })
          await expect(tabLoopback.liveStoreDevtools.getByText(localLabel, { exact: false })).toHaveCount(0)
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
})

test(
  'no livestore',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/no-livestore`,
        'tab-1',
        'inmemory',
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

test(
  'protocol mismatch overlay',
  runTest(
    Effect.gen(function* () {
      const fakeAppVersion = '0.0.0-fake-version'

      const tab1 = yield* makeTabPair(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`,
        'tab-protocol-mismatch',
        'inmemory',
        { appDevtoolsProtocolVersionOverride: 999, appVersionOverride: fakeAppVersion },
      )

      yield* Effect.tryPromise(async () => {
        // Wait for the app to load
        const el = tab1.page.locator('.new-todo').describe('tab-protocol-mismatch:new-todo')
        await el.waitFor({ timeout: 10_000 })

        // The browser extension auto-connects to the session, so wait for the compatibility overlay.
        await checkProtocolMismatchOverlay({
          devtools: tab1.liveStoreDevtools,
          label: 'devtools-protocol-mismatch',
          expect: {
            devtoolsVersion: '0.4', // Partial match for the real DevTools version
            appVersion: fakeAppVersion,
          },
        })
      }).pipe(Effect.raceFirst(Fiber.joinAll([tab1.pageConsoleFiber, tab1.devtoolsConsoleFiber])))
    }),
  ),
)
