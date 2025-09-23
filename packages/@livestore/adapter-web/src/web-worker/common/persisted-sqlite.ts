import { liveStoreStorageFormatVersion, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import {
  decodeAccessHandlePoolFilename,
  HEADER_OFFSET_DATA,
  type WebDatabaseMetadataOpfs,
} from '@livestore/sqlite-wasm/browser'
import { isDevEnv } from '@livestore/utils'
import { Effect, Opfs, Schedule, Schema } from '@livestore/utils/effect'
import type * as WorkerSchema from './worker-schema.ts'

export class PersistedSqliteError extends Schema.TaggedError<PersistedSqliteError>()('PersistedSqliteError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export const readPersistedStateDbFromClientSession = Effect.fn(
  '@livestore/adapter-web:readPersistedStateDbFromClientSession',
)(
  function* ({
    storageOptions,
    storeId,
    schema,
  }: {
    storageOptions: WorkerSchema.StorageType
    storeId: string
    schema: LiveStoreSchema
  }) {
    const accessHandlePoolDirString = yield* sanitizeOpfsDir(storageOptions.directory, storeId)

    const opfs = yield* Opfs.Opfs
    const accessHandlePoolDirHandle = yield* Opfs.getDirectoryHandleByPath(accessHandlePoolDirString)

    const entries = yield* opfs.listEntries(accessHandlePoolDirHandle)
    const fileHandles = entries.filter((entry) => entry.kind === 'file').map((entry) => entry.handle)

    const stateDbFileName = `/${getStateDbFileName(schema)}`

    let stateDbFile: File | undefined
    for (const fileHandle of fileHandles) {
      const file = yield* opfs.getFile(fileHandle)
      const fileName = yield* Effect.promise(() => decodeAccessHandlePoolFilename(file))
      if (fileName !== stateDbFileName) {
        stateDbFile = file
        break
      }
    }

    // TODO: Fail with an error instead of returning undefined
    if (stateDbFile === undefined) return undefined

    const stateDbBuffer = yield* Effect.promise(() => stateDbFile.slice(HEADER_OFFSET_DATA).arrayBuffer())

    // Given the SAH pool always eagerly creates files with empty non-header data,
    // we want to return undefined if the file exists but is empty
    // TODO: Fail with an error instead of returning undefined
    if (stateDbBuffer.byteLength === 0) return undefined

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
      UnexpectedError.mapToUnexpectedError,
    )
  },
  Effect.retry({
    schedule: Schedule.exponentialBackoff10Sec,
  }),
)

