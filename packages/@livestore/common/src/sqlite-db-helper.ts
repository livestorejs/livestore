import { Effect, Exit, Schema } from '@livestore/utils/effect'

import { type SqliteDb, SqliteError } from './adapter-types.ts'
import { getResultSchema, isQueryBuilder } from './schema/state/sqlite/query-builder/mod.ts'
import { type PreparedBindValues, prepareBindValues, sql } from './util.ts'

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
      return Schema.decodeSync(resultSchema)(results)
    } else {
      return select(queryStrOrQueryBuilder, maybeBindValues)
    }
  }
}

export const hasTable = (db: SqliteDb, tableName: string) => {
  const statement = sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = $tableName`
  return db.select<{ name: string }>(statement, prepareBindValues({ tableName }, statement))[0] !== undefined
}

/**
 * Runs synchronous SQLite work inside a savepoint.
 *
 * @remarks
 *
 * Unlike `BEGIN TRANSACTION`, savepoints can be nested inside an existing SQLite
 * transaction. If `fn` throws, all writes since the savepoint are rolled back and
 * the original error is re-thrown. If `fn` returns, the savepoint is released.
 *
 * `savepointName` is interpolated as an SQLite identifier, so it must be a plain
 * identifier matching `/^[A-Za-z_][A-Za-z0-9_]*$/`.
 */
export const withSavepointSync = <T>({
  db,
  savepointName,
  fn,
}: {
  db: SqliteDb
  savepointName: string
  fn: () => T
}): T => {
  assertValidSavepointName(savepointName)

  db.execute(`SAVEPOINT ${savepointName}`)

  try {
    const result = fn()
    db.execute(`RELEASE SAVEPOINT ${savepointName}`)
    return result
  } catch (cause) {
    db.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`)
    db.execute(`RELEASE SAVEPOINT ${savepointName}`)
    throw cause
  }
}

/**
 * Runs an Effect inside an SQLite savepoint.
 *
 * @remarks
 *
 * This is the Effect equivalent of {@link withSavepointSync}. It starts a
 * savepoint before running `effect`, releases the savepoint on success, and rolls
 * back to the savepoint before re-emitting the original failure on failure.
 *
 * Use this for atomic DB updates that need to compose with callers that may
 * already have an open transaction.
 *
 * `savepointName` is interpolated as an SQLite identifier, so it must be a plain
 * identifier matching `/^[A-Za-z_][A-Za-z0-9_]*$/`.
 */
export const withSavepoint = <A, E, R>({
  db,
  savepointName,
  effect,
}: {
  db: SqliteDb
  savepointName: string
  effect: Effect.Effect<A, E, R>
}): Effect.Effect<A, E, R> => {
  assertValidSavepointName(savepointName)

  return Effect.uninterruptibleMask((restore) =>
    Effect.sync(() => {
      db.execute(`SAVEPOINT ${savepointName}`)
    }).pipe(
      Effect.zipRight(restore(effect)),
      Effect.exit,
      Effect.flatMap((exit) => {
        const cleanup = Effect.sync(() => {
          if (Exit.isSuccess(exit) === true) {
            db.execute(`RELEASE SAVEPOINT ${savepointName}`)
          } else {
            db.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`)
            db.execute(`RELEASE SAVEPOINT ${savepointName}`)
          }
        })

        return Effect.zipRight(cleanup, exit)
      }),
    ),
  )
}

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

const assertValidSavepointName = (savepointName: string) => {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(savepointName) === false) {
    throw new SqliteError({
      cause: `Invalid SQLite savepoint name: ${savepointName}`,
      note: 'Savepoint names must be plain SQLite identifiers.',
    })
  }
}
