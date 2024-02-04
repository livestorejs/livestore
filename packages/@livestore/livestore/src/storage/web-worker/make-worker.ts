// TODO: create types for these libraries? SQL.js already should have types;
// we just need the types to apply to the fork.
import { shouldNeverHappen, uuid } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'
import * as Comlink from 'comlink'
import type * as SqliteWasm from 'sqlite-esm'
import sqlite3InitModule from 'sqlite-esm'

import { makeMutationArgsSchema, type MutationDefRecord, rawSqlMutation } from '../../schema/mutations.js'
// import { v4 as uuid } from 'uuid'
import { casesHandled, prepareBindValues, sql } from '../../utils/util.js'
import { IDB } from '../utils/idb.js'
import type { ExecutionBacklogItem } from './common.js'
import type { StorageOptionsWeb } from './index.js'

export const makeWorker = (mutations_?: MutationDefRecord) => {
  // A global variable to hold the database connection.
  let db: SqliteWasm.DatabaseApi

  let dbLog: SqliteWasm.DatabaseApi

  let sqlite3: SqliteWasm.Sqlite3Static

  const mutations = { ...mutations_, 'livestore.RawSql': rawSqlMutation } as MutationDefRecord

  const mutationArgsSchema = makeMutationArgsSchema(mutations)
  const schemaHashMap = new Map(Object.entries(mutations ?? {}).map(([k, v]) => [k, Schema.hash(v.schema)] as const))

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

  const initialize = async (options: StorageOptionsWeb) => {
    options_ = options

    sqlite3 = await sqlite3InitModule({
      print: (message) => console.log(`[sql-client] ${message}`),
      printErr: (message) => console.error(`[sql-client] ${message}`),
    })

    switch (options.type) {
      case 'opfs': {
        try {
          db = new sqlite3.oo1.OpfsDb(options.fileName) // , 'c'

          dbLog = new sqlite3.oo1.OpfsDb(options.fileName + '-log.db') // , 'c'
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

    // Creates `mutation_log` table if it doesn't exist
    dbLog.exec(sql`
      CREATE TABLE IF NOT EXISTS mutation_log (
        id TEXT PRIMARY KEY NOT NULL,
        mutation TEXT NOT NULL,
        args_json TEXT NOT NULL,
        schema_hash INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `)

    configureConnection()
  }

  // TODO get rid of this in favour of a "proper" IDB SQLite storage
  let idbPersistTimeout: NodeJS.Timeout | undefined

  const executeBulk = (executionItems: ExecutionBacklogItem[]): void => {
    let batchItems: ExecutionBacklogItem[] = []

    const createdAt = new Date().toISOString()

    while (executionItems.length > 0) {
      try {
        db.exec('BEGIN TRANSACTION') // Start the transaction
        dbLog.exec('BEGIN TRANSACTION') // Start the transaction

        batchItems = executionItems.splice(0, 50)

        for (const item of batchItems) {
          if (item._tag === 'execute') {
            const { query, bindValues } = item
            db.exec({ sql: query, bind: bindValues as TODO })

            // NOTE we're not writing `execute` events to the mutation_log
          } else {
            const { mutation, args } = Schema.decodeUnknownSync(mutationArgsSchema)(item.mutationArgsEncoded)

            const mutationDef = mutations![mutation]!

            const statementRes = typeof mutationDef.sql === 'function' ? mutationDef.sql(args) : mutationDef.sql
            const statementSql = typeof statementRes === 'string' ? statementRes : statementRes.sql

            const bindValues = typeof statementRes === 'string' ? args : statementRes.bindValues

            db.exec({ sql: statementSql, bind: prepareBindValues(bindValues, statementSql) as TODO })

            // write to mutation_log
            if (options_.type === 'opfs' && mutation !== 'livestore.RawSql') {
              const id = uuid()
              const schemaHash = schemaHashMap.get(mutation) ?? shouldNeverHappen(`Unknown mutation: ${mutation}`)

              const argsJson = JSON.stringify(item.mutationArgsEncoded.args)

              dbLog.exec({
                sql: `INSERT INTO mutation_log (id, mutation, args_json, schema_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
                bind: [id, item.mutationArgsEncoded.mutation, argsJson, schemaHash, createdAt],
              })
            }
          }
        }

        db.exec('COMMIT') // Commit the transaction
        dbLog.exec('COMMIT') // Commit the transaction
      } catch (error) {
        try {
          db.exec('ROLLBACK') // Rollback in case of an error
          dbLog.exec('ROLLBACK') // Rollback in case of an error
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

  Comlink.expose(wrappedWorker)

  // NOTE keep this around for debugging
  // db.exec({
  //   sql: `select * from sqlite_master where name = 'library_tracks'`,
  //   callback: (_: TODO) => console.log(_),
  //   rowMode: 'object',
  // } as TODO)

  return wrappedWorker
}
