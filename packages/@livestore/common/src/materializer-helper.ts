import { Schema } from '@livestore/utils/effect'

import { SessionIdSymbol } from './adapter-types.js'
import type { QueryBuilder } from './query-builder/api.js'
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
  let statementRes: ReadonlyArray<
    string | { sql: string; bindValues: Record<string, unknown>; writeTables?: ReadonlySet<string> }
  >

  switch (typeof materializer) {
    case 'function': {
      const mutationArgsDecoded = event.decoded?.args ?? Schema.decodeUnknownSync(eventDef.schema)(event.encoded!.args)

      const res = materializer(mutationArgsDecoded, {
        clientOnly: eventDef.options.clientOnly,
        // TODO properly implement this
        currentFacts: new Map(),
      })

      statementRes = (Array.isArray(res) ? res : [res]).map((_: QueryBuilder.Any | MaterializerResult) => {
        if (isQueryBuilder(_)) {
          const { query, bindValues } = _.asSql()
          return { sql: query, bindValues: bindValues as BindValues }
        }

        return _
      })

      break
    }
    case 'string': {
      statementRes = [materializer]
      break
    }
    default: {
      statementRes = materializer
      break
    }
  }

  return statementRes.map((statementRes) => {
    const statementSql = typeof statementRes === 'string' ? statementRes : statementRes.sql

    const mutationArgsEncoded = event.encoded?.args ?? Schema.encodeUnknownSync(eventDef.schema)(event.decoded!.args)
    const bindValues = typeof statementRes === 'string' ? mutationArgsEncoded : statementRes.bindValues

    const writeTables = typeof statementRes === 'string' ? undefined : statementRes.writeTables

    return { statementSql, bindValues: prepareBindValues(bindValues ?? {}, statementSql), writeTables }
  })
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
