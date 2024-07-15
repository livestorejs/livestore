import process from 'node:process'

import { Deferred, Effect, Exit, Schema } from '@livestore/utils/effect'
import { expect, test } from '@playwright/test'

import { Bridge } from './shared.js'

const modulePrefix = './src/tests/playwright/'

test('basic', ({ page }) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      page.goto(`http://localhost:${process.env.DEV_SERVER_PORT}/?importPath=${modulePrefix}basic.ts`),
    )

    const deferred = yield* Deferred.make<(typeof Bridge.Result.Type)['exit']>()

    page.exposeFunction('onMessageReceived', (message: string) => {
      const result = Schema.decodeUnknownOption(Bridge.Result)(message)
      // console.log('onMessageReceived', message)

      if (result._tag === 'Some') {
        Deferred.succeed(deferred, result.value.exit).pipe(Effect.runSync)
      }
    })

    yield* Effect.promise(() =>
      page.evaluate(() => {
        window.addEventListener('message', (event) => {
          ;(window as any).onMessageReceived(event.data)
        })
      }),
    )

    const exit = yield* Deferred.await(deferred)

    expect(exit).toStrictEqual(
      Exit.succeed({
        bootStatusUpdates: [
          { stage: 'loading' },
          { stage: 'migrating', progress: { done: 1, total: 1 } },
          { stage: 'done' },
        ],
      }),
    )
  }).pipe(Effect.tapCauseLogPretty, Effect.runPromise))