export const sanitizeOpfsDir = (directory: string | undefined, storeId: string) =>
  Effect.gen(function* () {
    if (directory === undefined || directory === '' || directory === '/') {
      return `livestore-${storeId}@${liveStoreStorageFormatVersion}`
    }

    if (directory.includes('/')) {
      return yield* new PersistedSqliteError({
        message: `@livestore/adapter-web:worker:sanitizeOpfsDir: Nested directories are not yet supported ('${directory}')`,
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

/**
 * Cleanup old state database files after successful migration.
 * This prevents OPFS file pool capacity from being exhausted by accumulated schema files.
 *
 * @param vfs - The AccessHandlePoolVFS instance for safe file operations
 * @param currentSchema - Current schema (to avoid deleting the active database)
 */
export const cleanupOldStateDbFiles = Effect.fn('@livestore/adapter-web:cleanupOldStateDbFiles')(
  function* ({
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
    let archiveDirHandle: FileSystemDirectoryHandle | undefined

    for (const path of oldStateDbPaths) {
      const fileName = path.startsWith('/') ? path.slice(1) : path

      if (isDev) {
        archiveDirHandle = yield* ensureArchiveDirectory(opfsDirectory)

        const archivedFileName = yield* archiveStateDbFile({
          vfs,
          fileName,
          archiveDirHandle,
        })

        archivedFileNames.push(archivedFileName)
      }

      const vfsResultCode = yield* Effect.try({
        try: () => vfs.jDelete(fileName, 0),
        catch: (cause) => new SqliteVfsError({ operation: 'jDelete', fileName, cause }),
      })

      // 0 indicates a successful result in SQLite.
      // See https://www.sqlite.org/c3ref/c_abort.html
      if (vfsResultCode !== 0) {
        return yield* new SqliteVfsError({
          operation: 'jDelete',
          fileName,
          vfsResultCode,
        })
      }

      deletedCount++
      yield* Effect.logDebug(`Successfully deleted old state database file: ${fileName}`)
    }

    if (isDev && archiveDirHandle !== undefined) {
      const pruneResult = yield* pruneArchiveDirectory({
        directoryHandle: archiveDirHandle,
        keep: MAX_ARCHIVED_STATE_DBS_IN_DEV,
      })

      yield* Effect.logDebug(
        `State db cleanup completed: archived ${archivedFileNames.length} file(s); removed ${deletedCount} old database file(s) from active pool; archive retained ${pruneResult.retained.length} file(s)`,
      )
    } else {
      yield* Effect.logDebug(`State db cleanup completed: removed ${deletedCount} old database file(s)`)
    }
  },
  Effect.mapError(
    (error) =>
      new PersistedSqliteError({
        message: 'Failed to clean up old state database file(s)',
        cause: error,
      }),
  ),
)

const ensureArchiveDirectory = Effect.fn('@livestore/adapter-web:ensureArchiveDirectory')((opfsDirectory: string) =>
  Effect.tryPromise({
    try: async () => {
      const root = await OpfsUtils.rootHandlePromise
      const segments = [...opfsDirectory.split('/').filter(Boolean), 'archive']

      let handle = root
      for (const segment of segments) {
        handle = await handle.getDirectoryHandle(segment, { create: true })
      }

      return handle
    },
    catch: (cause) => new ArchiveStateDbError({ message: 'Failed to ensure archive directory', cause }),
  }),
)

const archiveStateDbFile = Effect.fn('@livestore/adapter-web:archiveStateDbFile')(
  ({
    vfs,
    fileName,
    archiveDirHandle,
  }: {
    vfs: WebDatabaseMetadataOpfs['vfs']
    fileName: string
    archiveDirHandle: FileSystemDirectoryHandle
  }) =>
    Effect.gen(function* () {
      const payload = vfs.readFilePayload(fileName)

      const archiveFileName = `${Date.now()}-${fileName}`

      const archiveFileHandle = yield* Effect.tryPromise({
        try: () => archiveDirHandle.getFileHandle(archiveFileName, { create: true }),
        catch: (cause) =>
          new ArchiveStateDbError({
            message: 'Failed to open archive file handle',
            fileName: archiveFileName,
            cause,
          }),
      })

      const accessHandle = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => archiveFileHandle.createSyncAccessHandle(),
          catch: (cause) =>
            new ArchiveStateDbError({
              message: 'Failed to create sync access handle for archived file',
              fileName: archiveFileName,
              cause,
            }),
        }),
        (handle) => Effect.sync(() => handle.close()).pipe(Effect.ignoreLogged),
      )

      yield* Effect.try({
        try: () => {
          if (payload.byteLength > 0) {
            accessHandle.write(payload, { at: 0 })
          }
          accessHandle.truncate(payload.byteLength)
          accessHandle.flush()
        },
        catch: (cause) =>
          new ArchiveStateDbError({
            message: 'Failed to write archived state database',
            fileName: archiveFileName,
            cause,
          }),
      })

      return archiveFileName
    }),
)

const pruneArchiveDirectory = ({
  directoryHandle,
  keep,
}: {
  directoryHandle: FileSystemDirectoryHandle
  keep: number
}) =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: async () => {
        const result: { name: string; lastModified: number }[] = []

        for await (const entry of directoryHandle.values()) {
          if (entry.kind !== 'file') continue
          const fileHandle = await directoryHandle.getFileHandle(entry.name)
          const file = await fileHandle.getFile()
          result.push({ name: entry.name, lastModified: file.lastModified })
        }

        return result.sort((a, b) => b.lastModified - a.lastModified)
      },
      catch: (cause) => new ArchiveStateDbError({ message: 'Failed to enumerate archived state databases', cause }),
    })

    const retained = files.slice(0, keep)
    const toDelete = files.slice(keep)

    yield* Effect.forEach(toDelete, ({ name }) =>
      Effect.tryPromise({
        try: () => directoryHandle.removeEntry(name),
        catch: (cause) =>
          new ArchiveStateDbError({
            message: 'Failed to delete archived state database',
            fileName: name,
            cause,
          }),
      }),
    )

    return {
      retained,
      deleted: toDelete,
    }
  })

export class ArchiveStateDbError extends Schema.TaggedError<ArchiveStateDbError>()('ArchiveStateDbError', {
  message: Schema.String,
  fileName: Schema.optional(Schema.String),
  cause: Schema.Defect,
}) {}

export class SqliteVfsError extends Schema.TaggedError<SqliteVfsError>()('SqliteVfsError', {
  operation: Schema.String,
  fileName: Schema.String,
  vfsResultCode: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect),
}) {}
