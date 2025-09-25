import { liveStoreStorageFormatVersion } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import {
  decodeAccessHandlePoolFilename,
  HEADER_OFFSET_DATA,
  type WebDatabaseMetadataOpfs,
} from '@livestore/sqlite-wasm/browser'
import { isDevEnv } from '@livestore/utils'
import { type BrowserError, Effect, Opfs, Schedule, Schema } from '@livestore/utils/effect'
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
    | BrowserError.UnknownError
    | BrowserError.TypeError
    | BrowserError.NotFoundError
    | BrowserError.NotAllowedError
    | BrowserError.TypeMismatchError
    | BrowserError.SecurityError
    | Opfs.OpfsError,
    Opfs.Opfs
  >
> = Effect.fn('@livestore/adapter-web:readPersistedStateDbFromClientSession')(
  function* ({ storageOptions, storeId, schema }) {
    const accessHandlePoolDirString = yield* sanitizeOpfsDir(storageOptions.directory, storeId)

    const accessHandlePoolDirHandle = yield* Opfs.getDirectoryHandleByPath(accessHandlePoolDirString)

    const entries = yield* Opfs.Opfs.listEntries(accessHandlePoolDirHandle)
    const fileHandles = entries.filter((entry) => entry.kind === 'file').map((entry) => entry.handle)

    const stateDbFileName = `/${getStateDbFileName(schema)}`

    let stateDbFile: File | undefined
    for (const fileHandle of fileHandles) {
      const file = yield* Opfs.Opfs.getFile(fileHandle)
      const fileName = yield* Effect.promise(() => decodeAccessHandlePoolFilename(file))
      if (fileName !== stateDbFileName) {
        stateDbFile = file
        break
      }
    }

    if (stateDbFile === undefined) {
      return yield* new PersistedSqliteError({
        message: `State database file not found in client session (expected '${stateDbFileName}' in '${accessHandlePoolDirString}')`,
      })
    }

    const stateDbBuffer = yield* Effect.promise(() => stateDbFile.slice(HEADER_OFFSET_DATA).arrayBuffer())

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
      Effect.catchTag('@livestore/utils/Browser/NotFoundError', () => Effect.void),
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
    yield* Effect.logDebug('State db cleanup completed: no old database files found')
    return
  }

  yield* Effect.logDebug(`Found ${oldStateDbPaths.length} old state database file(s) to clean up`)

  let deletedCount = 0
  const archivedFileNames: string[] = []
  const absoluteArchiveDirName = `${opfsDirectory}/${ARCHIVE_DIR_NAME}`
  if (isDev && !(yield* Opfs.exists(absoluteArchiveDirName))) yield* Opfs.makeDirectory(absoluteArchiveDirName)

  for (const path of oldStateDbPaths) {
    const fileName = path.startsWith('/') ? path.slice(1) : path

    if (isDev) {
      const archiveFileData = vfs.readFilePayload(fileName)

      const archiveFileName = `${Date.now()}-${fileName}`

      yield* Opfs.writeFile(`${opfsDirectory}/archive/${archiveFileName}`, new Uint8Array(archiveFileData))

      archivedFileNames.push(archiveFileName)
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

    deletedCount++
    yield* Effect.logDebug(`Successfully deleted old state database file: ${fileName}`)
  }

  if (isDev) {
    const pruneResult = yield* pruneArchiveDirectory({
      archiveDirectory: absoluteArchiveDirName,
      keep: MAX_ARCHIVED_STATE_DBS_IN_DEV,
    })

    yield* Effect.logDebug(
      `State db cleanup completed: archived ${archivedFileNames.length} file(s); removed ${deletedCount} old database file(s) from active pool; archive retained ${pruneResult.retained.length} file(s)`,
    )
  } else {
    yield* Effect.logDebug(`State db cleanup completed: removed ${deletedCount} old database file(s)`)
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
  const entries = yield* Opfs.Opfs.listEntries(archiveDirHandle)
  const files = entries.filter((entry) => entry.kind === 'file')
  const filesWithMetadata = yield* Effect.forEach(files, (file) => Opfs.getMetadata(file.handle))
  const sortedFilesWithMetadata = filesWithMetadata.sort((a, b) => b.lastModified - a.lastModified)

  const retained = sortedFilesWithMetadata.slice(0, keep)
  const toDelete = sortedFilesWithMetadata.slice(keep)

  yield* Effect.forEach(toDelete, ({ name }) => Opfs.Opfs.removeEntry(archiveDirHandle, name))

  return {
    retained,
    deleted: toDelete,
  }
})
