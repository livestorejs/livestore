import { env, shouldNeverHappen } from '@livestore/utils'
import type { HttpClient, Option, Scope } from '@livestore/utils/effect'
import { Effect, Schema } from '@livestore/utils/effect'

import type { SqliteError, SynchronousDatabase, UnexpectedError } from '../index.js'
import {
  Devtools,
  getExecArgsFromMutation,
  liveStoreVersion,
  makeShouldExcludeMutationFromLog,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  SESSION_CHANGESET_META_TABLE,
  sessionChangesetMetaTable,
} from '../index.js'
import type { MutationEvent, SyncStatus } from '../schema/index.js'
import { insertRow } from '../sql-queries/index.js'
import * as BCMessage from './broadcast-types.js'
import { execSql, execSqlPrepared } from './connection.js'
import { LeaderThreadCtx } from './types.js'
import { validateAndUpdateMutationEventId } from './validateAndUpdateMutationEventId.js'

export type ApplyMutation = (
  mutationEventEncoded: MutationEvent.AnyEncoded,
  options: {
    syncStatus: SyncStatus
    shouldBroadcast: boolean
    persisted: boolean
    inTransaction: boolean
    syncMetadataJson: Option.Option<Schema.JsonValue>
  },
) => Effect.Effect<void, SqliteError | UnexpectedError, HttpClient.HttpClient>

export const makeApplyMutation = (
  createdAtMemo: () => string,
  syncDb: SynchronousDatabase,
): Effect.Effect<ApplyMutation, never, Scope.Scope | LeaderThreadCtx> =>
  Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(leaderThreadCtx.schema)

    return (mutationEventEncoded, { syncStatus, shouldBroadcast, persisted, inTransaction, syncMetadataJson }) =>
      Effect.gen(function* () {
        const {
          mutationEventSchema,
          mutationDefSchemaHashMap,
          broadcastChannel,
          devtools,
          syncBackend,
          syncPushQueue,
          schema,
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

        // console.group('livestore-webworker: executing mutation', { mutationName, syncStatus, shouldBroadcast })

        const transaction = Effect.gen(function* () {
          const session = env('VITE_LIVESTORE_EXPERIMENTAL_SYNC_NEXT') ? syncDb.session() : undefined

          const hasDbTransaction = execArgsArr.length > 1 && inTransaction === false
          if (hasDbTransaction) {
            yield* execSql(syncDb, 'BEGIN TRANSACTION', {})
          }

          for (const { statementSql, bindValues } of execArgsArr) {
            // console.debug(mutationName, statementSql, bindValues)
            // TODO use cached prepared statements instead of exec
            yield* execSqlPrepared(syncDb, statementSql, bindValues).pipe(
              Effect.tapError(() => (hasDbTransaction ? execSql(syncDb, 'ROLLBACK', {}) : Effect.void)),
            )
          }

          if (hasDbTransaction) {
            yield* execSql(syncDb, 'COMMIT', {})
          }

          if (session !== undefined) {
            const changeset = session.changeset()
            session.finish()
            // NOTE for no-op mutations (e.g. if the state didn't change) the changeset will be empty
            // TODO possibly write a null value instead of omitting the row
            if (changeset.length > 0) {
              // TODO use prepared statements
              yield* execSql(
                syncDb,
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
          yield* insertIntoMutationLog(
            mutationEventEncoded,
            dbLog,
            mutationDefSchemaHashMap,
            createdAtMemo,
            syncStatus,
            syncMetadataJson,
          )
        } else {
          //   console.debug('livestore-webworker: skipping mutation log write', mutation, statementSql, bindValues)
        }

        // TODO refactor so it matches the push<>pull model between client sessions and leader thread
        if (shouldBroadcast) {
          yield* broadcastChannel
            .send(BCMessage.Broadcast.make({ mutationEventEncoded, ref: '', sender: 'leader-worker', persisted }))
            .pipe(Effect.orDie)

          if (devtools.enabled) {
            yield* devtools.broadcast(
              Devtools.MutationBroadcast.make({ mutationEventEncoded, persisted, liveStoreVersion }),
            )
          }
        }

        if (
          excludeFromMutationLogAndSyncing === false &&
          mutationDef.options.localOnly === false &&
          syncBackend !== undefined &&
          syncStatus === 'pending'
        ) {
          yield* syncPushQueue.offer(mutationEventEncoded)
        }
      }).pipe(
        Effect.withSpan(`@livestore/web:worker:applyMutation`, {
          attributes: {
            mutationName: mutationEventEncoded.mutation,
            mutationId: mutationEventEncoded.id,
            syncStatus,
            shouldBroadcast,
            persisted,
            'span.label': mutationEventEncoded.mutation,
          },
        }),
        // Effect.logDuration('@livestore/web:worker:applyMutation'),
      )
  })

const insertIntoMutationLog = (
  mutationEventEncoded: MutationEvent.AnyEncoded,
  dbLog: SynchronousDatabase,
  mutationDefSchemaHashMap: Map<string, number>,
  createdAtMemo: () => string,
  syncStatus: SyncStatus,
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
          createdAt: createdAtMemo(),
          syncStatus,
          syncMetadataJson,
        },
      }),
    )
  })
