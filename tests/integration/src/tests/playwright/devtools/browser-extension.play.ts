import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as Playwright from '@livestore/effect-playwright'
import { envTruish, shouldNeverHappen } from '@livestore/utils'
import { Effect, Fiber, Layer, Logger } from '@livestore/utils/effect'
import type * as PW from '@playwright/test'
import { test } from '@playwright/test'

import { checkDevtoolsState } from './shared.js'

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

      const page = yield* Effect.promise(() => browserContext.newPage())
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

    yield* Effect.promise(() => page.goto(url))

    const devtools =
      browserContext.pages().filter(isUnused).find(isDevtools) ??
      shouldNeverHappen(`No devtools page found. Current pages: ${browserContext.pages().map((_) => _.url())}`)

    const devtoolsConsoleFiber = yield* Playwright.handlePageConsole({
      page: devtools,
      name: `${tabName}-devtools`,
      shouldEvaluateArgs: false,
    }).pipe(Effect.fork)

    usedPages.add(devtools)

    const liveStoreDevtools = yield* getLiveStoreDevtoolsFrame(devtools)

    return { page, devtools, liveStoreDevtools, pageConsoleFiber, devtoolsConsoleFiber }
  })

// Based on https://gist.github.com/mxschmitt/f891a2f8fb37ce01ed026627f75d7ce6
const getLiveStoreDevtoolsFrame = (devtools: PW.Page) =>
  Effect.promise(async () => {
    await devtools.getByRole('button', { name: 'Customize and control DevTools' }).first().click()
    await devtools.getByTitle('Undock into separate window').click()

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

const runTest =
  (eff: Effect.Effect<void, unknown, Playwright.BrowserContext>) =>
  (
    {}: PW.PlaywrightTestArgs & PW.PlaywrightTestOptions & PW.PlaywrightWorkerArgs & PW.PlaywrightWorkerOptions,
    testInfo: PW.TestInfo,
  ) => {
    if (envTruish(process.env.LIVESTORE_DEVTOOLS_CHROME_DIST_PATH) === false) {
      console.log('LIVESTORE_DEVTOOLS_CHROME_DIST_PATH is not set, skipping test')
    }

    const thread = `playwright-worker-${testInfo.workerIndex}`
    // @ts-expect-error TODO fix types
    globalThis.name = thread

    return eff.pipe(
      Effect.withSpan(testInfo.title),
      Effect.scoped,
      Effect.provide(PWLive),
      Effect.tapCauseLogPretty,
      Effect.annotateLogs({ thread }),
      Effect.provide(Logger.pretty),
      Effect.runPromise,
    )
  }

const PWLive = Effect.gen(function* () {
  const persistentContextPath = fs.mkdtempSync(path.join(os.tmpdir(), '/livestore-playwright'))
  const extensionPath = process.env.LIVESTORE_DEVTOOLS_CHROME_DIST_PATH

  return Playwright.browserContextLayer({ persistentContextPath, extensionPath, launchOptions: { devtools: true } })
}).pipe(Layer.unwrapEffect)

test(
  'single tab',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(`http://localhost:${process.env.DEV_SERVER_PORT}/`, 'tab-1')

      yield* Effect.promise(async () => {
        const el = tab1.page.locator('.new-todo')
        await el.waitFor({ timeout: 10_000 })

        await el.fill('Buy milk')
        await el.press('Enter')

        await tab1.page.locator('.todo-list li label:text("Buy milk")').waitFor()

        await checkDevtoolsState({
          devtools: tab1.liveStoreDevtools,
          expect: { leader: true, alreadyLoaded: false, tables: ['uiState (1)', 'todos (1)'] },
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
  ),
)

test(
  'two tabs',
  runTest(
    Effect.gen(function* () {
      const tab1 = yield* makeTabPair(`http://localhost:${process.env.DEV_SERVER_PORT}/`, 'tab-1')
      const tab2 = yield* makeTabPair(`http://localhost:${process.env.DEV_SERVER_PORT}/`, 'tab-2')

      yield* Effect.promise(async () => {
        await tab1.page.focus('body')

        const el = tab1.page.locator('.new-todo')
        await el.waitFor({ timeout: 10_000 })

        await el.fill('Buy milk')
        await el.press('Enter')

        await tab1.page.locator('.todo-list li label:text("Buy milk")').waitFor()
        await tab2.page.locator('.todo-list li label:text("Buy milk")').waitFor()

        const tables = ['uiState (2)', 'todos (1)']

        await checkDevtoolsState({
          devtools: tab1.liveStoreDevtools,
          expect: { leader: true, alreadyLoaded: false, tables },
        })
        await checkDevtoolsState({
          devtools: tab2.liveStoreDevtools,
          expect: { leader: false, alreadyLoaded: false, tables },
        })

        await tab1.page.reload()
        await tab1.page.locator('.todo-list li label:text("Buy milk")').waitFor()

        await tab2.devtools.reload()
        tab2.liveStoreDevtools = await getLiveStoreDevtoolsFrame(tab2.devtools).pipe(Effect.runPromise)

        await checkDevtoolsState({
          devtools: tab1.liveStoreDevtools,
          expect: { leader: false, alreadyLoaded: false, tables },
        })
        await checkDevtoolsState({
          devtools: tab2.liveStoreDevtools,
          expect: { leader: true, alreadyLoaded: false, tables },
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
  ),
)
