import { Row, Statement, QualifiedTablename } from 'electric-sql/util'
import { DatabaseAdapter as DatabaseAdapterInterface, RunResult, Transaction as Tx } from 'electric-sql/electric'
import { ElectricClient, DbSchema } from 'electric-sql/client/model'
import { Store, MainDatabaseWrapper, DatabaseImpl, computed } from '@livestore/livestore'
import { PreparedBindValues } from '@livestore/livestore/util'

export interface LiveStoreDatabaseAdapterInterface extends DatabaseAdapterInterface {
  dbSchema: DbSchema<any>
}

type TableSchemas = Record<string, any>

/**
 * Adapter for ElectricSQL to use the Livestore databases.
 *
 * LiveStore has a main database and a storage database. The main database is synchronous
 * and on the main thread, while the storage database is asynchronous and runs in a
 * worker. All write operations are done on the main database and then asynchronously
 * replicated to the storage database. Read operations are done on the main database.
 *
 * Although `run`, `query`, `runInTransaction`, and `transaction` are async functions,
 * all operations inside these functions are synchronous and so there is no
 * risk of interleaving operations with those from Livestore.
 *
 * Additionally the adapter sets up reactivity with Livestore, so that when a table is
 * modified, ElectricSQL is notified of the change, and vice versa.
 */
export class DatabaseAdapter<DB extends DbSchema<TableSchemas>> implements LiveStoreDatabaseAdapterInterface {
  readonly store: Store
  readonly dbWrapper: MainDatabaseWrapper
  readonly mainDb: DatabaseImpl['mainDb']
  readonly storageDb: DatabaseImpl['storageDb']
  readonly dbSchema: DB

  constructor(store: Store, dbSchema: DB) {
    this.store = store
    this.dbSchema = dbSchema
    this.dbWrapper = store.mainDbWrapper
    this.mainDb = store.db.mainDb
    this.storageDb = store.db.storageDb
  }

  // Fully synchronous version of the run function
  #run({ sql, args }: Statement): RunResult {
    const params = args ? (args as PreparedBindValues) : undefined
    // console.log('Running SQL:', sql, 'with params:', params)
    const stmt = this.mainDb.prepare(sql)
    stmt.execute(params)
    stmt.finalize()
    // TODO: only run on storageDb if the query is not read-only
    this.storageDb.execute(sql, params, undefined) // This is an async function but we don't need to wait for it to finish
    return {
      rowsAffected: 0, // TODO: how to get this value? although its only used in the Electric DAL so not important
    }
  }

  // Public async run function
  async run(statement: Statement): Promise<RunResult> {
    return this.#run(statement)
  }

  // Fully synchronous version of the query function
  #query({ sql, args }: Statement): Row[] {
    const params = args ? (args as PreparedBindValues) : undefined
    const stmt = this.mainDb.prepare(sql)
    const rows = stmt.select<Row>(params)
    stmt.finalize()
    // TODO: only run on storageDb if the query is not read-only
    this.storageDb.execute(sql, params, undefined) // This is an async function but we don't need to wait for it to finish
    return rows as Row[]
  }

  // Public async query function
  async query(statement: Statement): Promise<Row[]> {
    return this.#query(statement)
  }

  async runInTransaction(...statements: Statement[]): Promise<RunResult> {
    // Although this is an async function to match the signature for Electric, all
    // operations inside the function is synchronous.
    return this.transaction((tx, setResult) => {
      //
      let rowsAffected = 0
      for (const stmt of statements) {
        tx.run(stmt, (tx, res) => {
          rowsAffected += res.rowsAffected
        })
      }
      setResult({
        rowsAffected: rowsAffected,
      })
    })
  }

  async transaction<T>(fn: (_tx: Tx, setResult: (res: T) => void) => void): Promise<T> {
    // Although this is an async function to match the signature for Electric, all
    // operations inside the function is synchronous.
    let transactionBegan = false
    try {
      this.#run({ sql: 'BEGIN;' })
      transactionBegan = true
      let result: T
      const tx: Tx = {
        run: (stmt, successCallback, errorCallback) => {
          try {
            const res: RunResult = this.#run(stmt)
            successCallback?.(tx, res)
          } catch (e) {
            errorCallback?.(e)
          }
        },
        query: (stmt, successCallback, errorCallback) => {
          try {
            const res = this.#query(stmt)
            successCallback(tx, res)
          } catch (e) {
            errorCallback?.(e)
          }
        },
      }
      fn(tx, (res: T) => {
        result = res
      })
      this.#run({ sql: 'COMMIT;' })
      return result!
    } catch (e) {
      if (transactionBegan) {
        this.run({ sql: 'ROLLBACK;' })
      }
      throw e
    }
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {
    return Array.from(this.dbWrapper.getTablesUsed(sql)).map((name) => {
      if (name.includes('.')) {
        const [schema, table] = name.split('.')
        return new QualifiedTablename(schema, table)
      } else {
        return new QualifiedTablename('main', name)
      }
    })
  }
}
