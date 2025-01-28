import { Schema } from '@livestore/utils/effect'

import { SessionIdSymbol } from './adapter-types.js'
import type * as MutationEvent from './schema/MutationEvent.js'
import type { MutationDef } from './schema/mutations.js'
import type { PreparedBindValues } from './util.js'
import { prepareBindValues } from './util.js'

export const getExecArgsFromMutation = ({
  mutationDef,
  mutationEvent,
}: {
  mutationDef: MutationDef.Any
  /** Both encoded and decoded mutation events are supported to reduce the number of times we need to decode/encode */
  mutationEvent:
    | {
        decoded: MutationEvent.AnyDecoded | MutationEvent.PartialAnyDecoded
        encoded: undefined
      }
    | {
        decoded: undefined
        encoded: MutationEvent.AnyEncoded | MutationEvent.PartialAnyEncoded
      }
}): ReadonlyArray<{
  statementSql: string
  bindValues: PreparedBindValues
  writeTables: ReadonlySet<string> | undefined
}> => {
  let statementRes: ReadonlyArray<
    string | { sql: string; bindValues: Record<string, unknown>; writeTables?: ReadonlySet<string> }
  >

  switch (typeof mutationDef.sql) {
    case 'function': {
      const mutationArgsDecoded =
        mutationEvent.decoded?.args ?? Schema.decodeUnknownSync(mutationDef.schema)(mutationEvent.encoded!.args)
      const res = mutationDef.sql(mutationArgsDecoded)
      statementRes = Array.isArray(res) ? res : [res]
      break
    }
    case 'string': {
      statementRes = [mutationDef.sql]
      break
    }
    default: {
      statementRes = mutationDef.sql
      break
    }
  }

  return statementRes.map((statementRes) => {
    const statementSql = typeof statementRes === 'string' ? statementRes : statementRes.sql

    const mutationArgsEncoded =
      mutationEvent.encoded?.args ?? Schema.encodeUnknownSync(mutationDef.schema)(mutationEvent.decoded!.args)
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
