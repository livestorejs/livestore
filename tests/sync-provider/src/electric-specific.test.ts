import { SyncBackend } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent, nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import type * as ElectricSync from '@livestore/sync-electric'
import {
  Effect,
  FetchHttpClient,
  type HttpClient,
  KeyValueStore,
  Layer,
  Logger,
  LogLevel,
  ManagedRuntime,
  Option,
  Stream,
} from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import * as ElectricProvider from './providers/electric.ts'
import { SyncProviderImpl } from './types.ts'

const withTestCtx = ({ suffix }: { suffix?: string } = {}) =>
  Vitest.makeWithTestCtx({
    suffix,
    // timeout: testTimeout,
    // makeLayer: (testContext) => makeFileLogger('runner', { testContext }),
    makeLayer: (_testContext) => Layer.mergeAll(Logger.prettyWithThread('test-runner'), KeyValueStore.layerMemory),
  })

// ElectricSQL-specific tests for delete/update operations
Vitest.describe('ElectricSQL specific error handling', { timeout: 60000 }, () => {
  let runtime: ManagedRuntime.ManagedRuntime<SyncProviderImpl | HttpClient.HttpClient, never>
  let testId: string

  Vitest.beforeAll(async () => {
    testId = nanoid()
    runtime = ManagedRuntime.make(
      ElectricProvider.layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(OtelLiveHttp({ rootSpanName: 'beforeAll', serviceName: 'vitest-runner', skipLogUrl: false })),
        Layer.provide(Logger.prettyWithThread('test-runner')),
        Layer.provide(Logger.minimumLogLevel(LogLevel.Debug)),
        Layer.orDie,
      ),
    )
    // Eagerly start the runtime
    await runtime.runPromise(Effect.void)
  })

  Vitest.afterAll(async () => {
    if (runtime) {
      await runtime.dispose()
    }
  })

  const makeElectricProvider = ({ storeId }: { storeId: string }) =>
    Effect.suspend(() =>
      Effect.andThen(SyncProviderImpl, (_) =>
        _.makeProvider({
          // Isolated store for each test to avoid conflicts
          storeId,
          clientId: 'test-client',
          payload: undefined,
        }),
      ).pipe(Effect.provide(runtime)),
    )

  Vitest.scopedLive.skip('should throw descriptive error when detecting delete operations', (test) =>
    Effect.gen(function* () {
      const storeId = `test-store-electric-${test.task.name}-${testId}`
      const syncBackend: SyncBackend.SyncBackend<ElectricSync.SyncMetadata> = yield* makeElectricProvider({ storeId })
      const provider = yield* Effect.provide(SyncProviderImpl, runtime)

      // Push a valid event first
      yield* syncBackend.push([
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...events.todoCreated({ id: 'delete-test', text: 'Will be deleted', completed: false }),
          clientId: 'test-client',
          sessionId: 'test-session',
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
        }),
      ])

      const initialPullRes = yield* syncBackend.pull(Option.none()).pipe(Stream.runHead)

      // Get the test database connection and directly delete the row
      if (provider.getDbForTesting) {
        const db = provider.getDbForTesting(storeId)
        yield* db.migrate

        // Delete the row directly from Postgres (this is the problematic action)
        yield* Effect.tryPromise(() => db.sql`DELETE FROM ${db.sql(db.tableName)} WHERE "seqNum" = 1`)

        yield* db.disconnect

        // Now when we try to pull, ElectricSQL should detect the delete and we should get our error
        const pullResult = yield* syncBackend
          .pull(initialPullRes.pipe(Option.flatMap(SyncBackend.cursorFromPullResItem)))
          .pipe(
            Stream.runFirstUnsafe,
            Effect.flip, // Convert to get the error
          )

        expect(pullResult._tag).toBe('InvalidPullError')
        const cause = pullResult.cause as any
        expect(cause._tag).toBe('InvalidOperationError')
        expect(cause.operation).toBe('delete')
        expect(cause.message).toContain("ElectricSQL 'delete' event received")
        expect(cause.message).toContain('directly mutating the event log')
        expect(cause.message).toContain('Append a series of events that produce the desired state')
      } else {
        test.skip() // Skip if database utilities not available
      }
    }).pipe(withTestCtx()(test)),
  )

  // NOTE: This test is skipped because ElectricSQL doesn't seem to detect
  // direct SQL UPDATE operations as problematic in the same way as DELETE operations.
  // The update error handling is still implemented in the code for completeness.
  Vitest.scopedLive.skip('should throw descriptive error when detecting update operations', (test) =>
    Effect.gen(function* () {
      const storeId = `test-store-electric-${test.task.name}-${testId}`

      const syncBackend = yield* makeElectricProvider({ storeId })
      const provider = yield* Effect.provide(SyncProviderImpl, runtime)

      // Push a valid event first
      yield* syncBackend.push([
        LiveStoreEvent.AnyEncodedGlobal.make({
          ...events.todoCreated({ id: 'update-test', text: 'Will be updated', completed: false }),
          clientId: 'test-client',
          sessionId: 'test-session',
          seqNum: EventSequenceNumber.globalEventSequenceNumber(1),
          parentSeqNum: EventSequenceNumber.ROOT.global,
        }),
      ])

      const initialPullRes = yield* syncBackend.pull(Option.none()).pipe(Stream.runHead)

      // Get the test database connection and directly update the row
      if (provider.getDbForTesting) {
        const db = provider.getDbForTesting(storeId)
        yield* db.migrate

        // Update the row directly (another problematic action)
        yield* Effect.tryPromise(
          () => db.sql`UPDATE ${db.sql(db.tableName)} SET "name" = 'modified' WHERE "seqNum" = 1`,
        )

        yield* db.disconnect

        // Test that we get the update error
        const pullResult = yield* syncBackend
          .pull(initialPullRes.pipe(Option.flatMap(SyncBackend.cursorFromPullResItem)))
          .pipe(Stream.runFirstUnsafe, Effect.flip)

        expect(pullResult._tag).toBe('InvalidPullError')
        const cause = pullResult.cause as any
        expect(cause._tag).toBe('InvalidOperationError')
        expect(cause.operation).toBe('update')
        expect(cause.message).toContain("ElectricSQL 'update' event received")
        expect(cause.message).toContain('directly mutating the event log')
        expect(cause.message).toContain('Append a series of events that produce the desired state')
      } else {
        test.skip() // Skip if database utilities not available
      }
    }).pipe(withTestCtx()(test)),
  )
})
