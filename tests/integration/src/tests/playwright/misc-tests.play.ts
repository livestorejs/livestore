import { UnexpectedError } from '@livestore/common'
import { Effect, Exit } from '@livestore/utils/effect'
import { expect, test } from '@playwright/test'

import { runAndGetExit, runTest } from './shared-test.ts'
import * as Bridge from './unit-tests/bridge.ts'

const modulePrefix = '../unit-tests'

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
            migrations: [{ tableName: 'todos', hashes: { expected: -35_462_037_457, actual: undefined } }],
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

test(
  'schema-migration',
  runTest(
    Effect.gen(function* () {
      const exit = yield* runAndGetExit({
        importPath: `${modulePrefix}/schema-migration/index.ts`,
        exportName: 'testMultipleMigrations',
        schema: Bridge.ResultMultipleMigrations,
      })

      // Verify that after 22 migrations, we can still complete the process without running out of file handles
      // See packages/@livestore/sqlite-wasm/src/browser/opfs/AccessHandlePoolVFS.ts for default file handle pool size
      expect(exit).toStrictEqual(
        Exit.succeed({
          migrationsCount: 22,
        }),
      )
    }),
  ),
)

test(
  'duplicate-tab rekeys session id',
  runTest(
    Effect.gen(function* () {
      const exit = yield* runAndGetExit({
        importPath: `${modulePrefix}/duplicate-tab.ts`,
        exportName: 'testDuplicateTab',
        schema: Bridge.ResultDuplicateSessionId,
      })

      expect(Exit.isSuccess(exit)).toBe(true)

      if (Exit.isSuccess(exit) === false) {
        return
      }

      const { firstSessionId, secondSessionId, sessionStorageBeforeSecond, sessionStorageAfterSecond, workerNames } =
        exit.value

      expect(sessionStorageBeforeSecond).toBe(firstSessionId)
      expect(sessionStorageAfterSecond).toBe(secondSessionId)
      expect(secondSessionId).not.toBe(firstSessionId)

      expect(workerNames).toHaveLength(2)
      const [firstWorker, secondWorker] = workerNames

      if (firstWorker === undefined || secondWorker === undefined) {
        return
      }

      expect(firstWorker).toEqual(expect.objectContaining({ tab: 'first' as const }))
      expect(firstWorker.name).toContain(firstSessionId)
      expect(secondWorker).toEqual(expect.objectContaining({ tab: 'second' as const }))
      expect(secondWorker.name).toContain(secondSessionId)
      expect(secondWorker.name).not.toContain(firstSessionId)
    }),
  ),
)
