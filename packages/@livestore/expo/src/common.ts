import type { SynchronousDatabase } from '@livestore/common'
import { base64, shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import * as ExpoFS from 'expo-file-system'
import type * as SQLite from 'expo-sqlite/next'

export const makeSynchronousDatabase = (db: SQLite.SQLiteDatabase): SynchronousDatabase => {
  const syncDb: SynchronousDatabase = {
    _tag: 'SynchronousDatabase',
    prepare: (queryStr) => {
      try {
        const stmt = db.prepareSync(queryStr)
        return {
          execute: (bindValues) => {
            // console.log('execute', queryStr, bindValues)
            const res = stmt.executeSync(bindValues ?? ([] as any))
            res.resetSync()
            return () => res.changes
          },
          select: (bindValues) => {
            const res = stmt.executeSync(bindValues ?? ([] as any))
            try {
              return res.getAllSync() as any
            } finally {
              res.resetSync()
            }
          },
          finalize: () => stmt.finalizeSync(),
        }
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
