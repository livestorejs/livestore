// import type { WaSqlite } from '@livestore/sqlite-wasm'
import { Effect } from '@livestore/utils/effect'

import type { SynchronousDatabase } from '../adapter-types.js'
import { SqliteError } from '../adapter-types.js'
import type { BindValues } from '../sql-queries/index.js'
import type { PreparedBindValues } from '../util.js'
import { prepareBindValues, sql } from '../util.js'

// TODO
namespace WaSqlite {
  export type SQLiteError = any
}

export const configureConnection = (syncDb: SynchronousDatabase, { fkEnabled }: { fkEnabled: boolean }) =>
  execSql(
    syncDb,
    sql`
    PRAGMA page_size=8192;
    PRAGMA journal_mode=MEMORY;
    ${fkEnabled ? sql`PRAGMA foreign_keys='ON';` : sql`PRAGMA foreign_keys='OFF';`}
  `,
    {},
  )

export const execSql = (syncDb: SynchronousDatabase, sql: string, bind: BindValues) => {
  const bindValues = prepareBindValues(bind, sql)
  return Effect.try({
    try: () => syncDb.execute(sql, bindValues),
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
export const execSqlPrepared = (syncDb: SynchronousDatabase, sql: string, bindValues: PreparedBindValues) => {
  return Effect.try({
    try: () => syncDb.execute(sql, bindValues),
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
