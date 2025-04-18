import { UnexpectedError } from '@livestore/common'
import { Effect, Exit } from '@livestore/utils/effect'
import { expect, test } from '@playwright/test'

import { runAndGetExit, runTest } from './shared-test.js'
import { Bridge } from './unit-tests/shared.js'

const modulePrefix = './src/tests/playwright/unit-tests'

test(
  'bootstatus',
  runTest(
    Effect.gen(function* () {
      const exit = yield* runAndGetExit({
        importPath: `${modulePrefix}/bootstatus.ts`,
        exportName: 'test',
        schema: Bridge.ResultBootStatus,
      })

      expect(exit).toStrictEqual(
        Exit.succeed({
          bootStatusUpdates: [
            { stage: 'loading' },
            { stage: 'migrating', progress: { done: 1, total: 1 } },
            { stage: 'done' },
          ],
          migrationsReport: {
            migrations: [{ tableName: 'todos', hashes: { expected: 27_118_251_376, actual: undefined } }],
          },
        }),
      )
    }),
  ),
)

test(
  'store-boot-error',
  runTest(
    Effect.gen(function* () {
      const exit = yield* runAndGetExit({
        importPath: `${modulePrefix}/store-boot-error.ts`,
        exportName: 'test',
        schema: Bridge.ResultStoreBootError,
      })

      expect(exit).toStrictEqual(Exit.fail(UnexpectedError.make({ cause: new Error('Boom!') })))
    }),
  ),
)
