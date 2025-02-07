import type { PreparedBindValues, SqliteDb } from '@livestore/common'
import { prepareBindValues, SqliteError } from '@livestore/common'
import type { BindValues } from '@livestore/common/sql-queries'
import type { WaSqlite } from '@livestore/sqlite-wasm'
import { Effect } from '@livestore/utils/effect'

export const execSql = (sqliteDb: SqliteDb, sql: string, bind: BindValues) => {
  const bindValues = prepareBindValues(bind, sql)
  return Effect.try({
    try: () => sqliteDb.execute(sql, bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql }, code: (cause as WaSqlite.SQLiteError).code }),
  }).pipe(Effect.asVoid)
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
  }).pipe(Effect.asVoid)
}
