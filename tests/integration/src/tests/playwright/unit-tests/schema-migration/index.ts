import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import type { BootStatus } from '@livestore/common'
import { liveStoreStorageFormatVersion, UnexpectedError } from '@livestore/common'
import { Effect, Logger, LogLevel, Opfs, Queue, Schedule, Schema } from '@livestore/utils/effect'
import { ResultMultipleMigrations } from '../bridge.ts'
import LiveStoreWorker from '../livestore.worker.ts?worker'
import { schema } from '../schema.ts'
import LiveStoreWorkerAlt from './livestore-alt.worker.ts?worker'
import { schema as schemaAlt } from './schema-alt.ts'

const storeId = 'migration-test'

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
          storeId,
          devtoolsEnabled: false,
          bootStatusQueue,
          shutdown: () => Effect.void,
          connectDevtoolsToStore: () => Effect.void,
          debugInstanceId: `migration-${index}`,
          syncPayloadEncoded: undefined,
          syncPayloadSchema: undefined,
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
      archivedStateDbFiles: yield* collectArchiveSnapshot,
    }
  }).pipe(
    Effect.tapCauseLogPretty,
    UnexpectedError.mapToUnexpectedError,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(ResultMultipleMigrations)(ResultMultipleMigrations.make({ exit })))
    }),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Opfs.Opfs.Default),
    Effect.provide(Logger.pretty),
    Effect.scoped,
    Effect.runPromise,
  )

const collectArchiveSnapshot = Effect.gen(function* () {
  const opfs = yield* Opfs.Opfs
  const segments = [`livestore-${storeId}@${liveStoreStorageFormatVersion}`, 'archive']

  let handle = yield* opfs.getRootDirectoryHandle
  for (const segment of segments) {
    handle = yield* opfs.getDirectoryHandle(handle, segment)
  }

  const entries = yield* opfs.listEntries(handle)
  const files: { name: string; size: number; lastModified: number }[] = []

  for (const entry of entries) {
    if (entry.kind !== 'file') continue
    const fileHandle = entry.handle
    const file = yield* opfs.getFile(fileHandle)
    files.push({ name: entry.name, size: file.size, lastModified: file.lastModified })
  }

  return files
}).pipe(
  Effect.catchTag('@livestore/utils/Browser/NotFoundError', () => Effect.succeed([])),
  UnexpectedError.mapToUnexpectedError,
)
