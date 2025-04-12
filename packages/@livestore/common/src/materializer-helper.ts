import { isReadonlyArray } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import { SessionIdSymbol } from './adapter-types.js'
import { isQueryBuilder } from './query-builder/api.js'
import type { EventDef, Materializer, MaterializerResult } from './schema/EventDef.js'
import type * as LiveStoreEvent from './schema/LiveStoreEvent.js'
import type { BindValues } from './sql-queries/sql-queries.js'
import type { PreparedBindValues } from './util.js'
import { prepareBindValues } from './util.js'

export const getExecArgsFromEvent = ({
  eventDef: { eventDef, materializer },
  event,
}: {
  eventDef: {
    eventDef: EventDef.AnyWithoutFn
    materializer: Materializer
  }
  /** Both encoded and decoded mutation events are supported to reduce the number of times we need to decode/encode */
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
  const mutationArgsDecoded = event.decoded?.args ?? Schema.decodeUnknownSync(eventDef.schema)(event.encoded!.args)

  const res = materializer(mutationArgsDecoded, {
    clientOnly: eventDef.options.clientOnly,
    // TODO properly implement this
    currentFacts: new Map(),
  })

  const statementRes = mapMaterializerResult(res)

  return statementRes.map((statementRes) => {
    const statementSql = statementRes.sql

    const mutationArgsEncoded = event.encoded?.args ?? Schema.encodeUnknownSync(eventDef.schema)(event.decoded!.args)
    const bindValues = typeof statementRes === 'string' ? mutationArgsEncoded : statementRes.bindValues

    const writeTables = typeof statementRes === 'string' ? undefined : statementRes.writeTables

    return { statementSql, bindValues: prepareBindValues(bindValues ?? {}, statementSql), writeTables }
  })
}

const mapMaterializerResult = (
  materializerResult: MaterializerResult | ReadonlyArray<MaterializerResult>,
): ReadonlyArray<{
  sql: string
  bindValues: BindValues
  writeTables: ReadonlySet<string> | undefined
}> => {
  if (isReadonlyArray(materializerResult)) {
    return materializerResult.flatMap(mapMaterializerResult)
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
