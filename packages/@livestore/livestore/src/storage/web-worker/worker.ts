// Web Worker file for running SQLite in a web worker.

// TODO: create types for these libraries? SQL.js already should have types;
// we just need the types to apply to the fork.
import { shouldNeverHappen } from '@livestore/utils'
import * as Comlink from 'comlink'
import type * as SqliteWasm from 'sqlite-esm'
import sqlite3InitModule from 'sqlite-esm'

// import { v4 as uuid } from 'uuid'
import type { Bindable } from '../../util.js'
import { casesHandled, sql } from '../../util.js'
import { IDB } from '../utils/idb.js'
import type { StorageOptionsWeb } from './index.js'

// A global variable to hold the database connection.
// let db: SqliteWasm.Database
let db: SqliteWasm.DatabaseApi

let sqlite3: SqliteWasm.Sqlite3Static

// TODO get rid of this in favour of a "proper" IDB SQLite storage
let idb: IDB | undefined

/** The location where this database storage persists its data */
let options_: StorageOptionsWeb

const configureConnection = () =>
  db.exec(sql`
    PRAGMA page_size=8192;
    PRAGMA journal_mode=MEMORY;
    PRAGMA foreign_keys='ON'; -- we want foreign key constraints to be enforced
  `)

/** A full virtual filename in the IDB FS */
const fullyQualifiedFilename = (name: string) => `${name}.db`

const initialize = async (options: StorageOptionsWeb) => {
  options_ = options

  sqlite3 = await sqlite3InitModule({
    print: (message) => console.log(`[sql-client] ${message}`),
    printErr: (message) => console.error(`[sql-client] ${message}`),
  })

  switch (options.type) {
    case 'opfs': {
      try {
        db = new sqlite3.oo1.OpfsDb(fullyQualifiedFilename(options.fileName)) // , 'c'
      } catch (e) {
        debugger
      }
      break
    }
    case 'indexeddb': {
      try {
        db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' })
        idb = new IDB(options.fileName)

        const bytes = await idb.get('db')

        if (bytes !== undefined) {
          // Based on https://sqlite.org/forum/forumpost/2119230da8ac5357a13b731f462dc76e08621a4a29724f7906d5f35bb8508465
          // TODO find cleaner way to do this once possible in sqlite3-wasm
          const p = sqlite3.wasm.allocFromTypedArray(bytes)
          const _rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', p, bytes.length, bytes.length, 0)
        }
      } catch (e) {
        debugger
      }
      break
    }
    default: {
      casesHandled(options.type)
    }
  }

  configureConnection()
}

// TODO get rid of this in favour of a "proper" IDB SQLite storage
let idbPersistTimeout: NodeJS.Timeout | undefined

type ExecutionQueueItem = { query: string; bindValues?: Bindable }

const executeBulk = (executionItems: ExecutionQueueItem[]): void => {
  let batchItems: ExecutionQueueItem[] = []

  while (executionItems.length > 0) {
    try {
      db.exec('BEGIN TRANSACTION') // Start the transaction

      batchItems = executionItems.splice(0, 50)

      for (const { query, bindValues } of batchItems) {
        db.exec({
          sql: query,
          bind: bindValues as TODO,
          returnValue: 'resultRows',
          rowMode: 'object',
        })
      }

      db.exec('COMMIT') // Commit the transaction
    } catch (error) {
      try {
        db.exec('ROLLBACK') // Rollback in case of an error
      } catch (e) {
        console.error('Error rolling back transaction', e)
      }

      shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
    }
  }

  // TODO get rid of this in favour of a "proper" IDB SQLite storage
  if (options_.type === 'indexeddb') {
    if (idbPersistTimeout !== undefined) {
      clearTimeout(idbPersistTimeout)
    }

    idbPersistTimeout = setTimeout(() => {
      const data = sqlite3.capi.sqlite3_js_db_export(db.pointer) as Uint8Array

      void idb!.put('db', data)
    }, 1000)
  }
}

const wrappedWorker = { initialize, executeBulk }

export type WrappedWorker = typeof wrappedWorker

Comlink.expose(wrappedWorker)

// NOTE keep this around for debugging
// db.exec({
//   sql: `select * from sqlite_master where name = 'library_tracks'`,
//   callback: (_: TODO) => console.log(_),
//   rowMode: 'object',
// } as TODO)
