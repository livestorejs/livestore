import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import type { BootStatus } from '@livestore/common'
import { liveStoreStorageFormatVersion, UnknownError } from '@livestore/common'
import { Effect, Layer, Logger, Queue, Schema, Stream } from '@livestore/utils/effect'
import { Opfs } from '@livestore/utils/effect/browser'

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
        while (true) {
          const status = yield* Queue.take(bootStatusQueue)
          if (status.stage === 'migrating') hasMigrated = true
          if (status.stage === 'done') break
        }

        // Count a migration when we see a "done" status after a "migrating" status
        if (hasMigrated === true) migrationsCount++
      }).pipe(Effect.scoped)
    }

    return {
      migrationsCount,
      archivedStateDbFiles: yield* collectArchiveSnapshot,
    }
  }).pipe(
    Effect.tapCauseLogPretty,
    UnknownError.mapToUnknownError,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(ResultMultipleMigrations)(ResultMultipleMigrations.make({ exit })))
    }),
    Logger.withMinimumLogLevel('Debug'),
    Effect.provide(Layer.mergeAll(Opfs.layer, Logger.layer([Logger.consolePretty()]))),
    Effect.scoped,
    Effect.runPromise,
  )

const collectArchiveSnapshot = Effect.gen(function* () {
  const segments = [`livestore-${storeId}@${liveStoreStorageFormatVersion}`, 'archive']

  let handle = yield* Opfs.getRootDirectoryHandle
  for (const segment of segments) {
    handle = yield* Opfs.getDirectoryHandle(handle, segment)
  }

  const handlesStream = yield* Opfs.values(handle)

  const fileChunks = yield* handlesStream.pipe(
    Stream.filter((handle): handle is FileSystemFileHandle => handle.kind === 'file'),
    Stream.mapEffect((fileHandle) =>
      Effect.gen(function* () {
        const file = yield* Opfs.getFile(fileHandle)
        return { name: fileHandle.name, size: file.size, lastModified: file.lastModified }
      }),
    ),
    Stream.runCollect,
  )

  return fileChunks
}).pipe(
  Effect.catch((error) =>
    typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'NotFoundError'
      ? Effect.succeed([])
      : Effect.fail(error),
  ),
  UnknownError.mapToUnknownError,
)
