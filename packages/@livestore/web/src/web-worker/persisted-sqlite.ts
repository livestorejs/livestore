import type { SqliteError } from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import { casesHandled, prettyBytes, ref } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Queue, Schema, Stream } from '@livestore/utils/effect'

import { getDirHandle } from '../opfs-utils.js'
import type { SahUtils, SqliteWasm } from '../sqlite-utils.js'
import { importBytesToDb } from '../sqlite-utils.js'
import { IdbBinary } from '../utils/idb-eff.js'
import {
  getAppDbFileName,
  getAppDbIdbStoreName,
  getMutationlogDbFileName,
  getMutationlogDbIdbStoreName,
} from './common.js'
import type { StorageType } from './worker-schema.js'

export interface PersistedSqlite {
  /** NOTE the db instance is wrapped in a ref since it can be re-created */
  dbRef: { current: SqliteWasm.Database & { capi: SqliteWasm.CAPI } }
  destroy: Effect.Effect<void, PersistedSqliteError>
  export: Effect.Effect<Uint8Array>
  close: Effect.Effect<void>
  import: (data: Uint8Array) => Effect.Effect<void, PersistedSqliteError>
}

export class PersistedSqliteError extends Schema.TaggedError<PersistedSqliteError>()('PersistedSqliteError', {
  cause: Schema.AnyError,
}) {}

export const makePersistedSqlite = ({
  storageOptions,
  sqlite3,
  sahUtils,
  schemaHash,
  kind,
  configure,
}: {
  storageOptions: StorageType
  sqlite3: SqliteWasm.Sqlite3Static
  sahUtils: SahUtils | undefined
  schemaHash: number
  kind: 'app' | 'mutationlog'
  configure: (db: SqliteWasm.Database & { capi: SqliteWasm.CAPI }) => Effect.Effect<void, SqliteError>
}) => {
  switch (storageOptions.type) {
    case 'opfs': {
      const fileName =
        kind === 'app'
          ? getAppDbFileName(storageOptions.filePrefix, schemaHash)
          : getMutationlogDbFileName(storageOptions.filePrefix)

      return makePersistedSqliteOpfs(sqlite3, storageOptions.directory, fileName, configure)
    }
    case 'opfs-sahpool-experimental': {
      const fileName =
        kind === 'app'
          ? getAppDbFileName(storageOptions.filePrefix, schemaHash)
          : getMutationlogDbFileName(storageOptions.filePrefix)

      return makePersistedSqliteOpfsSahpoolExperimental(
        sqlite3,
        sahUtils!,
        storageOptions.directory,
        fileName,
        configure,
      )
    }
    case 'indexeddb': {
      const storeName =
        kind === 'app'
          ? getAppDbIdbStoreName(storageOptions.storeNamePrefix, schemaHash)
          : getMutationlogDbIdbStoreName(storageOptions.storeNamePrefix)

      return makePersistedSqliteIndexedDb(sqlite3, storageOptions.databaseName, storeName, configure)
    }
    default: {
      return casesHandled(storageOptions)
    }
  }
}

// TODO remove this once bun-types has fixed the type for ArrayBuffer
declare global {
  interface Uint8Array {
    resize: (size: number) => never
  }
}

