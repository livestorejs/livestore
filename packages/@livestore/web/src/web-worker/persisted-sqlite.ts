import type { SqliteError, SynchronousDatabase } from '@livestore/common'
import { ref } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Schema } from '@livestore/utils/effect'

import * as OpfsUtils from '../opfs-utils.js'
import { WaSqlite } from '../sqlite/index.js'
import { decodeSAHPoolFilename, HEADER_OFFSET_DATA } from '../sqlite/opfs-sah-pool.js'
import type { PersistenceInfo } from './common.js'
import type * as WorkerSchema from './worker-schema.js'

export interface PersistedSqlite {
  /** NOTE the db instance is wrapped in a ref since it can be re-created */
  dbRef: { current: { pointer: number; syncDb: SynchronousDatabase } }
  destroy: Effect.Effect<void, PersistedSqliteError>
  export: Effect.Effect<Uint8Array>
  import: (source: { pointer: number } | Uint8Array) => Effect.Effect<void, PersistedSqliteError>
  persistenceInfo: PersistenceInfo
}

export class PersistedSqliteError extends Schema.TaggedError<PersistedSqliteError>()('PersistedSqliteError', {
  cause: Schema.Defect,
}) {}

export const makePersistedSqlite = ({
  storageOptions,
  sqlite3,
  schemaHashSuffix,
  storeId,
  kind,
  configure,
  vfs,
}: {
  storageOptions: WorkerSchema.StorageType
  sqlite3: WaSqlite.SQLiteAPI
  schemaHashSuffix: string
  storeId: string
  kind: 'app' | 'mutationlog'
  configure: (db: { pointer: number; syncDb: SynchronousDatabase }) => Effect.Effect<void, SqliteError>
  vfs: WaSqlite.SQLiteVFS
}) => {
  // // switch (storageOptions.type) {
  // //   case 'opfs': {
  return makePersistedSqliteOpfs({
    sqlite3,
    storageOptions,
    schemaHashSuffix,
    storeId,
    kind,
    configure,
    vfs: vfs as WaSqlite.AccessHandlePoolVFS,
  })
  //   }
  // case 'indexeddb': {
  //   // const storeName =
  //   //   kind === 'app'
  //   //     ? getAppDbIdbStoreName(storageOptions.storeNamePrefix, schemaHash)
  //   //     : getMutationlogDbIdbStoreName(storageOptions.storeNamePrefix)

  //   // return makePersistedSqliteIndexedDb(sqlite3, storageOptions.databaseName, storeName, configure)
  //   return Effect.die(new Error('Not implemented'))
  // }
  // default: {
  //   return casesHandled(storageOptions)
  // }
  // }
}

// TODO remove this once bun-types has fixed the type for ArrayBuffer
declare global {
  interface Uint8Array {
    resize: (size: number) => never
  }
}

export const prepareVfs = ({
  sqlite3,
  storageOptions,
  storeId,
}: {
  sqlite3: WaSqlite.SQLiteAPI
  storageOptions: WorkerSchema.StorageType
  storeId: string
}) =>
  Effect.gen(function* () {
    const vfsName = getVfsName({ storageOptions, storeId })

    if (storageOptions.type === 'opfs') {
      const directory = sanitizeOpfsDir(storageOptions.directory, storeId)
      const vfs = yield* Effect.promise(() =>
        WaSqlite.AccessHandlePoolVFS.create(vfsName, directory, (sqlite3 as any).module),
      )

      sqlite3.vfs_register(vfs as any as SQLiteVFS, false)

      return vfs
    } else {
      // TODO bring back indexeddb
      return undefined as never
    }
  })

