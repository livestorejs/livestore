import type { PreparedBindValues, SynchronousDatabase } from '@livestore/common'
import { prepareBindValues, sql, SqliteError } from '@livestore/common'
import type { BindValues } from '@livestore/common/sql-queries'
import { Effect } from '@livestore/utils/effect'

import type { WaSqlite } from '../sqlite/index.js'

export const configureConnection = (
  { syncDb }: { syncDb: SynchronousDatabase },
  { fkEnabled }: { fkEnabled: boolean },
) =>
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
export const execSqlPrepared = (syncDb: SynchronousDatabase, sql: string, bindValues: PreparedBindValues) => {
  return Effect.try({
    try: () => syncDb.execute(sql, bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql }, code: (cause as WaSqlite.SQLiteError).code }),
  }).pipe(Effect.asVoid)
}
