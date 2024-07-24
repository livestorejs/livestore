import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// TODO use normal import path when Playwright ESM/tsconfig bug is fixed
import * as Playwright from '@livestore/effect-playwright'
import { Effect, Fiber, Layer, Logger } from '@livestore/utils/effect'
// import * as Playwright from '@livestore/effect-playwright'
import type * as PW from '@playwright/test'
import { test } from '@playwright/test'

const runTest =
  (eff: Effect.Effect<void, unknown, Playwright.BrowserContext>) =>
  (
    {}: PW.PlaywrightTestArgs & PW.PlaywrightTestOptions & PW.PlaywrightWorkerArgs & PW.PlaywrightWorkerOptions,
    testInfo: PW.TestInfo,
  ) => {
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

  return Playwright.browserContextLayer({ persistentContextPath })
}).pipe(Layer.unwrapEffect)

test(
  'basic',
  runTest(
    Effect.gen(function* () {
      const { browserContext } = yield* Playwright.BrowserContext
      const page = yield* Effect.promise(() => browserContext.newPage())

      const pageConsoleFiber = yield* Playwright.handlePageConsole(page, `tab-1`).pipe(Effect.fork)

      yield* Effect.promise(async () => {
        await page.goto(`http://localhost:60001/`)
        // const el = await page.waitForSelector('.new-todo', { timeout: 5000 })
        const el = page.locator('.new-todo')
        await el.waitFor({ timeout: 3000 })

        await el.fill('Buy milk')
        await el.press('Enter')

        await page.waitForSelector('.todo-list li label:text("Buy milk")')
      }).pipe(Effect.raceFirst(Fiber.joinAll([pageConsoleFiber])))
    }),
  ),
)