const getVfsName = ({ storageOptions, storeId }: { storageOptions: WorkerSchema.StorageType; storeId: string }) => {
  if (storageOptions.type === 'opfs') {
    const directory = sanitizeOpfsDir(storageOptions.directory, storeId)
    // Replace all special characters with underscores
    const safePath = directory.replaceAll(/["*/:<>?\\|]/g, '_')
    const pathSegment = safePath.length === 0 ? '' : `-${safePath}`
    return `opfs${pathSegment}`
  } else {
    return 'indexeddb'
  }
}

export const makePersistedSqliteOpfs = ({
  sqlite3,
  storageOptions,
  schemaHashSuffix,
  storeId,
  kind,
  configure,
  vfs,
}: {
  sqlite3: WaSqlite.SQLiteAPI
  storageOptions: WorkerSchema.StorageTypeOpfs
  schemaHashSuffix: string
  storeId: string
  kind: 'app' | 'mutationlog'
  configure: (db: { pointer: number; syncDb: SynchronousDatabase }) => Effect.Effect<void, SqliteError>
  vfs: WaSqlite.AccessHandlePoolVFS
}): Effect.Effect<PersistedSqlite, PersistedSqliteError, Scope.Scope> =>
  Effect.gen(function* () {
    const fileName = kind === 'app' ? getAppDbFileName(schemaHashSuffix) : 'mutationlog.db'

    const vfsName = getVfsName({ storageOptions, storeId })

    const pointer = yield* Effect.sync(() => sqlite3.open_v2Sync(fileName, undefined, vfsName))
    // TODO get rid of ref since we never replace it
    const dbRef = ref({ pointer, syncDb: WaSqlite.makeSynchronousDatabase(sqlite3, pointer) })

    const opfsDirectory = sanitizeOpfsDir(storageOptions.directory, storeId)
    const opfsFileName = vfs.getOpfsFileName(fileName)
    const opfsPath = `${opfsDirectory}/${opfsFileName}`

    const persistenceInfo = { fileName, opfsPath }

    // Log below can be useful to debug state of loaded DB
    // console.debug('makePersistedSqliteOpfs:', 'vfsName', vfsName, 'fileName', fileName, 'pointer', pointer)
    // console.debug(
    //   'makePersistedSqliteOpfs: sqlite_master for',
    //   opfsPath,
    //   dbRef.current.selectObjects('select * from sqlite_master'),
    // )

    yield* Effect.addFinalizer(() => Effect.sync(() => sqlite3.close(dbRef.current)))

    yield* configure(dbRef.current)

    const destroy = Effect.gen(function* () {
      try {
        dbRef.current.syncDb.close()
      } catch (error) {
        console.error('Error closing database', error)
      }

      vfs.resetAccessHandle(fileName)
    }).pipe(
      Effect.catchAllCause((error) => new PersistedSqliteError({ cause: error })),
      Effect.withSpan('@livestore/web:worker:persistedSqliteOpfs:destroy'),
      Effect.tapCauseLogPretty,
    )
    // const destroy = opfsDeleteAbs(opfsPath).pipe(
    //   Effect.catchAllCause((error) => new PersistedSqliteError({ cause: error })),
    //   Effect.withSpan('@livestore/web:worker:persistedSqliteOpfs:destroy'),
    //   Effect.tapCauseLogPretty,
    // )

    const export_ = Effect.sync(() => WaSqlite.exportDb(sqlite3, dbRef.current.pointer)).pipe(
      Effect.withSpan('@livestore/web:worker:persistedSqliteOpfs:export'),
    )

    const import_ = (source: { pointer: number } | Uint8Array) =>
      Effect.gen(function* () {
        if (source instanceof Uint8Array) {
          WaSqlite.importBytesToDb(sqlite3, dbRef.current.pointer, source)
        } else {
          sqlite3.backup(dbRef.current.pointer, 'main', source.pointer, 'main')
        }

        yield* configure(dbRef.current)
      }).pipe(
        Effect.catchAllCause((error) => new PersistedSqliteError({ cause: error })),
        Effect.withSpan('@livestore/web:worker:persistedSqliteOpfs:import'),
      )

    return { dbRef, destroy, export: export_, import: import_, persistenceInfo } satisfies PersistedSqlite
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
    if (storageOptions.type === 'opfs') {
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

          // Given the SAH pool always eagerly creates files with empty non-header data,
          // we want to return undefined if the file exists but is empty
          if (data.byteLength === 0) {
            return undefined
          }

          return new Uint8Array(data)
        }

        return undefined
      })
    } else if (storageOptions.type === 'indexeddb') {
      // const idb = new IDB(
      //   storage.databaseName ?? 'livestore',
      //   getAppDbIdbStoreName(storage.storeNamePrefix, fileSuffix),
      // )
      // return await idb.get('db')
    }
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
  if (directory === undefined || directory === '' || directory === '/') return `livestore-${storeId}`

  if (directory.includes('/')) {
    throw new Error(`@livestore/web:worker:sanitizeOpfsDir: Nested directories are not yet supported ('${directory}')`)
  }

  // if (directory.endsWith('/')) return directory

  return `${directory}`
}

const getAppDbFileName = (suffix: string) => `app${suffix}.db`
