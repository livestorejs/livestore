import type * as SqliteWasm from '@livestore/sqlite-wasm'
import { Effect, Queue, Stream } from '@livestore/utils/effect'

import { IdbBinary } from '../utils/idb-eff.js'
import { importBytesToDb } from '../utils/sqlite-utils.js'

export interface PersistedSqlite {
  db: SqliteWasm.Database
  persist: () => void
}

export const makePersistedSqliteOpfs = (
  sqlite3: SqliteWasm.Sqlite3Static,
  directory: string | undefined,
  fileName: string,
) =>
  Effect.gen(function* ($) {
    if (directory !== undefined && directory.endsWith('/')) {
      throw new Error('directory should not end with /')
    }
    const fullPath = directory ? `${directory}/${fileName}` : fileName
    const db = new sqlite3.oo1.OpfsDb(fullPath, 'c') as SqliteWasm.Database & { capi: SqliteWasm.CAPI }
    db.capi = sqlite3.capi

    yield* $(Effect.addFinalizer(() => Effect.sync(() => db.close())))

    return db
  })

export const makePersistedSqliteIndexedDb = (
  sqlite3: SqliteWasm.Sqlite3Static,
  databaseName: string,
  storeName: string,
) =>
  Effect.gen(function* ($) {
    const idb = new IdbBinary(databaseName, storeName)
    yield* $(Effect.addFinalizer(() => idb.close.pipe(Effect.tapCauseLogPretty, Effect.orDie)))

    const key = 'db'

    const db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' }) as SqliteWasm.Database & {
      capi: SqliteWasm.CAPI
    }
    db.capi = sqlite3.capi

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

    return db
  })
