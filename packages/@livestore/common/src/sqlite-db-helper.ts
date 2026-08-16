import { Effect, Exit, Function, Schema } from '@livestore/utils/effect'

import { type SqliteDb, SqliteError } from './adapter-types.ts'
import { getResultSchema, isQueryBuilder } from './schema/state/sqlite/query-builder/mod.ts'
import * as StateSqliteDb from './StateSqliteDb.ts'
import type { PreparedBindValues } from './util.ts'

export const makeExecute = (
  execute: (
    queryStr: string,
    bindValues: PreparedBindValues | undefined,
    options?: { onRowsChanged?: (rowsChanged: number) => void },
  ) => void,
): SqliteDb['execute'] => {
  return (...args: any[]) => {
    const [queryStrOrQueryBuilder, bindValuesOrOptions, maybeOptions] = args

    if (isQueryBuilder(queryStrOrQueryBuilder) === true) {
      const { query, bindValues } = queryStrOrQueryBuilder.asSql()
      return execute(query, bindValues as unknown as PreparedBindValues, bindValuesOrOptions)
    } else {
      return execute(queryStrOrQueryBuilder, bindValuesOrOptions, maybeOptions)
    }
  }
}

export const makeSelect = <T>(
  select: (queryStr: string, bindValues: PreparedBindValues | undefined) => ReadonlyArray<T>,
): SqliteDb['select'] => {
  return (...args: any[]) => {
    const [queryStrOrQueryBuilder, maybeBindValues] = args

    if (isQueryBuilder(queryStrOrQueryBuilder) === true) {
      const { query, bindValues } = queryStrOrQueryBuilder.asSql()
      const resultSchema = getResultSchema(queryStrOrQueryBuilder)
      const results = select(query, bindValues as unknown as PreparedBindValues)
      return Schema.decodeUnknownSync(resultSchema)(results)
    } else {
      return select(queryStrOrQueryBuilder, maybeBindValues)
    }
  }
}

/**
 * Runs an Effect inside an SQLite savepoint.
 *
 * @remarks
 *
 * This starts a savepoint before running `effect`, releases the savepoint on
 * success, and rolls back to the savepoint before re-emitting the original
 * failure on failure.
 *
 * Use this for atomic DB updates that need to compose with callers that may
 * already have an open transaction.
 *
 * @see {@link https://sqlite.org/lang_savepoint.html | SQLite savepoint documentation}
 * @see {@link https://sqlite.org/lang_transaction.html | SQLite transaction documentation}
 */
export const withSavepoint: {
  (db: SqliteDb): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqliteError, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, db: SqliteDb): Effect.Effect<A, E | SqliteError, R>
} = Function.dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, db: SqliteDb): Effect.Effect<A, E | SqliteError, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.sync(generateSavepointName).pipe(
        Effect.flatMap((savepointName) => {
          const savepointSql = `SAVEPOINT ${savepointName}`
          const releaseSql = `RELEASE SAVEPOINT ${savepointName}`

          return executeSavepointSql(db, savepointSql).pipe(
            // Cleanup is installed only after SQLite successfully creates the savepoint.
            Effect.andThen(
              restore(self).pipe(
                Effect.exit,
                Effect.flatMap((exit) => {
                  const cleanup =
                    Exit.isSuccess(exit) === true
                      ? executeSavepointSql(db, releaseSql)
                      : executeSavepointSql(db, `ROLLBACK TO SAVEPOINT ${savepointName}`).pipe(
                          Effect.andThen(executeSavepointSql(db, releaseSql)),
                        )

                  // Cleanup failures supersede the wrapped exit because the connection state is uncertain.
                  return cleanup.pipe(Effect.andThen(exit))
                }),
              ),
            ),
          )
        }),
      ),
    ),
)

/** Runs an Effect in a savepoint on the materialized-state database service. */
export const withStateDbSavepoint = <A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SqliteError, R | StateSqliteDb.StateSqliteDb> =>
  Effect.flatMap(StateSqliteDb.StateSqliteDb, (dbState) => withSavepoint(self, dbState))

let nextSavepointId = 0

/** Uses a reserved prefix and process-local counter to avoid caller-controlled or reused identifiers. */
const generateSavepointName = () => `livestore_savepoint_${nextSavepointId++}`

const executeSavepointSql = (db: SqliteDb, sql: string): Effect.Effect<void, SqliteError> =>
  Effect.try({
    try: () => db.execute(sql),
    catch: (cause) => new SqliteError({ cause, query: { sql, bindValues: [] } }),
  })

export const validateSnapshot = (snapshot: Uint8Array) => {
  const headerBytes = new TextDecoder().decode(snapshot.slice(0, 16))
  const hasValidHeader = headerBytes.startsWith('SQLite format 3')

  if (hasValidHeader === false) {
    throw new SqliteError({
      cause: 'Invalid SQLite header',
      note: `Expected header to start with 'SQLite format 3', but got: ${headerBytes}`,
    })
  }
}

export const makeExport = (exportFn: () => Uint8Array<ArrayBuffer>) => () => {
  const snapshot = exportFn()
  validateSnapshot(snapshot)
  return snapshot
}
