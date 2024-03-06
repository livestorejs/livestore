import type { DatabaseFactory, DatabaseImpl, MainDatabase, StorageDatabase } from '@livestore/common'
import * as SQLite from 'expo-sqlite/next'

export const makeDb =
  (dbFilename: string): DatabaseFactory =>
  ({}) => {
    const db = SQLite.openDatabaseSync(dbFilename)

    const mainDb = {
      filename: dbFilename,
      prepare: (value) => {
        const stmt = db.prepareSync(value)
        return {
          execute: (bindValues) => {
            const res = stmt.executeSync(bindValues ?? [])
            res.resetSync()
          },
          select: (bindValues) => {
            const res = stmt.executeSync(bindValues ?? [])
            try {
              return res.getAllSync() as any
            } finally {
              res.resetSync()
            }
          },
          finalize: () => stmt.finalizeSync(),
        }
      },
      execute: (queryStr, bindValues) => {
        const stmt = db.prepareSync(queryStr)
        try {
          stmt.executeSync(bindValues ?? [])
        } finally {
          stmt.finalizeSync()
        }
      },
      export: () => {
        console.error(`export not yet implemented`)
        return new Uint8Array([])
      },
      dangerouslyReset: async () => {
        console.error(`dangerouslyReset not yet implemented`)
      },
    } satisfies MainDatabase

    const storageDb = {
      filename: '__unused__',
      execute: async () => {},
      // TODO actually implement this
      mutate: async () => {},
      export: async () => undefined,
      dangerouslyReset: async () => {},
      // TODO actually implement this
      getMutationLogData: async () => new Uint8Array([]),
    } satisfies StorageDatabase

    return { mainDb, storageDb } satisfies DatabaseImpl
  }
