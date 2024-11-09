import type { SqliteError, UnexpectedError } from '@livestore/common'
import {
  Devtools,
  getExecArgsFromMutation,
  liveStoreVersion,
  makeShouldExcludeMutationFromLog,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  SESSION_CHANGESET_META_TABLE,
  sessionChangesetMetaTable,
} from '@livestore/common'
import type { MutationEvent, SyncStatus } from '@livestore/common/schema'
import { insertRow, updateRows } from '@livestore/common/sql-queries'
import { shouldNeverHappen } from '@livestore/utils'
import type { HttpClient, Option, Scope } from '@livestore/utils/effect'
import { Effect, Schema, SubscriptionRef } from '@livestore/utils/effect'

import { execSql, execSqlPrepared } from '../../common/connection.js'
import { BCMessage } from '../../common/index.js'
import { makeSynchronousDatabase } from '../../sqlite/make-sync-db.js'
import { validateAndUpdateMutationEventId } from '../common/validateAndUpdateMutationEventId.js'
import { LeaderWorkerCtx } from './types.js'

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
  db: number,
): Effect.Effect<ApplyMutation, never, Scope.Scope | LeaderWorkerCtx> =>
  Effect.gen(function* () {
    const leaderWorkerCtx = yield* LeaderWorkerCtx
    const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(leaderWorkerCtx.schema)

    const { dbLog } = leaderWorkerCtx

    const syncDbLog = dbLog.dbRef.current.syncDb

    return (mutationEventEncoded, { syncStatus, shouldBroadcast, persisted, inTransaction, syncMetadataJson }) =>
      Effect.gen(function* () {
        const {
          mutationEventSchema,
          mutationDefSchemaHashMap,
          broadcastChannel,
          devtools,
          syncBackend,
          schema,
          mutationSemaphore,
          sqlite3,
          currentMutationEventIdRef,
        } = leaderWorkerCtx
        const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

        const mutationName = mutationEventDecoded.mutation
        const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        const syncDb = makeSynchronousDatabase(sqlite3, db)

        yield* validateAndUpdateMutationEventId({
          currentMutationEventIdRef,
          mutationEventId: mutationEventDecoded.id,
          debugContext: { label: `leader-worker:applyMutation`, mutationEventEncoded },
        })

        // console.group('livestore-webworker: executing mutation', { mutationName, syncStatus, shouldBroadcast })

        const transaction = Effect.gen(function* () {
          const sessionEnabled = import.meta.env.VITE_LIVESTORE_EXPERIMENTAL_SYNC_NEXT
          const session = sessionEnabled ? sqlite3.session_create(db, 'main') : -1
          if (sessionEnabled) {
            sqlite3.session_attach(session, null)
          }

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

          if (sessionEnabled) {
            const { changeset } = sqlite3.session_changeset(session)
            sqlite3.session_delete(session)

            // NOTE for no-op mutations (e.g. if the state didn't change) the changeset will be empty
            // TODO possibly write a null value instead of omitting the row
            if (changeset.length > 0) {
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
          const mutationDefSchemaHash =
            mutationDefSchemaHashMap.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

          yield* execSql(
            syncDbLog,
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
        } else {
          //   console.debug('livestore-webworker: skipping mutation log write', mutation, statementSql, bindValues)
        }

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

        // TODO do this via a batched queue
        if (
          excludeFromMutationLogAndSyncing === false &&
          mutationDef.options.localOnly === false &&
          syncBackend !== undefined &&
          syncStatus === 'pending'
        ) {
          yield* Effect.gen(function* () {
            if ((yield* SubscriptionRef.get(syncBackend.isConnected)) === false) return

            const { metadata } = yield* syncBackend.push(mutationEventEncoded, persisted)

            yield* execSql(
              syncDbLog,
              ...updateRows({
                tableName: MUTATION_LOG_META_TABLE,
                columns: mutationLogMetaTable.sqliteDef.columns,
                where: { idGlobal: mutationEventEncoded.id.global, idLocal: mutationEventEncoded.id.local },
                updateValues: { syncStatus: 'synced', syncMetadataJson: metadata },
              }),
            )
          }).pipe(Effect.tapCauseLogPretty, Effect.fork)
        }
      }).pipe(
        Effect.withSpan(`@livestore/web:worker:applyMutation`, {
          attributes: {
            mutationName: mutationEventEncoded.mutation,
            mutationId: mutationEventEncoded.id,
            syncStatus,
            shouldBroadcast,
            persisted,
          },
        }),
      )
  })
