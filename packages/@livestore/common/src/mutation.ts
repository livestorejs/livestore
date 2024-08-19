import { memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import { Schema } from '@livestore/utils/effect'

import type { LiveStoreSchema } from './schema/index.js'
import type { MutationDef, MutationEvent } from './schema/mutations.js'
import type { PreparedBindValues } from './util.js'
import { prepareBindValues } from './util.js'

export const getExecArgsFromMutation = ({
  mutationDef,
  mutationEventDecoded,
}: {
  mutationDef: MutationDef.Any
  mutationEventDecoded: MutationEvent.Any
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
      const res = mutationDef.sql(mutationEventDecoded.args)
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

    const bindValues =
      typeof statementRes === 'string'
        ? Schema.encodeUnknownSync(mutationDef.schema)(mutationEventDecoded.args)
        : statementRes.bindValues

    const writeTables = typeof statementRes === 'string' ? undefined : statementRes.writeTables

    return { statementSql, bindValues: prepareBindValues(bindValues ?? {}, statementSql), writeTables }
  })
}

export const makeShouldExcludeMutationFromLog = memoizeByRef((schema: LiveStoreSchema) => {
  const migrationOptions = schema.migrationOptions
  const mutationLogExclude =
    migrationOptions.strategy === 'from-mutation-log'
      ? (migrationOptions.excludeMutations ?? new Set(['livestore.RawSql']))
      : new Set(['livestore.RawSql'])

  return (mutationName: string, mutationEventDecoded: MutationEvent.Any): boolean => {
    if (mutationLogExclude.has(mutationName)) return true

    const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)
    const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

    return execArgsArr.some((_) => _.statementSql.includes('__livestore'))
  }
})
