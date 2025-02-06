// import type { WaSqlite } from '@livestore/sqlite-wasm'
import { Effect } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import { SqliteError } from '../adapter-types.js'
import type { BindValues } from '../sql-queries/index.js'
import type { PreparedBindValues } from '../util.js'
import { prepareBindValues, sql } from '../util.js'

// TODO
namespace WaSqlite {
  export type SQLiteError = any
}

type ConnectionOptions = {
  /**
   * The database connection locking mode.
   *
   * @remarks
   *
   * This **option is ignored** when used on an **in-memory database** as they can only operate in exclusive locking mode.
   * In-memory databases can’t share state between connections (unless using a
   * {@link https://www.sqlite.org/sharedcache.html#shared_cache_and_in_memory_databases|shared cache}),
   * making concurrent access impossible. This is functionally equivalent to exclusive locking.
   *
   * @defaultValue
   * The default is `"NORMAL"` unless it was unless overridden at compile-time using `SQLITE_DEFAULT_LOCKING_MODE`.
   *
   * @see {@link https://www.sqlite.org/pragma.html#pragma_locking_mode|`locking_mode` pragma}
   */
  lockingMode?: 'NORMAL' | 'EXCLUSIVE'

  /**
   * Whether to enforce foreign key constraints.
   *
   * @privateRemarks
   *
   * We require a value for this option to minimize future problems, as the default value might change in future
   * versions of SQLite.
   *
   * @see {@link https://www.sqlite.org/pragma.html#pragma_foreign_keys|`foreign_keys` pragma}
   */
  foreignKeys: boolean
}

export const configureConnection = (sqliteDb: SqliteDb, { foreignKeys, lockingMode }: ConnectionOptions) =>
  execSql(
    sqliteDb,
    // We use the WAL journal mode is significantly faster in most scenarios than the traditional rollback journal mode.
    // It specifically significantly improves write performance. However, when using the WAL journal mode, transactions
    // that involve changes against multiple ATTACHed databases are atomic for each database but are not atomic
    // across all databases as a set. Additionally, it is not possible to change the page size after entering WAL mode,
    // whether on an empty database or by using VACUUM or the backup API. To change the page size, we must switch to the
    // rollback journal mode.
    //
    // When connected to an in-memory database, the WAL journal mode option is ignored because an in-memory database can
    // only be in either the MEMORY or OFF options. By default, an in-memory database is in the MEMORY option, which
    // means that it stores the rollback journal in volatile RAM. This saves disk I/O but at the expense of safety and
    // integrity. If the thread using SQLite crashes in the middle of a transaction, then the database file will very
    // likely go corrupt.
    sql`
    PRAGMA journal_mode=WAL;
    PRAGMA page_size=8192;
    PRAGMA foreign_keys=${foreignKeys ? 'ON' : 'OFF'};
    ${lockingMode !== undefined && sql`PRAGMA locking_mode=${lockingMode};`}
  `,
    {},
  )

export const execSql = (sqliteDb: SqliteDb, sql: string, bind: BindValues) => {
  const bindValues = prepareBindValues(bind, sql)
  return Effect.try({
    try: () => sqliteDb.execute(sql, bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql }, code: (cause as WaSqlite.SQLiteError).code }),
  }).pipe(
    Effect.asVoid,
    // Effect.logDuration(`@livestore/common:execSql:${sql}`),
    Effect.withSpan(`@livestore/common:execSql`, {
      attributes: { 'span.label': sql, sql, bindValueKeys: Object.keys(bindValues) },
    }),
  )
}

// const selectSqlPrepared = <T>(stmt: PreparedStatement, bind: BindValues) => {
//   const bindValues = prepareBindValues(bind, stmt.sql)
//   return Effect.try({
//     try: () => stmt.select<T>(bindValues),
//     catch: (cause) =>
//       new SqliteError({ cause, query: { bindValues, sql: stmt.sql }, code: (cause as WaSqlite.SQLiteError).code }),
//   })
// }

// TODO actually use prepared statements
export const execSqlPrepared = (sqliteDb: SqliteDb, sql: string, bindValues: PreparedBindValues) => {
  return Effect.try({
    try: () => sqliteDb.execute(sql, bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql }, code: (cause as WaSqlite.SQLiteError).code }),
  }).pipe(
    Effect.asVoid,
    // Effect.logDuration(`@livestore/common:execSqlPrepared:${sql}`),
    Effect.withSpan(`@livestore/common:execSqlPrepared`, {
      attributes: {
        'span.label': sql,
        sql,
        bindValueKeys: Object.keys(bindValues),
      },
    }),
  )
}
