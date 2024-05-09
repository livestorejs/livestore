import type * as SqliteWasm from '@livestore/sqlite-wasm'
import { casesHandled } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Queue, Schema, Stream } from '@livestore/utils/effect'

import { IdbBinary } from '../utils/idb-eff.js'
import { importBytesToDb } from '../utils/sqlite-utils.js'
import {
  getAppDbFileName,
  getAppDbIdbStoreName,
  getMutationlogDbFileName,
  getMutationlogDbIdbStoreName,
  getOpfsDirHandle,
} from './common.js'
import type { StorageType } from './schema.js'

export interface PersistedSqlite {
  /** NOTE the db instance is wrapped in a ref since it can be re-created */
  dbRef: { current: SqliteWasm.Database & { capi: SqliteWasm.CAPI } }
  destroy: Effect.Effect<void, PersistedSqliteError>
  export: Effect.Effect<Uint8Array>
  import: (data: Uint8Array) => Effect.Effect<void, PersistedSqliteError>
}

export class PersistedSqliteError extends Schema.TaggedError<PersistedSqliteError>()('PersistedSqliteError', {
  error: Schema.Any,
}) {}

export const makePersistedSqlite = ({
  storageOptions,
  sqlite3,
  schemaHash,
  kind,
  configure,
}: {
  storageOptions: StorageType
  sqlite3: SqliteWasm.Sqlite3Static
  schemaHash: number
  kind: 'app' | 'mutationlog'
  configure: (db: SqliteWasm.Database & { capi: SqliteWasm.CAPI }) => Effect.Effect<void>
}) => {
  switch (storageOptions.type) {
    case 'opfs': {
      const fileName =
        kind === 'app'
          ? getAppDbFileName(storageOptions.filePrefix, schemaHash)
          : getMutationlogDbFileName(storageOptions.filePrefix)

      return makePersistedSqliteOpfs(sqlite3, storageOptions.directory, fileName, configure)
    }
    case 'indexeddb': {
      const storeName =
        kind === 'app'
          ? getAppDbIdbStoreName(storageOptions.storeNamePrefix, schemaHash)
          : getMutationlogDbIdbStoreName(storageOptions.storeNamePrefix)

      return makePersistedSqliteIndexedDb(sqlite3, storageOptions.databaseName ?? 'livestore', storeName, configure)
    }
    default: {
      return casesHandled(storageOptions)
    }
  }
}

export const makePersistedSqliteOpfs = (
  sqlite3: SqliteWasm.Sqlite3Static,
  directory: string | undefined,
  fileName: string,
  configure: (db: SqliteWasm.Database & { capi: SqliteWasm.CAPI }) => Effect.Effect<void>,
): Effect.Effect<PersistedSqlite, PersistedSqliteError, Scope.Scope> =>
  Effect.gen(function* ($) {
    if (directory !== undefined && directory.endsWith('/')) {
      throw new Error('directory should not end with /')
    }
    const fullPath = directory ? `${directory}/${fileName}` : fileName
    const dbRef = { current: new sqlite3.oo1.OpfsDb(fullPath, 'c') as SqliteWasm.Database & { capi: SqliteWasm.CAPI } }
    dbRef.current.capi = sqlite3.capi

    yield* $(Effect.addFinalizer(() => Effect.sync(() => dbRef.current.close())))

    yield* $(configure(dbRef.current))

    const destroy = deletePersistedSqliteOpfs(directory, fileName).pipe(
      Effect.catchAllCause((error) => new PersistedSqliteError({ error })),
    )

    const export_ = Effect.sync(() => dbRef.current.capi.sqlite3_js_db_export(dbRef.current.pointer!))

    const import_ = (data: Uint8Array) =>
      Effect.gen(function* ($) {
        dbRef.current.close()

        yield* Effect.promise(async () => {
          // overwrite the OPFS file with the new data
          const dirHandle = await getOpfsDirHandle(directory)
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(data)
          await writable.close()
        })

        dbRef.current = new sqlite3.oo1.OpfsDb(fullPath, 'c') as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
        dbRef.current.capi = sqlite3.capi

        yield* $(configure(dbRef.current))
      })

    return { dbRef, destroy, export: export_, import: import_ }
  }).pipe(Effect.mapError((error) => new PersistedSqliteError({ error })))

export const makePersistedSqliteIndexedDb = (
  sqlite3: SqliteWasm.Sqlite3Static,
  databaseName: string,
  storeName: string,
  configure: (db: SqliteWasm.Database & { capi: SqliteWasm.CAPI }) => Effect.Effect<void>,
): Effect.Effect<PersistedSqlite, PersistedSqliteError, Scope.Scope> =>
  Effect.gen(function* ($) {
    const idb = new IdbBinary(databaseName, storeName)
    yield* $(Effect.addFinalizer(() => idb.close.pipe(Effect.tapCauseLogPretty, Effect.orDie)))

    const key = 'db'

    const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as SqliteWasm.Database & {
      capi: SqliteWasm.CAPI
    }
    db.capi = sqlite3.capi

    yield* $(Effect.addFinalizer(() => Effect.sync(() => db.close())))

    yield* $(configure(db))

    const initialData = yield* $(idb.get(key))

    if (initialData !== undefined) {
      importBytesToDb(sqlite3, db, initialData)
    }

    const persistDebounceQueue = yield* $(Queue.unbounded<void>(), Effect.acquireRelease(Queue.shutdown))

    // NOTE in case of an interrupt, it's possible that the last debounced persist is not executed
    // we need to replace the indexeddb sqlite impl anyway, so it's fine for now
    yield* $(
      Stream.fromQueue(persistDebounceQueue),
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

    const destroy = idb.deleteDb.pipe(Effect.mapError((error) => new PersistedSqliteError({ error })))

    const export_ = Effect.sync(() => db.capi.sqlite3_js_db_export(db.pointer!))

    const import_ = (data: Uint8Array) =>
      Effect.sync(() => {
        importBytesToDb(sqlite3, db, data)

        // trigger persisting the data to IndexedDB
        persist()
      })

    return { dbRef: { current: db }, destroy, export: export_, import: import_ }
  }).pipe(Effect.mapError((error) => new PersistedSqliteError({ error })))

const opfsDeleteFile = (absFilePath: string) =>
  Effect.promise(async () => {
    // Get the root directory handle
    const root = await navigator.storage.getDirectory()

    // Split the absolute path to traverse directories
    const pathParts = absFilePath.split('/').filter((part) => part.length)

    // Traverse to the target file handle
    let currentDir = root
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(pathParts[i]!)
    }

    // Get the file handle
    const fileHandle = await currentDir.getFileHandle(pathParts.at(-1)!)

    // Delete the file
    await currentDir.removeEntry(fileHandle.name)
  })

const deletePersistedSqliteOpfs = (directory: string | undefined, fileName: string) => {
  const fullPath = directory ? `${directory}/${fileName}` : fileName
  return opfsDeleteFile(fullPath)
}
