import { isDevEnv, isNil, isReadonlyArray } from '@livestore/utils'
import { Hash, Option, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from './adapter-types.js'
import { SessionIdSymbol } from './adapter-types.js'
import type { EventDef, Materializer, MaterializerContextQuery, MaterializerResult } from './schema/EventDef.js'
import type * as LiveStoreEvent from './schema/LiveStoreEvent.js'
import { getEventDef, type LiveStoreSchema } from './schema/schema.js'
import type { QueryBuilder } from './schema/state/sqlite/query-builder/api.js'
import { isQueryBuilder } from './schema/state/sqlite/query-builder/api.js'
import { getResultSchema } from './schema/state/sqlite/query-builder/impl.js'
import type { BindValues } from './sql-queries/sql-queries.js'
import type { ParamsObject, PreparedBindValues } from './util.js'
import { prepareBindValues } from './util.js'

export const getExecStatementsFromMaterializer = ({
  eventDef,
  materializer,
  dbState,
  event,
}: {
  eventDef: EventDef.AnyWithoutFn
  materializer: Materializer
  dbState: SqliteDb
  /** Both encoded and decoded events are supported to reduce the number of times we need to decode/encode */
  event:
    | {
        decoded: LiveStoreEvent.AnyDecoded | LiveStoreEvent.PartialAnyDecoded
        encoded: undefined
      }
    | {
        decoded: undefined
        encoded: LiveStoreEvent.AnyEncoded | LiveStoreEvent.PartialAnyEncoded
      }
}): ReadonlyArray<{
  statementSql: string
  bindValues: PreparedBindValues
  writeTables: ReadonlySet<string> | undefined
}> => {
  const eventArgsDecoded =
    event.decoded === undefined ? Schema.decodeUnknownSync(eventDef.schema)(event.encoded!.args) : event.decoded.args

  const eventArgsEncoded = isNil(event.decoded?.args)
    ? undefined
    : Schema.encodeUnknownSync(eventDef.schema)(event.decoded!.args)

  const query: MaterializerContextQuery = (
    rawQueryOrQueryBuilder:
      | {
          query: string
          bindValues: ParamsObject
        }
      | QueryBuilder.Any,
  ) => {
    if (isQueryBuilder(rawQueryOrQueryBuilder)) {
      const { query, bindValues } = rawQueryOrQueryBuilder.asSql()
      const rawResults = dbState.select(query, prepareBindValues(bindValues, query))
      const resultSchema = getResultSchema(rawQueryOrQueryBuilder)
      return Schema.decodeSync(resultSchema)(rawResults)
    } else {
      const { query, bindValues } = rawQueryOrQueryBuilder
      return dbState.select(query, prepareBindValues(bindValues, query))
    }
  }

  const statementResults = fromMaterializerResult(
    materializer(eventArgsDecoded, {
      eventDef,
      query,
      // TODO properly implement this
      currentFacts: new Map(),
    }),
  )

  return statementResults.map((statementRes) => {
    const statementSql = statementRes.sql

    const bindValues = typeof statementRes === 'string' ? eventArgsEncoded : statementRes.bindValues

    const writeTables = typeof statementRes === 'string' ? undefined : statementRes.writeTables

    return { statementSql, bindValues: prepareBindValues(bindValues ?? {}, statementSql), writeTables }
  })
}

export const makeMaterializerHash =
  ({ schema, dbState }: { schema: LiveStoreSchema; dbState: SqliteDb }) =>
  (event: LiveStoreEvent.AnyEncodedGlobal): Option.Option<number> => {
    if (isDevEnv()) {
      const { eventDef, materializer } = getEventDef(schema, event.name)
      const materializerResults = getExecStatementsFromMaterializer({
        eventDef,
        materializer,
        dbState,
        event: { decoded: undefined, encoded: event },
      })
      return Option.some(Hash.string(JSON.stringify(materializerResults)))
    }

    return Option.none()
  }

export const hashMaterializerResults = (
  materializerResults: ReadonlyArray<{
    statementSql: string
    bindValues: PreparedBindValues
    writeTables: ReadonlySet<string> | undefined
  }>,
) => Hash.string(JSON.stringify(materializerResults))

const fromMaterializerResult = (
  materializerResult: MaterializerResult | ReadonlyArray<MaterializerResult>,
): ReadonlyArray<{
  sql: string
  bindValues: BindValues
  writeTables: ReadonlySet<string> | undefined
}> => {
  if (isReadonlyArray(materializerResult)) {
    return materializerResult.flatMap(fromMaterializerResult)
  }
  if (isQueryBuilder(materializerResult)) {
    const { query, bindValues } = materializerResult.asSql()
    return [{ sql: query, bindValues: bindValues as BindValues, writeTables: undefined }]
  } else if (typeof materializerResult === 'string') {
    return [{ sql: materializerResult, bindValues: {} as BindValues, writeTables: undefined }]
  } else {
    return [
      {
        sql: materializerResult.sql,
        bindValues: materializerResult.bindValues,
        writeTables: materializerResult.writeTables,
      },
    ]
  }
}

// NOTE we should explore whether there is a more elegant solution
// e.g. by leveraging the schema to replace the sessionIdSymbol
export const replaceSessionIdSymbol = (
  bindValues: Record<string, unknown> | ReadonlyArray<unknown>,
  sessionId: string,
) => {
  deepReplaceValue(bindValues, SessionIdSymbol, sessionId)
}

const deepReplaceValue = <S, R>(input: any, searchValue: S, replaceValue: R): void => {
  if (Array.isArray(input)) {
    for (const i in input) {
      if (input[i] === searchValue) {
        input[i] = replaceValue
      } else {
        deepReplaceValue(input[i], searchValue, replaceValue)
      }
    }
  } else if (typeof input === 'object' && input !== null) {
    for (const key in input) {
      if (input[key] === searchValue) {
        input[key] = replaceValue
      } else {
        deepReplaceValue(input[key], searchValue, replaceValue)
      }
    }
  }
}
