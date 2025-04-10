import { LS_DEV, memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import { Effect, ReadonlyArray, Schema } from '@livestore/utils/effect'

import type { SqliteDb } from '../adapter-types.js'
import { getExecArgsFromMutation } from '../mutation.js'
import type { LiveStoreEvent, LiveStoreSchema, SessionChangesetMetaRow } from '../schema/mod.js'
import {
  EventId,
  getMutationDef,
  MUTATION_LOG_META_TABLE,
  SESSION_CHANGESET_META_TABLE,
  sessionChangesetMetaTable,
} from '../schema/mod.js'
import { insertRow } from '../sql-queries/index.js'
import { sql } from '../util.js'
import { execSql, execSqlPrepared } from './connection.js'
import * as Mutationlog from './mutationlog.js'
import type { ApplyMutation } from './types.js'

export const makeApplyMutation = ({
  schema,
  dbReadModel: db,
  dbMutationLog,
}: {
  schema: LiveStoreSchema
  dbReadModel: SqliteDb
  dbMutationLog: SqliteDb
}): Effect.Effect<ApplyMutation, never> =>
  Effect.gen(function* () {
    const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(schema)

    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...schema.eventsDefsMap.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    return (mutationEventEncoded, options) =>
      Effect.gen(function* () {
        const skipMutationLog = options?.skipMutationLog ?? false

        const mutationName = mutationEventEncoded.mutation
        const mutationDef = getMutationDef(schema, mutationName)

        const execArgsArr = getExecArgsFromMutation({
          mutationDef,
          mutationEvent: { decoded: undefined, encoded: mutationEventEncoded },
        })

        // NOTE we might want to bring this back if we want to debug no-op mutations
        // const makeExecuteOptions = (statementSql: string, bindValues: any) => ({
        //   onRowsChanged: (rowsChanged: number) => {
        //     if (rowsChanged === 0) {
        //       console.warn(`Mutation "${mutationDef.name}" did not affect any rows:`, statementSql, bindValues)
        //     }
        //   },
        // })

        // console.group('[@livestore/common:leader-thread:applyMutation]', { mutationName })

        const session = db.session()

        for (const { statementSql, bindValues } of execArgsArr) {
          // console.debug(mutationName, statementSql, bindValues)
          // TODO use cached prepared statements instead of exec
          yield* execSqlPrepared(db, statementSql, bindValues)
        }

        const changeset = session.changeset()
        session.finish()

        // TODO use prepared statements
        yield* execSql(
          db,
          ...insertRow({
            tableName: SESSION_CHANGESET_META_TABLE,
            columns: sessionChangesetMetaTable.sqliteDef.columns,
            values: {
              idGlobal: mutationEventEncoded.id.global,
              idClient: mutationEventEncoded.id.client,
              // NOTE the changeset will be empty (i.e. null) for no-op mutations
              changeset: changeset ?? null,
              debug: LS_DEV ? execArgsArr : null,
            },
          }),
        )

        // console.groupEnd()

        // write to mutation_log
        const excludeFromMutationLog = shouldExcludeMutationFromLog(mutationName, mutationEventEncoded)
        if (skipMutationLog === false && excludeFromMutationLog === false) {
          const mutationName = mutationEventEncoded.mutation
          const mutationDefSchemaHash =
            mutationDefSchemaHashMap.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

          yield* Mutationlog.insertIntoMutationLog(
            mutationEventEncoded,
            dbMutationLog,
            mutationDefSchemaHash,
            mutationEventEncoded.clientId,
            mutationEventEncoded.sessionId,
          )
        } else {
          //   console.debug('[@livestore/common:leader-thread] skipping mutation log write', mutation, statementSql, bindValues)
        }

        return {
          sessionChangeset: changeset
            ? {
                _tag: 'sessionChangeset' as const,
                data: changeset,
                debug: LS_DEV ? execArgsArr : null,
              }
            : { _tag: 'no-op' as const },
        }
      }).pipe(
        Effect.withSpan(`@livestore/common:leader-thread:applyMutation`, {
          attributes: {
            mutationName: mutationEventEncoded.mutation,
            mutationId: mutationEventEncoded.id,
            'span.label': `${EventId.toString(mutationEventEncoded.id)} ${mutationEventEncoded.mutation}`,
          },
        }),
        // Effect.logDuration('@livestore/common:leader-thread:applyMutation'),
      )
  })

export const rollback = ({
  db,
  dbMutationLog,
  eventIdsToRollback,
}: {
  db: SqliteDb
  dbMutationLog: SqliteDb
  eventIdsToRollback: EventId.EventId[]
}) =>
  Effect.gen(function* () {
    const rollbackEvents = db
      .select<SessionChangesetMetaRow>(
        sql`SELECT * FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.client})`).join(', ')})`,
      )
      .map((_) => ({ id: { global: _.idGlobal, client: _.idClient }, changeset: _.changeset, debug: _.debug }))
      .toSorted((a, b) => EventId.compare(a.id, b.id))

    // Apply changesets in reverse order
    for (let i = rollbackEvents.length - 1; i >= 0; i--) {
      const { changeset } = rollbackEvents[i]!
      if (changeset !== null) {
        db.makeChangeset(changeset).invert().apply()
      }
    }

    const eventIdPairChunks = ReadonlyArray.chunksOf(100)(
      eventIdsToRollback.map((id) => `(${id.global}, ${id.client})`),
    )

    // Delete the changeset rows
    for (const eventIdPairChunk of eventIdPairChunks) {
      db.execute(
        sql`DELETE FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdPairChunk.join(', ')})`,
      )
    }

    // Delete the mutation log rows
    for (const eventIdPairChunk of eventIdPairChunks) {
      dbMutationLog.execute(
        sql`DELETE FROM ${MUTATION_LOG_META_TABLE} WHERE (idGlobal, idClient) IN (${eventIdPairChunk.join(', ')})`,
      )
    }
  }).pipe(
    Effect.withSpan('@livestore/common:LeaderSyncProcessor:rollback', {
      attributes: { count: eventIdsToRollback.length },
    }),
  )

// TODO let's consider removing this "should exclude" mechanism in favour of log compaction etc
const makeShouldExcludeMutationFromLog = memoizeByRef((schema: LiveStoreSchema) => {
  const migrationOptions = schema.migrationOptions
  const mutationLogExclude =
    migrationOptions.strategy === 'from-mutation-log'
      ? (migrationOptions.excludeMutations ?? new Set(['livestore.RawSql']))
      : new Set(['livestore.RawSql'])

  return (mutationName: string, mutationEventEncoded: LiveStoreEvent.AnyEncoded): boolean => {
    if (mutationLogExclude.has(mutationName)) return true

    const mutationDef = getMutationDef(schema, mutationName)
    const execArgsArr = getExecArgsFromMutation({
      mutationDef,
      mutationEvent: { decoded: undefined, encoded: mutationEventEncoded },
    })

    return execArgsArr.some((_) => _.statementSql.includes('__livestore'))
  }
})
