// import type { WaSqlite } from '@livestore/sqlite-wasm'
import { Effect } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.ts'
import { SqliteError } from '../adapter-types.ts'
import type { BindValues } from '../sql-queries/index.ts'
import type { PreparedBindValues } from '../util.ts'
import { prepareBindValues, sql } from '../util.ts'

// TODO
namespace WaSqlite {
  export type SQLiteError = any
}

export const configureConnection = (sqliteDb: SqliteDb, { fkEnabled }: { fkEnabled: boolean }) =>
  execSql(
    sqliteDb,
    sql`
    PRAGMA page_size=8192;
    /*
    The persisted databases use the AccessHandlePoolVFS which always uses a single database connection. Multiple
    connections are not supported. This means that we can use the exclusive locking mode to avoid unnecessary system
    calls and enable the use of the WAL journal mode without the use of shared memory.
    
    When connected to an in-memory database, this locking mode pragma is ignored because an in-memory database can only
    operate in exclusive locking mode. In-memory databases can’t share state between connections (unless using a shared
    cache), making concurrent access impossible. This is functionally equivalent to exclusive locking.
    */
    PRAGMA locking_mode=exclusive;
    /*
    The WAL journal mode is significantly faster in most scenarios than the traditional rollback journal mode. It
    specifically significantly improves write performance. However, when using the WAL journal mode, transactions
    that involve changes against multiple ATTACHed databases are atomic for each database but are not atomic
    across all databases as a set. Additionally, it is not possible to change the page size after entering WAL mode,
    whether on an empty database or by using VACUUM or the backup API. To change the page size, we must switch to the
    rollback journal mode.

    When connected to an in-memory database, the WAL journal mode option is ignored because an in-memory database can
    only be in either the MEMORY or OFF options. By default, an in-memory database is in the MEMORY option, which means
    that it stores the rollback journal in volatile RAM. This saves disk I/O but at the expense of safety and integrity.
    If the thread using SQLite crashes in the middle of a transaction, then the database file will very likely go
    corrupt. 
    */
    PRAGMA journal_mode=WAL;
    ${fkEnabled ? sql`PRAGMA foreign_keys='ON';` : sql`PRAGMA foreign_keys='OFF';`}
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
