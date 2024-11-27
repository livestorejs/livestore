import type { MakeSynchronousDatabase, PersistenceInfo, SqliteError, SynchronousDatabase } from '@livestore/common'
import { liveStoreStorageFormatVersion } from '@livestore/common'
import type { WebDatabaseInputOpfs, WebDatabaseMetadataOpfs } from '@livestore/sqlite-wasm/browser'
import { decodeSAHPoolFilename, HEADER_OFFSET_DATA } from '@livestore/sqlite-wasm/browser'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Schema } from '@livestore/utils/effect'

import * as OpfsUtils from '../../opfs-utils.js'
import type { LeaderDatabase } from '../leader-worker/types.js'
import type * as WorkerSchema from './worker-schema.js'

export class PersistedSqliteError extends Schema.TaggedError<PersistedSqliteError>()('PersistedSqliteError', {
  cause: Schema.Defect,
}) {}

export const makePersistedSqlite = ({
  storageOptions,
  schemaHashSuffix,
  storeId,
  kind,
  configureDb,
  makeSyncDb,
}: {
  storageOptions: WorkerSchema.StorageType
  makeSyncDb: MakeSynchronousDatabase<
    { dbPointer: number; persistenceInfo: PersistenceInfo },
    WebDatabaseInputOpfs,
    WebDatabaseMetadataOpfs
  >
  schemaHashSuffix: string
  storeId: string
  kind: 'app' | 'mutationlog'
  configureDb: (syncDb: SynchronousDatabase) => Effect.Effect<void, SqliteError>
}) => makePersistedSqliteOpfs({ storageOptions, schemaHashSuffix, storeId, kind, configureDb, makeSyncDb })

export const makePersistedSqliteOpfs = ({
  storageOptions,
  schemaHashSuffix,
  storeId,
  kind,
  configureDb,
  makeSyncDb,
}: {
  storageOptions: WorkerSchema.StorageTypeOpfs
  schemaHashSuffix: string
  storeId: string
  kind: 'app' | 'mutationlog'
  configureDb: (syncDb: SynchronousDatabase) => Effect.Effect<void, SqliteError>
  makeSyncDb: MakeSynchronousDatabase<
    { dbPointer: number; persistenceInfo: PersistenceInfo },
    WebDatabaseInputOpfs,
    WebDatabaseMetadataOpfs
  >
}): Effect.Effect<LeaderDatabase, PersistedSqliteError, Scope.Scope> =>
  Effect.gen(function* () {
    const fileName = kind === 'app' ? getAppDbFileName(schemaHashSuffix) : 'mutationlog.db'

    const opfsDirectory = sanitizeOpfsDir(storageOptions.directory, storeId)
    const syncDb = yield* makeSyncDb({ _tag: 'opfs', opfsDirectory, fileName, configureDb })

    yield* Effect.addFinalizer(() => Effect.sync(() => syncDb.close()))

    return syncDb
  }).pipe(
    Effect.mapError((cause) => new PersistedSqliteError({ cause })),
    Effect.withSpan('@livestore/web:worker:makePersistedSqliteOpfs', {
      attributes: { directory: storageOptions.directory },
    }),
  )

export const readPersistedAppDbFromCoordinator = ({
  storageOptions,
  storeId,
  schemaHashSuffix,
}: {
  storageOptions: WorkerSchema.StorageType
  storeId: string
  schemaHashSuffix: string
}) =>
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
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

      const appDbFileName = '/' + getAppDbFileName(schemaHashSuffix)

      const dbFileRes = fileResults.find((_) => _?.fileName === appDbFileName)
      // console.debug('fileResults', fileResults, 'dbFileRes', dbFileRes)

      if (dbFileRes !== undefined) {
        const data = await dbFileRes.file.slice(HEADER_OFFSET_DATA).arrayBuffer()
        // console.debug('readPersistedAppDbFromCoordinator', data.byteLength, data)

        // Given the SAH pool always eagerly creates files with empty non-header data,
        // we want to return undefined if the file exists but is empty
        if (data.byteLength === 0) {
          return undefined
        }

        return new Uint8Array(data)
      }

      return undefined
    })
  }).pipe(
    Effect.logWarnIfTakesLongerThan({ duration: 1000, label: '@livestore/web:readPersistedAppDbFromCoordinator' }),
    Effect.withPerformanceMeasure('@livestore/web:readPersistedAppDbFromCoordinator'),
    Effect.withSpan('@livestore/web:readPersistedAppDbFromCoordinator'),
  )

export const resetPersistedDataFromCoordinator = ({
  storageOptions,
  storeId,
}: {
  storageOptions: WorkerSchema.StorageType
  storeId: string
}) =>
  Effect.gen(function* () {
    const directory = sanitizeOpfsDir(storageOptions.directory, storeId)
    yield* opfsDeleteAbs(directory)
  }).pipe(Effect.withSpan('@livestore/web:resetPersistedDataFromCoordinator'))

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
  }).pipe(Effect.withSpan('@livestore/web:worker:opfsDeleteFile', { attributes: { absFilePath: absPath } }))

const sanitizeOpfsDir = (directory: string | undefined, storeId: string) => {
  // Root dir should be `''` not `/`
  if (directory === undefined || directory === '' || directory === '/')
    return `livestore-${storeId}@${liveStoreStorageFormatVersion}`

  if (directory.includes('/')) {
    throw new Error(`@livestore/web:worker:sanitizeOpfsDir: Nested directories are not yet supported ('${directory}')`)
  }

  return `${directory}@${liveStoreStorageFormatVersion}`
}

const getAppDbFileName = (suffix: string) => `app${suffix}.db`
