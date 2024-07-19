import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { Deferred, Effect, Exit, Logger, Runtime, Schema } from '@livestore/utils/effect'
import type { Page } from '@playwright/test'
import { chromium, expect, test } from '@playwright/test'

class SiteError extends Schema.TaggedError<SiteError>()('SiteError', {
  cause: Schema.CauseDefectUnknown,
}) {}

const supportedMessageTypes = new Set(['error', 'log', 'warn', 'info', 'debug'])
let page: Page

test.beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '/livestore-playwright'))
  console.log('Running Playwright tests in tmp dir:', tmpDir)
  // Launch a browser with a persistent context.
  const context = await chromium.launchPersistentContext(tmpDir, {})
  page = await context.newPage()
})

test('basic', ({}) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => page.goto(`https://todomvc.livestore.localhost/`))

    const listenForError = Effect.async<void, SiteError>((cb) => {
      page.on('console', async (message) => {
        const msgType = message.type()
        const msg = message.text()

        if (msgType === 'error') {
          cb(new SiteError({ cause: msg }))
        } else {
          if (supportedMessageTypes.has(msgType)) {
            ;(console as any)[msgType](msg)
          }
        }
      })

      page.on('pageerror', (cause) => cb(new SiteError({ cause })))
    })

    yield* Effect.promise(() => page.waitForLoadState('load'))

    const restTest = Effect.gen(function* () {
      yield* Effect.promise(async () => {
        // const el = await page.waitForSelector('.new-todo', { timeout: 5000 })
        const el = page.locator('.new-todo')
        await el.waitFor({ timeout: 3000 })

        await el.fill('Buy milk')
        await el.press('Enter')

        await page.waitForSelector('.todo-list li label:text("Buy milk")')
      })
    })

    yield* Effect.race(listenForError, restTest)

    // page.exposeFunction('onMessageReceived', (message: string) => {
    //   const result = Schema.decodeUnknownOption(Bridge.Result)(message)
    //   // console.log('onMessageReceived', message)

    //   if (result._tag === 'Some') {
    //     Deferred.succeed(deferred, result.value.exit).pipe(Effect.runSync)
    //   }
    // })

    // yield* Effect.promise(() =>
    //   page.evaluate(() => {
    //     window.addEventListener('message', (event) => {
    //       ;(window as any).onMessageReceived(event.data)
    //     })
    //   }),
    // )

    // const exit = yield* Deferred.await(deferred)

    // expect(exit).toStrictEqual(
    //   Exit.succeed({
    //     bootStatusUpdates: [
    //       { stage: 'loading' },
    //       { stage: 'migrating', progress: { done: 1, total: 1 } },
    //       { stage: 'done' },
    //     ],
    //   }),
    // )
  }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.provide(Logger.pretty), Effect.runPromise))
