import { env, memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import type { Scope } from '@livestore/utils/effect'
import { Effect, Option, Schema } from '@livestore/utils/effect'

import type { SqliteError, SynchronousDatabase, UnexpectedError } from '../index.js'
import {
  getExecArgsFromMutation,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  SESSION_CHANGESET_META_TABLE,
  sessionChangesetMetaTable,
} from '../index.js'
import type { LiveStoreSchema, MutationEvent } from '../schema/index.js'
import { insertRow } from '../sql-queries/index.js'
import { execSql, execSqlPrepared } from './connection.js'
import { LeaderThreadCtx } from './types.js'

export type ApplyMutation = (
  mutationEventEncoded: MutationEvent.AnyEncoded,
  options: {
    persisted: boolean
  },
) => Effect.Effect<void, SqliteError | UnexpectedError>

export const makeApplyMutation: Effect.Effect<ApplyMutation, never, Scope.Scope | LeaderThreadCtx> = Effect.gen(
  function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(leaderThreadCtx.schema)

    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...leaderThreadCtx.schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    return (mutationEventEncoded, { persisted }) =>
      Effect.gen(function* () {
        const { mutationEventSchema, schema, db, dbLog } = leaderThreadCtx
        const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

        const mutationName = mutationEventDecoded.mutation
        const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        // console.group('[@livestore/common:leader-thread:applyMutation]', { mutationName })

        const session = env('VITE_LIVESTORE_EXPERIMENTAL_SYNC_NEXT') ? db.session() : undefined

        for (const { statementSql, bindValues } of execArgsArr) {
          // console.debug(mutationName, statementSql, bindValues)
          // TODO use cached prepared statements instead of exec
          yield* execSqlPrepared(db, statementSql, bindValues)
        }

        if (session !== undefined) {
          const changeset = session.changeset()
          session.finish()
          // NOTE for no-op mutations (e.g. if the state didn't change) the changeset will be empty
          // TODO possibly write a null value instead of omitting the row
          if (changeset.length > 0) {
            // TODO use prepared statements
            yield* execSql(
              db,
              ...insertRow({
                tableName: SESSION_CHANGESET_META_TABLE,
                columns: sessionChangesetMetaTable.sqliteDef.columns,
                values: {
                  idGlobal: mutationEventEncoded.id.global,
                  idLocal: mutationEventEncoded.id.local,
                  changeset,
                },
              }),
            )
          }
        }

        // console.groupEnd()

        // write to mutation_log
        const excludeFromMutationLog = shouldExcludeMutationFromLog(mutationName, mutationEventDecoded)
        if (persisted && excludeFromMutationLog === false) {
          yield* insertIntoMutationLog(mutationEventEncoded, dbLog, mutationDefSchemaHashMap)
        } else {
          //   console.debug('[@livestore/common:leader-thread] skipping mutation log write', mutation, statementSql, bindValues)
        }
      }).pipe(
        Effect.withSpan(`@livestore/common:leader-thread:applyMutation`, {
          attributes: {
            mutationName: mutationEventEncoded.mutation,
            mutationId: mutationEventEncoded.id,
            persisted,
            'span.label': mutationEventEncoded.mutation,
          },
        }),
        // Effect.logDuration('@livestore/common:leader-thread:applyMutation'),
      )
  },
)

const insertIntoMutationLog = (
  mutationEventEncoded: MutationEvent.AnyEncoded,
  dbLog: SynchronousDatabase,
  mutationDefSchemaHashMap: Map<string, number>,
) =>
  Effect.gen(function* () {
    const mutationName = mutationEventEncoded.mutation
    const mutationDefSchemaHash =
      mutationDefSchemaHashMap.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

    // TODO use prepared statements
    yield* execSql(
      dbLog,
      ...insertRow({
        tableName: MUTATION_LOG_META_TABLE,
        columns: mutationLogMetaTable.sqliteDef.columns,
        values: {
          idGlobal: mutationEventEncoded.id.global,
          idLocal: mutationEventEncoded.id.local,
          parentIdGlobal: mutationEventEncoded.parentId.global,
          parentIdLocal: mutationEventEncoded.parentId.local,
          mutation: mutationEventEncoded.mutation,
          argsJson: mutationEventEncoded.args ?? {},
          schemaHash: mutationDefSchemaHash,
          syncMetadataJson: Option.none(),
        },
      }),
    )
  })

// TODO let's consider removing this "should exclude" mechanism in favour of log compaction etc
const makeShouldExcludeMutationFromLog = memoizeByRef((schema: LiveStoreSchema) => {
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