export const makePersistedSqliteOpfs = (
  sqlite3: SqliteWasm.Sqlite3Static,
  directory_: string,
  fileName: string,
  configure: (db: SqliteWasm.Database & { capi: SqliteWasm.CAPI }) => Effect.Effect<void, SqliteError>,
): Effect.Effect<PersistedSqlite, PersistedSqliteError, Scope.Scope> =>
  Effect.gen(function* () {
    const directory = sanitizeOpfsDir(directory_)
    const fullPath = `${directory}${fileName}`

    const dbRef = ref(new sqlite3.oo1.OpfsDb(fullPath, 'c') as SqliteWasm.Database & { capi: SqliteWasm.CAPI })
    dbRef.current.capi = sqlite3.capi

    // Log below can be useful to debug state of loaded DB
    // console.debug(
    //   'makePersistedSqliteOpfs: sqlite_master for',
    //   fullPath,
    //   dbRef.current.selectObjects('select * from sqlite_master'),
    // )

    yield* Effect.addFinalizer(() => Effect.sync(() => dbRef.current.close()))

    yield* configure(dbRef.current)

    const destroy = opfsDeleteFile(fullPath).pipe(
      Effect.catchAllCause((error) => new PersistedSqliteError({ cause: error })),
      Effect.withSpan('@livestore/web:worker:persistedSqliteOpfs:destroy'),
    )

    const export_ = Effect.sync(() => {
      if (dbRef.current.pointer === undefined) throw new Error(`dbRef.current.pointer is undefined`)
      return dbRef.current.capi.sqlite3_js_db_export(dbRef.current.pointer)
    }).pipe(Effect.withSpan('@livestore/web:worker:persistedSqliteOpfs:export'))

    const import_ = (data: Uint8Array) =>
      Effect.gen(function* () {
        dbRef.current.close()

        yield* Effect.promise(async () => {
          // overwrite the OPFS file with the new data
          const dirHandle = await getDirHandle(directory)
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
          const writable = await fileHandle.createSyncAccessHandle()
          const numberOfWrittenBytes = writable.write(data.subarray())

          writable.flush()
          writable.close()

          if (numberOfWrittenBytes !== data.length) {
            throw new UnexpectedError({
              cause: `Import failed. Could only write ${prettyBytes(numberOfWrittenBytes)} of ${prettyBytes(data.length)} to ${fullPath}`,
              payload: { numberOfWrittenBytes, dataLength: data.length },
            })
          }
        })

        dbRef.current = new sqlite3.oo1.OpfsDb(fullPath, 'c') as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
        dbRef.current.capi = sqlite3.capi

        yield* configure(dbRef.current)
      }).pipe(
        Effect.catchAllCause((error) => new PersistedSqliteError({ cause: error })),
        Effect.withSpan('@livestore/web:worker:persistedSqliteOpfs:import'),
      )

    const close = Effect.gen(function* () {})

    return { dbRef, destroy, export: export_, import: import_, close }
  }).pipe(
    Effect.mapError((error) => new PersistedSqliteError({ cause: error })),
    Effect.withSpan('@livestore/web:worker:makePersistedSqliteOpfs', {
      attributes: { directory: directory_, fileName },
    }),
  )

export const makePersistedSqliteOpfsSahpoolExperimental = (
  sqlite3: SqliteWasm.Sqlite3Static,
  sahUtils: SahUtils,
  directory: string,
  fileName: string,
  configure: (db: SqliteWasm.Database & { capi: SqliteWasm.CAPI }) => Effect.Effect<void, SqliteError>,
): Effect.Effect<PersistedSqlite, PersistedSqliteError, Scope.Scope> =>
  Effect.gen(function* () {
    // NOTE We're not using the `directory` here since it's already used when creating the SAH pool
    const filePath = `/${fileName}`

    const dbRef = ref(new sahUtils.OpfsSAHPoolDb(filePath) as SqliteWasm.Database & { capi: SqliteWasm.CAPI })
    dbRef.current.capi = sqlite3.capi

    yield* Effect.addFinalizer(() => Effect.sync(() => dbRef.current.close()))

    yield* configure(dbRef.current)

    const destroy = opfsDeleteFile(directory).pipe(
      Effect.catchAllCause((error) => new PersistedSqliteError({ cause: error })),
      Effect.withSpan('@livestore/web:worker:persistedSqliteOpfsSahpoolExperimental:destroy'),
    )

    const export_ = Effect.sync(() => {
      if (dbRef.current.pointer === undefined) throw new Error(`dbRef.current.pointer is undefined`)
      return dbRef.current.capi.sqlite3_js_db_export(dbRef.current.pointer)
    }).pipe(Effect.withSpan('@livestore/web:worker:persistedSqliteOpfsSahpoolExperimental:export'))

    const import_ = (data: Uint8Array) =>
      Effect.gen(function* () {
        yield* Effect.try(() => sahUtils.importDb(filePath, data))
        // importBytesToDb(sqlite3, dbRef.current, data)
        // dbRef.current = new sahUtils.OpfsSAHPoolDb(fullPath) as SqliteWasm.Database & { capi: SqliteWasm.CAPI }

        yield* configure(dbRef.current)
      }).pipe(
        Effect.catchAllCause((error) => new PersistedSqliteError({ cause: error })),
        Effect.withSpan('@livestore/web:worker:persistedSqliteOpfsSahpoolExperimental:import'),
      )

    const close = Effect.gen(function* () {
      // sahUtils.unlink(filePath)
    })

    return { dbRef, destroy, export: export_, import: import_, close }
  }).pipe(
    Effect.mapError((error) => new PersistedSqliteError({ cause: error })),
    Effect.withSpan('@livestore/web:worker:makePersistedSqliteOpfsSahpoolExperimental', {
      attributes: { directory, fileName },
    }),
  )

