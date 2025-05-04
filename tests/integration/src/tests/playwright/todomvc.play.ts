import * as Playwright from '@livestore/effect-playwright'
import { Effect, Fiber } from '@livestore/utils/effect'
import { test } from '@playwright/test'

import { runTest } from './shared-test.js'

test(
  'basic',
  runTest(
    Effect.gen(function* () {
      const { browserContext } = yield* Playwright.BrowserContext
      const page = yield* Effect.promise(() => browserContext.newPage())

      const pageConsoleFiber = yield* Playwright.handlePageConsole({ page, name: `tab-1` }).pipe(Effect.fork)

      yield* Effect.promise(async () => {
        await page.goto(`http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/devtools/todomvc`)
        // const el = await page.waitForSelector('.new-todo', { timeout: 5000 })
        const el = page.locator('.new-todo')
        await el.waitFor({ timeout: 10_000 })

        await el.fill('Buy milk')
        await el.press('Enter')

        await page.waitForSelector('.todo-list li label:text("Buy milk")')
      }).pipe(Effect.raceFirst(Fiber.joinAll([pageConsoleFiber])))
    }),
  ),
)
