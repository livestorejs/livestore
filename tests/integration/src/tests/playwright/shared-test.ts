import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import type { UnexpectedError } from '@livestore/common'
import * as Playwright from '@livestore/effect-playwright'
import { Deferred, Effect, Fiber, Layer, Logger, Schema } from '@livestore/utils/effect'
import type * as PW from '@playwright/test'

export const runTest =
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
      Effect.provide(Logger.prettyWithThread(thread)),
      Effect.runPromise,
    )
  }

const PWLive = Effect.gen(function* () {
  const persistentContextPath = fs.mkdtempSync(path.join(os.tmpdir(), '/livestore-playwright'))

  return Playwright.browserContextLayer({ persistentContextPath })
}).pipe(Layer.unwrapEffect)

export const runAndGetExit = <Tag extends string, A>({
  importPath,
  exportName,
  schema,
}: {
  importPath: string
  exportName: string
  schema: Schema.TaggedStruct<
    Tag,
    { exit: Schema.Exit<Schema.Schema<A>, typeof UnexpectedError, typeof Schema.Defect> }
  >
}) =>
  Effect.gen(function* () {
    const { browserContext } = yield* Playwright.BrowserContext
    const page = yield* Effect.promise(() => browserContext.newPage())

    yield* Effect.promise(() =>
      page.goto(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/dynamic-index-html?importPath=${importPath}&exportName=${exportName}`,
      ),
    )

    const pageConsoleFiber = yield* Playwright.handlePageConsole({ page, name: `tab-1` }).pipe(Effect.fork)

    return yield* Effect.gen(function* () {
      const deferred = yield* Deferred.make<(typeof schema.Type)['exit']>()

      page.exposeFunction('onMessageReceived', (message: string) => {
        const result = Schema.decodeUnknownOption(schema)(message)
        // console.log('onMessageReceived', message, result)
        if (result._tag === 'Some') {
          Deferred.succeed(deferred, result.value.exit).pipe(Effect.runSync)
        }
      })

      yield* Effect.promise(() =>
        page.evaluate(() => {
          window.addEventListener('message', (event) => {
            ;(globalThis as any).onMessageReceived(event.data)
          })
        }),
      )

      const exit = yield* Deferred.await(deferred).pipe(Effect.timeout(10_000))

      return exit
    }).pipe(Effect.raceFirst(Fiber.joinAll([pageConsoleFiber]) as Effect.Effect<never, Playwright.SiteError>))
  })