export const makePersistedSqliteIndexedDb = (
  sqlite3: SqliteWasm.Sqlite3Static,
  databaseName: string,
  storeName: string,
  configure: (db: SqliteWasm.Database & { capi: SqliteWasm.CAPI }) => Effect.Effect<void, SqliteError>,
): Effect.Effect<PersistedSqlite, PersistedSqliteError, Scope.Scope> =>
  Effect.gen(function* () {
    const idb = new IdbBinary(databaseName, storeName)
    yield* Effect.addFinalizer(() => idb.close.pipe(Effect.tapCauseLogPretty, Effect.orDie))

    const key = 'db'

    const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as SqliteWasm.Database & {
      capi: SqliteWasm.CAPI
    }
    db.capi = sqlite3.capi

    yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))

    yield* configure(db)

    const initialData = yield* idb.get(key)

    if (initialData !== undefined) {
      importBytesToDb(sqlite3, db, initialData)
    }

    const persistDebounceQueue = yield* Queue.unbounded<void>().pipe(Effect.acquireRelease(Queue.shutdown))

    // NOTE in case of an interrupt, it's possible that the last debounced persist is not executed
    // we need to replace the indexeddb sqlite impl anyway, so it's fine for now
    yield* Stream.fromQueue(persistDebounceQueue).pipe(
      Stream.debounce(1000),
      Stream.tap(() => idb.put(key, db.capi.sqlite3_js_db_export(db.pointer!))),
      Stream.runDrain,
      Effect.forkScoped,
    )

    const persist = () => Queue.unsafeOffer(persistDebounceQueue, void 0)

    const originalExec = db.exec

    // @ts-expect-error TODO
    db.exec = (...args) => {
      // @ts-expect-error TODO
      const result = originalExec.apply(db, args)
      persist()
      return result
    }

    const originalPrepare = db.prepare

    db.prepare = (...args: any[]) => {
      // @ts-expect-error TODO
      const stmt = originalPrepare.apply(db, args)

      return new Proxy(stmt, {
        // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (typeof value === 'function') {
            // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
            return function (...args: any[]) {
              const result = value.apply(stmt, args)
              persist()
              return result
            }
          }
          return value
        },
      })
    }

    const originalClose = db.close

    db.close = () => {
      persist()
      idb.close.pipe(Effect.tapCauseLogPretty, Effect.runFork)
      originalClose.apply(db)
    }

    const destroy = idb.deleteDb.pipe(Effect.mapError((error) => new PersistedSqliteError({ cause: error })))

    const export_ = Effect.sync(() => db.capi.sqlite3_js_db_export(db.pointer!))

    const import_ = (data: Uint8Array) =>
      Effect.sync(() => {
        importBytesToDb(sqlite3, db, data)

        // trigger persisting the data to IndexedDB
        persist()
      })

    const close = Effect.gen(function* () {})

    return { dbRef: ref(db), destroy, export: export_, import: import_, close }
  }).pipe(
    Effect.mapError((error) => new PersistedSqliteError({ cause: error })),
    Effect.withSpan('@livestore/web:worker:makePersistedSqliteIndexedDb'),
  )

const opfsDeleteFile = (absFilePath: string) =>
  Effect.promise(async () => {
    // Get the root directory handle
    const root = await navigator.storage.getDirectory()

    // Split the absolute path to traverse directories
    const pathParts = absFilePath.split('/').filter((part) => part.length)

    try {
      // Traverse to the target file handle
      let currentDir = root
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(pathParts[i]!)
      }

      // Get the file handle
      const fileHandle = await currentDir.getFileHandle(pathParts.at(-1)!)

      // Delete the file
      await currentDir.removeEntry(fileHandle.name)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        // Can ignore as it's already been deleted or not there in the first place
        return
      } else {
        throw error
      }
    }
  }).pipe(Effect.withSpan('@livestore/web:worker:opfsDeleteFile', { attributes: { absFilePath } }))

const sanitizeOpfsDir = (directory: string) => {
  // Root dir should be `''` not `/`
  if (directory === '' || directory === '/') return ''

  if (directory.endsWith('/')) return directory

  return `${directory}/`
}
