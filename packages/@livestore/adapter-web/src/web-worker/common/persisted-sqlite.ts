import { liveStoreStorageFormatVersion } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import {
  decodeAccessHandlePoolFilename,
  HEADER_OFFSET_DATA,
  type WebDatabaseMetadataOpfs,
} from '@livestore/sqlite-wasm/browser'
import { isDevEnv } from '@livestore/utils'
import { Chunk, Effect, Opfs, Option, Order, Schedule, Schema, Stream, type WebError } from '@livestore/utils/effect'
import type * as WorkerSchema from './worker-schema.ts'

export class PersistedSqliteError extends Schema.TaggedError<PersistedSqliteError>()('PersistedSqliteError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export const readPersistedStateDbFromClientSession: (args: {
  storageOptions: WorkerSchema.StorageType
  storeId: string
  schema: LiveStoreSchema
}) => Effect.Effect.AsEffect<
  Effect.Effect<
    Uint8Array<ArrayBuffer>,
    | PersistedSqliteError
    | WebError.UnknownError
    | WebError.TypeError
    | WebError.NotFoundError
    | WebError.NotAllowedError
    | WebError.TypeMismatchError
    | WebError.SecurityError
    | Opfs.OpfsError,
    Opfs.Opfs
  >
> = Effect.fn('@livestore/adapter-web:readPersistedStateDbFromClientSession')(
  function* ({ storageOptions, storeId, schema }) {
    const accessHandlePoolDirString = yield* sanitizeOpfsDir(storageOptions.directory, storeId)

    const accessHandlePoolDirHandle = yield* Opfs.getDirectoryHandleByPath(accessHandlePoolDirString)

    const stateDbFileName = `/${getStateDbFileName(schema)}`

    const handlesStream = yield* Opfs.Opfs.values(accessHandlePoolDirHandle)

    const stateDbFileOption = yield* handlesStream.pipe(
      Stream.filter((handle): handle is FileSystemFileHandle => handle.kind === 'file'),
      Stream.mapEffect(
        (fileHandle) =>
          Effect.gen(function* () {
            const file = yield* Opfs.Opfs.getFile(fileHandle)
            const fileName = yield* Effect.promise(() => decodeAccessHandlePoolFilename(file))
            return { file, fileName }
          }),
        { concurrency: 'unbounded' },
      ),
      Stream.find(({ fileName }) => fileName === stateDbFileName),
      Stream.runHead,
    )

    if (Option.isNone(stateDbFileOption)) {
      return yield* new PersistedSqliteError({
        message: `State database file not found in client session (expected '${stateDbFileName}' in '${accessHandlePoolDirString}')`,
      })
    }

    const stateDbBuffer = yield* Effect.promise(() =>
      stateDbFileOption.value.file.slice(HEADER_OFFSET_DATA).arrayBuffer(),
    )

    // Given the access handle pool always eagerly creates files with empty non-header data,
    // we want to return undefined if the file exists but is empty
    if (stateDbBuffer.byteLength === 0) {
      return yield* new PersistedSqliteError({
        message: `State database file is empty in client session (expected '${stateDbFileName}' in '${accessHandlePoolDirString}')`,
      })
    }

    return new Uint8Array(stateDbBuffer)
  },
  Effect.logWarnIfTakesLongerThan({
    duration: 1000,
    label: '@livestore/adapter-web:readPersistedStateDbFromClientSession',
  }),
  Effect.withPerformanceMeasure('@livestore/adapter-web:readPersistedStateDbFromClientSession'),
)

export const resetPersistedDataFromClientSession = Effect.fn(
  '@livestore/adapter-web:resetPersistedDataFromClientSession',
)(
  function* ({ storageOptions, storeId }: { storageOptions: WorkerSchema.StorageType; storeId: string }) {
    const directory = yield* sanitizeOpfsDir(storageOptions.directory, storeId)
    yield* Opfs.remove(directory).pipe(
      // We ignore NotFoundError here as it may not exist or have already been deleted
      Effect.catchTag('@livestore/utils/Web/NotFoundError', () => Effect.void),
    )
  },
  Effect.retry({
    schedule: Schedule.exponentialBackoff10Sec,
  }),
)

export const sanitizeOpfsDir = Effect.fn('@livestore/adapter-web:sanitizeOpfsDir')(function* (
  directory: string | undefined,
  storeId: string,
) {
  if (directory === undefined || directory === '' || directory === '/') {
    return `livestore-${storeId}@${liveStoreStorageFormatVersion}`
  }

  if (directory.includes('/')) {
    return yield* new PersistedSqliteError({
      message: `Nested directories are not yet supported ('${directory}')`,
    })
  }

  return `${directory}@${liveStoreStorageFormatVersion}`
})

