import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import type { BootStatus } from '@livestore/common'
import { Effect, Logger, LogLevel, Queue, Schedule, Schema } from '@livestore/utils/effect'
import { ResultMultipleMigrations } from '../bridge.ts'
import LiveStoreWorker from '../livestore.worker.ts?worker'
import { schema } from '../schema.ts'
import LiveStoreWorkerAlt from './livestore-alt.worker.ts?worker'
import { schema as schemaAlt } from './schema-alt.ts'

export const testMultipleMigrations = () =>
  Effect.gen(function* () {
    // Test cleanup by creating many migrations and ensuring they all succeed
    // If cleanup isn't working, we'd hit OPFS capacity limits and get errors
    let migrationsCount = 0

    // Alternate between two schemas to trigger migrations
    const schemaAndWorkerPathPairs = Array.from({ length: 11 }, () => [
      { schema: schema, worker: LiveStoreWorker },
      { schema: schemaAlt, worker: LiveStoreWorkerAlt },
    ]).flat()

    for (const [index, { schema, worker }] of schemaAndWorkerPathPairs.entries()) {
      yield* Effect.gen(function* () {
        const bootStatusQueue = yield* Queue.unbounded<BootStatus>()

        yield* makePersistedAdapter({
          storage: { type: 'opfs' },
          worker,
          sharedWorker: LiveStoreSharedWorker,
          experimental: {
            awaitSharedWorkerTermination: true,
          },
        })({
          schema,
          storeId: 'migration-test',
          devtoolsEnabled: false,
          bootStatusQueue,
          shutdown: () => Effect.void,
          connectDevtoolsToStore: () => Effect.void,
          debugInstanceId: `migration-${index}`,
          syncPayload: undefined,
        })

        let hasMigrated = false
        // NOTE We can't use `Queue.takeAll` since sometimes it takes a bit longer for the updates to come in
        yield* Queue.take(bootStatusQueue).pipe(
          Effect.tap((status) => {
            if (status.stage === 'migrating') hasMigrated = true
          }),
          Effect.repeat(Schedule.forever.pipe(Schedule.untilInput((_: BootStatus) => _.stage === 'done'))),
          // Count a migration when we see a "done" status after a "migrating" status
          Effect.tapSync(() => {
            if (hasMigrated) migrationsCount++
          }),
        )
      }).pipe(Effect.scoped)
    }

    return {
      migrationsCount,
    }
  }).pipe(
    Effect.tapCauseLogPretty,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(ResultMultipleMigrations)(ResultMultipleMigrations.make({ exit })))
    }),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Logger.pretty),
    Effect.scoped,
    Effect.runPromise,
  )
