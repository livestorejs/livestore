// Web Worker file for running SQLite in a web worker.

// TODO: create types for these libraries? SQL.js already should have types;
// we just need the types to apply to the fork.
import { shouldNeverHappen } from '@livestore/utils'
import * as Comlink from 'comlink'
import type * as SqliteWasm from 'sqlite-esm'
import sqlite3InitModule from 'sqlite-esm'

// import { v4 as uuid } from 'uuid'
import type { Bindable } from '../util.js'
import { casesHandled, sql } from '../util.js'
import type { SelectResponse, WritableDatabaseLocation } from './index.js'
import { IDB } from './utils/idb.js'

// A global variable to hold the database connection.
// let db: SqliteWasm.Database
let db: SqliteWasm.DatabaseApi

let sqlite3: SqliteWasm.Sqlite3Static

// TODO get rid of this in favour of a "proper" IDB SQLite backend
let idb: IDB | undefined

/** The location where this database backend persists its data */
let persistentDatabaseLocation_: WritableDatabaseLocation

const configureConnection = () =>
  db.exec(sql`
    PRAGMA page_size=8192;
    PRAGMA journal_mode=MEMORY;
    PRAGMA foreign_keys='ON'; -- we want foreign key constraints to be enforced
  `)

/** A full virtual filename in the IDB FS */
const fullyQualifiedFilename = (name: string) => `${name}.db`

const initialize = async ({ persistentDatabaseLocation }: { persistentDatabaseLocation: WritableDatabaseLocation }) => {
  persistentDatabaseLocation_ = persistentDatabaseLocation

  sqlite3 = await sqlite3InitModule({
    print: (message) => console.log(`[sql-client] ${message}`),
    printErr: (message) => console.error(`[sql-client] ${message}`),
  })

  switch (persistentDatabaseLocation.type) {
    case 'opfs': {
      try {
        db = new sqlite3.oo1.OpfsDb(fullyQualifiedFilename(persistentDatabaseLocation.virtualFilename)) // , 'c'
      } catch (e) {
        debugger
      }
      break
    }
    case 'indexeddb': {
      try {
        db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' })
        idb = new IDB(persistentDatabaseLocation.virtualFilename)

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
    case 'filesystem': {
      throw new Error('Persisting to native FS is not supported in the web worker backend')
    }
    case 'volatile-in-memory': {
      break
    }
    default: {
      casesHandled(persistentDatabaseLocation)
    }
  }

  configureConnection()
}

// TODO get rid of this in favour of a "proper" IDB SQLite backend
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

  // TODO get rid of this in favour of a "proper" IDB SQLite backend
  if (persistentDatabaseLocation_.type === 'indexeddb') {
    if (idbPersistTimeout !== undefined) {
      clearTimeout(idbPersistTimeout)
    }

    idbPersistTimeout = setTimeout(() => {
      const data = sqlite3.capi.sqlite3_js_db_export(db.pointer) as Uint8Array

      void idb!.put('db', data)
    }, 1000)
  }
}

const select = <T = any>(query: string, bindValues?: Bindable): SelectResponse<T> => {
  const resultRows: T[] = []

  db.exec({
    sql: query,
    bind: bindValues,
    rowMode: 'object',
    resultRows,
  } as TODO)

  return { results: resultRows }
}

const getPersistedData = async (): Promise<Uint8Array> => {
  // TODO get rid of this in favour of a "proper" IDB SQLite backend
  if (persistentDatabaseLocation_.type === 'indexeddb') {
    const data = sqlite3.capi.sqlite3_js_db_export(db.pointer)
    return Comlink.transfer(data, [data.buffer])
  }

  const rootHandle = await navigator.storage.getDirectory()
  const fileHandle = await rootHandle.getFileHandle(db.filename)
  const file = await fileHandle.getFile()
  const buffer = await file.arrayBuffer()
  const data = new Uint8Array(buffer)

  return Comlink.transfer(data, [data.buffer])
}

const wrappedWorker = { initialize, executeBulk, select, getPersistedData }

export type WrappedWorker = typeof wrappedWorker

Comlink.expose(wrappedWorker)

// NOTE keep this around for debugging
// db.exec({
//   sql: `select * from sqlite_master where name = 'library_tracks'`,
//   callback: (_: TODO) => console.log(_),
//   rowMode: 'object',
// } as TODO)
