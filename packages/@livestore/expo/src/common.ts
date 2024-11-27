import type { PreparedStatement, SynchronousDatabase } from '@livestore/common'
import { base64, shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import * as ExpoFS from 'expo-file-system'
import type * as SQLite from 'expo-sqlite'

export const makeSynchronousDatabase = (db: SQLite.SQLiteDatabase): SynchronousDatabase => {
  const stmts: PreparedStatement[] = []

  const syncDb: SynchronousDatabase<any> = {
    metadata: { fileName: db.databasePath },
    _tag: 'SynchronousDatabase',
    prepare: (queryStr) => {
      try {
        const dbStmt = db.prepareSync(queryStr)
        const stmt = {
          execute: (bindValues) => {
            // console.log('execute', queryStr, bindValues)
            const res = dbStmt.executeSync(bindValues ?? ([] as any))
            res.resetSync()
            return () => res.changes
          },
          select: (bindValues) => {
            const res = dbStmt.executeSync(bindValues ?? ([] as any))
            try {
              return res.getAllSync() as any
            } finally {
              res.resetSync()
            }
          },
          finalize: () => dbStmt.finalizeSync(),
          sql: queryStr,
        } satisfies PreparedStatement
        stmts.push(stmt)
        return stmt
      } catch (e) {
        console.error(`Error preparing statement: ${queryStr}`, e)
        return shouldNeverHappen(`Error preparing statement: ${queryStr}`)
      }
    },
    execute: (queryStr, bindValues) => {
      const stmt = db.prepareSync(queryStr)
      try {
        const res = stmt.executeSync(bindValues ?? ([] as any))
        return () => res.changes
      } finally {
        stmt.finalizeSync()
      }
    },
    export: () => {
      return db.serializeSync()
    },
    select: (queryStr, bindValues) => {
      const stmt = syncDb.prepare(queryStr)
      const res = stmt.select(bindValues)
      stmt.finalize()
      return res as any
    },
    // TODO
    destroy: () => {},
    close: () => {
      for (const stmt of stmts) {
        stmt.finalize()
      }
      return db.closeSync()
    },
    import: () => {
      throw new Error('Not implemented')
      // TODO properly implement this as it seems to require importing to a temporary in-memory db,
      // save it to a file, and then reopen the DB from that file? (see `overwriteDbFile` below)
    },
    session: () => {
      return {
        changeset: () => new Uint8Array(),
        finish: () => {},
      }
    },
  } satisfies SynchronousDatabase

  return syncDb
}

export type DbPairRef = {
  current:
    | {
        db: SQLite.SQLiteDatabase
        syncDb: SynchronousDatabase
      }
    | undefined
}

export const getDbFilePath = (dbName: string) => {
  return `${ExpoFS.documentDirectory}SQLite/${dbName}`
}

export const overwriteDbFile = (dbName: string, data: Uint8Array) =>
  Effect.gen(function* () {
    const path = getDbFilePath(dbName)

    yield* Effect.promise(() => ExpoFS.deleteAsync(path, { idempotent: true }))

    // TODO avoid converting to string once the ExpoFS API supports binary data
    const b64String = base64.encode(data)
    yield* Effect.promise(() => ExpoFS.writeAsStringAsync(path, b64String, { encoding: ExpoFS.EncodingType.Base64 }))
  })
