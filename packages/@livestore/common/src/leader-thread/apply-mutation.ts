import { env, memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import type { Option, Scope } from '@livestore/utils/effect'
import { Effect, Schema } from '@livestore/utils/effect'

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
import { validateAndUpdateMutationEventId } from './validateAndUpdateMutationEventId.js'

export type ApplyMutation = (
  mutationEventEncoded: MutationEvent.AnyEncoded,
  options: {
    persisted: boolean
    inTransaction: boolean
    syncMetadataJson: Option.Option<Schema.JsonValue>
  },
) => Effect.Effect<void, SqliteError | UnexpectedError>

export const makeApplyMutation: Effect.Effect<ApplyMutation, never, Scope.Scope | LeaderThreadCtx> = Effect.gen(
  function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(leaderThreadCtx.schema)

    return (mutationEventEncoded, { persisted, inTransaction, syncMetadataJson }) =>
      Effect.gen(function* () {
        const {
          mutationEventSchema,
          mutationDefSchemaHashMap,
          schema,
          db,
          dbLog,
          mutationSemaphore,
          currentMutationEventIdRef,
        } = leaderThreadCtx
        const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

        const mutationName = mutationEventDecoded.mutation
        const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        yield* validateAndUpdateMutationEventId({
          currentMutationEventIdRef,
          mutationEventId: mutationEventDecoded.id,
          debugContext: { label: `leader-worker:applyMutation`, mutationEventEncoded },
        })

        // console.group('livestore-webworker: executing mutation', { mutationName })

        const transaction = Effect.gen(function* () {
          const session = env('VITE_LIVESTORE_EXPERIMENTAL_SYNC_NEXT') ? db.session() : undefined

          const hasDbTransaction = execArgsArr.length > 1 && inTransaction === false
          if (hasDbTransaction) {
            yield* execSql(db, 'BEGIN TRANSACTION', {})
          }

          for (const { statementSql, bindValues } of execArgsArr) {
            // console.debug(mutationName, statementSql, bindValues)
            // TODO use cached prepared statements instead of exec
            yield* execSqlPrepared(db, statementSql, bindValues).pipe(
              Effect.tapError(() => (hasDbTransaction ? execSql(db, 'ROLLBACK', {}) : Effect.void)),
            )
          }

          if (hasDbTransaction) {
            yield* execSql(db, 'COMMIT', {})
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
        })

        yield* mutationSemaphore.withPermits(1)(transaction)

        // console.groupEnd()

        // write to mutation_log
        const excludeFromMutationLogAndSyncing = shouldExcludeMutationFromLog(mutationName, mutationEventDecoded)
        if (persisted && excludeFromMutationLogAndSyncing === false) {
          yield* insertIntoMutationLog(mutationEventEncoded, dbLog, mutationDefSchemaHashMap, syncMetadataJson)
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
  syncMetadataJson: Option.Option<Schema.JsonValue>,
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
          syncMetadataJson,
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
