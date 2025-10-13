import { liveStoreStorageFormatVersion, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { decodeSAHPoolFilename, HEADER_OFFSET_DATA, type WebDatabaseMetadataOpfs } from '@livestore/sqlite-wasm/browser'
import { isDevEnv } from '@livestore/utils'
import { Effect, Schedule, Schema } from '@livestore/utils/effect'

import * as OpfsUtils from '../../opfs-utils.ts'
import type * as WorkerSchema from './worker-schema.ts'

export class PersistedSqliteError extends Schema.TaggedError<PersistedSqliteError>()('PersistedSqliteError', {
  message: Schema.String,
  cause: Schema.Defect,
}) {}

export const readPersistedAppDbFromClientSession = ({
  storageOptions,
  storeId,
  schema,
}: {
  storageOptions: WorkerSchema.StorageType
  storeId: string
  schema: LiveStoreSchema
}) =>
  Effect.promise(async () => {
    const directory = sanitizeOpfsDir(storageOptions.directory, storeId)
    const sahPoolOpaqueDir = await OpfsUtils.getDirHandle(directory).catch(() => undefined)

    if (sahPoolOpaqueDir === undefined) {
      return undefined
    }

    const tryGetDbFile = async (fileHandle: FileSystemFileHandle) => {
      const file = await fileHandle.getFile()
      const fileName = await decodeSAHPoolFilename(file)
      return fileName ? { fileName, file } : undefined
    }

    const getAllFiles = async (asyncIterator: AsyncIterable<FileSystemHandle>): Promise<FileSystemFileHandle[]> => {
      const results: FileSystemFileHandle[] = []
      for await (const value of asyncIterator) {
        if (value.kind === 'file') {
          results.push(value as FileSystemFileHandle)
        }
      }
      return results
    }

    const files = await getAllFiles(sahPoolOpaqueDir.values())

    const fileResults = await Promise.all(files.map(tryGetDbFile))

    const appDbFileName = `/${getStateDbFileName(schema)}`

    const dbFileRes = fileResults.find((_) => _?.fileName === appDbFileName)
    // console.debug('fileResults', fileResults, 'dbFileRes', dbFileRes)

    if (dbFileRes !== undefined) {
      const data = await dbFileRes.file.slice(HEADER_OFFSET_DATA).arrayBuffer()
      // console.debug('readPersistedAppDbFromClientSession', data.byteLength, data)

      // Given the SAH pool always eagerly creates files with empty non-header data,
      // we want to return undefined if the file exists but is empty
      if (data.byteLength === 0) {
        return undefined
      }

      return new Uint8Array(data)
    }

    return undefined
  }).pipe(
    Effect.logWarnIfTakesLongerThan({
      duration: 1000,
      label: '@livestore/adapter-web:readPersistedAppDbFromClientSession',
    }),
    Effect.withPerformanceMeasure('@livestore/adapter-web:readPersistedAppDbFromClientSession'),
    Effect.withSpan('@livestore/adapter-web:readPersistedAppDbFromClientSession'),
  )

export const resetPersistedDataFromClientSession = ({
  storageOptions,
  storeId,
}: {
  storageOptions: WorkerSchema.StorageType
  storeId: string
}) =>
  Effect.gen(function* () {
    const directory = sanitizeOpfsDir(storageOptions.directory, storeId)
    yield* opfsDeleteAbs(directory)
  }).pipe(
    Effect.retry({
      schedule: Schedule.exponentialBackoff10Sec,
    }),
    Effect.withSpan('@livestore/adapter-web:resetPersistedDataFromClientSession'),
  )

const opfsDeleteAbs = (absPath: string) =>
  Effect.promise(async () => {
    // Get the root directory handle
    const root = await OpfsUtils.rootHandlePromise

    // Split the absolute path to traverse directories
    const pathParts = absPath.split('/').filter((part) => part.length)

    try {
      // Traverse to the target file handle
      let currentDir = root
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(pathParts[i]!)
      }

      // Delete the file
      await currentDir.removeEntry(pathParts.at(-1)!, { recursive: true })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        // Can ignore as it's already been deleted or not there in the first place
        return
      } else {
        throw error
      }
    }
  }).pipe(
    UnexpectedError.mapToUnexpectedError,
    Effect.withSpan('@livestore/adapter-web:worker:opfsDeleteFile', { attributes: { absFilePath: absPath } }),
  )

export const sanitizeOpfsDir = (directory: string | undefined, storeId: string) => {
  // Root dir should be `''` not `/`
  if (directory === undefined || directory === '' || directory === '/')
    return `livestore-${storeId}@${liveStoreStorageFormatVersion}`

  if (directory.includes('/')) {
    throw new Error(
      `@livestore/adapter-web:worker:sanitizeOpfsDir: Nested directories are not yet supported ('${directory}')`,
    )
  }

  return `${directory}@${liveStoreStorageFormatVersion}`
}

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
        archiveDirHandle = yield* Effect.tryPromise({
          try: () => OpfsUtils.getDirHandle(`${opfsDirectory}/archive`, { create: true }),
          catch: (cause) => new ArchiveStateDbError({ message: 'Failed to ensure archive directory', cause }),
        })

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
      const pruneResult = yield* pruneArchiveDir({
        archiveDirHandle,
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

const archiveStateDbFile = Effect.fn('@livestore/adapter-web:archiveStateDbFile')(function* ({
  vfs,
  fileName,
  archiveDirHandle,
}: {
  vfs: WebDatabaseMetadataOpfs['vfs']
  fileName: string
  archiveDirHandle: FileSystemDirectoryHandle
}) {
  const stateDbBuffer = vfs.readFilePayload(fileName)

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

  const archiveFileAccessHandle = yield* Effect.acquireRelease(
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
      archiveFileAccessHandle.write(stateDbBuffer)
      archiveFileAccessHandle.flush()
    },
    catch: (cause) =>
      new ArchiveStateDbError({
        message: 'Failed to write archived state database',
        fileName: archiveFileName,
        cause,
      }),
  })

  return archiveFileName
}, Effect.scoped)

const pruneArchiveDir = Effect.fn('@livestore/adapter-web:pruneArchiveDir')(function* ({
  archiveDirHandle,
  keep,
}: {
  archiveDirHandle: FileSystemDirectoryHandle
  keep: number
}) {
  const files = yield* Effect.tryPromise({
    try: async () => {
      const result: { name: string; lastModified: number }[] = []

      for await (const entry of archiveDirHandle.values()) {
        if (entry.kind !== 'file') continue
        const fileHandle = await archiveDirHandle.getFileHandle(entry.name)
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
      try: () => archiveDirHandle.removeEntry(name),
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
