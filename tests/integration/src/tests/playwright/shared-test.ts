import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import type * as PW from '@playwright/test'

import * as Playwright from '@livestore/effect-playwright'
import { Deferred, Duration, Effect, Fiber, Layer, Logger, Schema } from '@livestore/utils/effect'

// Allow for slowest observed misc test (schema-migration performs 22 OPFS migrations).
const runAndGetExitTimeoutMs = Duration.minutes(2)

export const runTest =
  <E>(eff: Effect.Effect<void, E, Playwright.BrowserContext>) =>
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
      Effect.provide(Logger.layer([Logger.consolePretty()])),
      Effect.runPromise,
    )
  }

/**
 * Own the profile before launching Chromium so launch failures also clean up.
 * Registered first, this finalizer runs after the browser context closes.
 * Remove profiles even on test failure: trace evidence lives in test-results.
 */
export const makePersistentContextPath = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), 'livestore-playwright'))),
  (persistentContextPath) =>
    Effect.sync(() => {
      fs.rmSync(persistentContextPath, { recursive: true, force: true })
      assert.equal(fs.existsSync(persistentContextPath), false, `Leaked Chromium profile: ${persistentContextPath}`)
    }),
)

const PWLive = Effect.gen(function* () {
  const persistentContextPath = yield* makePersistentContextPath

  return Playwright.browserContextLayer({ persistentContextPath })
}).pipe(Layer.unwrap)

export const runAndGetExit = <S extends Schema.Decoder<{ readonly exit: unknown }>>({
  importPath,
  exportName,
  schema,
}: {
  importPath: string
  exportName: string
  schema: S
}) =>
  Effect.gen(function* () {
    const { browserContext } = yield* Playwright.BrowserContext
    const page = yield* Effect.promise(() => browserContext.newPage())

    yield* Effect.promise(() =>
      page.goto(
        `http://localhost:${process.env.LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT}/dynamic-index-html?importPath=${importPath}&exportName=${exportName}`,
      ),
    )

    const pageConsoleFiber = yield* Playwright.handlePageConsole({ page, name: `tab-1` }).pipe(Effect.forkChild)

    return yield* Effect.gen(function* () {
      type Result = Schema.Schema.Type<S>
      const deferred = yield* Deferred.make<Result['exit']>()

      yield* Effect.promise(() =>
        page.exposeFunction('onMessageReceived', (message: string) => {
          const result = Schema.decodeOption(schema)(message)
          // console.log('onMessageReceived', message, result)
          if (result._tag === 'Some') {
            Deferred.succeed(deferred, result.value.exit).pipe(Effect.runSync)
          }
        }),
      )

      yield* Effect.promise(() =>
        page.evaluate(() => {
          window.addEventListener('message', (event) => {
            ;(globalThis as any).onMessageReceived(event.data)
          })
        }),
      )

      return yield* Deferred.await(deferred).pipe(Effect.timeout(runAndGetExitTimeoutMs))
    }).pipe(Effect.raceFirst(Fiber.joinAll([pageConsoleFiber]).pipe(Effect.andThen(Effect.never))))
  })
