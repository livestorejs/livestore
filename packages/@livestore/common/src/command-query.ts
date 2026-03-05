import { Schema } from '@livestore/utils/effect'

import type { SqliteDb } from './adapter-types.ts'
import type { CommandHandlerContextQuery } from './schema/command/command-handler.ts'
import { isQueryBuilder } from './schema/state/sqlite/query-builder/api.ts'
import { getResultSchema } from './schema/state/sqlite/query-builder/impl.ts'
import type { QueryBuilder } from './schema/state/sqlite/query-builder/mod.ts'
import { type Bindable, prepareBindValues } from './util.ts'

/**
 * Create a {@link CommandHandlerContextQuery} function backed by a given SQLite database.
 *
 * Supports both type-safe query builders and raw SQL queries.
 */
export const makeCommandQueryFn = (db: SqliteDb): CommandHandlerContextQuery =>
  ((rawQueryOrQueryBuilder: { query: string; bindValues: Bindable } | QueryBuilder.Any) => {
    if (isQueryBuilder(rawQueryOrQueryBuilder) === true) {
      const { query, bindValues } = rawQueryOrQueryBuilder.asSql()
      const rawResults = db.select(query, prepareBindValues(bindValues, query))
      const resultSchema = getResultSchema(rawQueryOrQueryBuilder)
      return Schema.decodeSync(resultSchema)(rawResults)
    } else {
      const { query, bindValues } = rawQueryOrQueryBuilder
      return db.select(query, prepareBindValues(bindValues, query))
    }
  }) as CommandHandlerContextQuery