export const getStateDbFileName = (schema: LiveStoreSchema) => {
  const schemaHashSuffix =
    schema.state.sqlite.migrations.strategy === 'manual' ? 'fixed' : schema.state.sqlite.hash.toString()
  return `state${schemaHashSuffix}.db`
}

export const MAX_ARCHIVED_STATE_DBS_IN_DEV = 3
export const ARCHIVE_DIR_NAME = 'archive'

/**
 * Cleanup old state database files after successful migration.
 * This prevents OPFS file pool capacity from being exhausted by accumulated schema files.
 *
 * @param vfs - The AccessHandlePoolVFS instance for safe file operations
 * @param currentSchema - Current schema (to avoid deleting the active database)
 */
export const cleanupOldStateDbFiles = Effect.fn('@livestore/adapter-web:cleanupOldStateDbFiles')(function* ({
  vfs,
  currentSchema,
  opfsDirectory,
}: {
  vfs: WebDatabaseMetadataOpfs['vfs']
  currentSchema: LiveStoreSchema
  opfsDirectory: string
}) {
  // Only cleanup for auto migration strategy because:
  // - Auto strategy: Creates new database files per schema change (e.g., state123.db, state456.db)
  //   which accumulate over time and can exhaust OPFS file pool capacity
  // - Manual strategy: Always reuses the same database file (statefixed.db) across schema changes,
  //   so there are never multiple old files to clean up
  if (currentSchema.state.sqlite.migrations.strategy === 'manual') {
    yield* Effect.logDebug('Skipping state db cleanup - manual migration strategy uses fixed filename')
    return
  }

  const isDev = isDevEnv()
  const currentDbFileName = getStateDbFileName(currentSchema)
  const currentPath = `/${currentDbFileName}`

  const allPaths = yield* Effect.sync(() => vfs.getTrackedFilePaths())
  const oldStateDbPaths = allPaths.filter(
    (path) => path.startsWith('/state') && path.endsWith('.db') && path !== currentPath,
  )

  if (oldStateDbPaths.length === 0) {
    yield* Effect.logDebug('No old database files found')
    return
  }

  const absoluteArchiveDirName = `${opfsDirectory}/${ARCHIVE_DIR_NAME}`
  if (isDev && !(yield* Opfs.exists(absoluteArchiveDirName))) yield* Opfs.makeDirectory(absoluteArchiveDirName)

  for (const path of oldStateDbPaths) {
    const fileName = path.startsWith('/') ? path.slice(1) : path

    if (isDev) {
      const archiveFileData = yield* vfs.readFilePayload(fileName)

      const archiveFileName = `${Date.now()}-${fileName}`

      yield* Opfs.writeFile(`${opfsDirectory}/archive/${archiveFileName}`, new Uint8Array(archiveFileData))
    }

    const vfsResultCode = yield* Effect.try({
      try: () => vfs.jDelete(fileName, 0),
      catch: (cause) =>
        new PersistedSqliteError({ message: `Failed to delete old state database file: ${fileName}`, cause }),
    })

    // 0 indicates a successful result in SQLite.
    // See https://www.sqlite.org/c3ref/c_abort.html
    if (vfsResultCode !== 0) {
      return yield* new PersistedSqliteError({
        message: `Failed to delete old state database file: ${fileName}, got result code: ${vfsResultCode}`,
      })
    }

    yield* Effect.logDebug(`Deleted old state database file: ${fileName}`)
  }

  if (isDev) {
    yield* pruneArchiveDirectory({
      archiveDirectory: absoluteArchiveDirName,
      keep: MAX_ARCHIVED_STATE_DBS_IN_DEV,
    })
  }
})

const pruneArchiveDirectory = Effect.fn('@livestore/adapter-web:pruneArchiveDirectory')(function* ({
  archiveDirectory,
  keep,
}: {
  archiveDirectory: string
  keep: number
}) {
  const archiveDirHandle = yield* Opfs.getDirectoryHandleByPath(archiveDirectory)
  const handlesStream = yield* Opfs.Opfs.values(archiveDirHandle)
  const filesWithMetadata = yield* handlesStream.pipe(
    Stream.filter((handle): handle is FileSystemFileHandle => handle.kind === 'file'),
    Stream.mapEffect((fileHandle) => Opfs.getMetadata(fileHandle)),
    Stream.runCollect,
  )
  const filesToDelete = filesWithMetadata.pipe(
    Chunk.sort(Order.mapInput(Order.number, (entry: { lastModified: number }) => entry.lastModified)),
    Chunk.drop(keep),
    Chunk.toReadonlyArray,
  )

  if (filesToDelete.length === 0) return

  yield* Effect.forEach(filesToDelete, ({ name }) => Opfs.Opfs.removeEntry(archiveDirHandle, name))

  yield* Effect.logDebug(`Pruned ${filesToDelete.length} old database file(s) from archive directory`)
})
