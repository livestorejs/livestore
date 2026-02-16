import { Schema } from '@livestore/utils/effect'

import { type SqliteDb, SqliteError } from './adapter-types.ts'
import { getResultSchema, isQueryBuilder } from './schema/state/sqlite/query-builder/mod.ts'
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

    if (isQueryBuilder(queryStrOrQueryBuilder)) {
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

    if (isQueryBuilder(queryStrOrQueryBuilder)) {
      const { query, bindValues } = queryStrOrQueryBuilder.asSql()
      const resultSchema = getResultSchema(queryStrOrQueryBuilder)
      const results = select(query, bindValues as unknown as PreparedBindValues)
      return Schema.decodeSync(resultSchema)(results)
    } else {
      return select(queryStrOrQueryBuilder, maybeBindValues)
    }
  }
}

export const validateSnapshot = (snapshot: Uint8Array) => {
  const headerBytes = new TextDecoder().decode(snapshot.slice(0, 16))
  const hasValidHeader = headerBytes.startsWith('SQLite format 3')

  if (!hasValidHeader) {
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
