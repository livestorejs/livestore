import type {
  BootStatus,
  InvalidPullError,
  IsOfflineError,
  PreparedBindValues,
  SynchronousDatabase,
  SyncImpl,
  UnexpectedError,
} from '@livestore/common'
import {
  Devtools,
  getExecArgsFromMutation,
  liveStoreVersion,
  makeShouldExcludeMutationFromLog,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  prepareBindValues,
  sql,
  SqliteError,
} from '@livestore/common'
import type { LiveStoreSchema, MutationEvent, MutationEventSchema, SyncStatus } from '@livestore/common/schema'
import type { BindValues } from '@livestore/common/sql-queries'
import { insertRow, updateRows } from '@livestore/common/sql-queries'
import { shouldNeverHappen } from '@livestore/utils'
import type { Deferred, Fiber, FiberSet, Queue, Ref, Scope, Stream, WebChannel } from '@livestore/utils/effect'
import { Context, Effect, Schema, SubscriptionRef } from '@livestore/utils/effect'

import { BCMessage } from '../common/index.js'
import type { WaSqlite } from '../sqlite/index.js'
import { makeSynchronousDatabase } from '../sqlite/make-sync-db.js'
import type { PersistedSqlite } from './persisted-sqlite.js'
import type { StorageType } from './worker-schema.js'

export const configureConnection = (
  { syncDb }: { syncDb: SynchronousDatabase },
  { fkEnabled }: { fkEnabled: boolean },
) =>
  execSql(
    syncDb,
    sql`
    PRAGMA page_size=8192;
    PRAGMA journal_mode=MEMORY;
    ${fkEnabled ? sql`PRAGMA foreign_keys='ON';` : sql`PRAGMA foreign_keys='OFF';`}
  `,
    {},
  )

export type PersistenceInfo = {
  fileName: string
} & Record<string, any>

export type PersistenceInfoPair = { db: PersistenceInfo; mutationLog: PersistenceInfo }

export type DevtoolsContextEnabled = {
  enabled: true
  connect: (options: {
    coordinatorMessagePort: MessagePort
    storeMessagePortDeferred: Deferred.Deferred<MessagePort, UnexpectedError>
    disconnect: Effect.Effect<void>
    storeId: string
    appHostId: string
    isLeaderTab: boolean
    persistenceInfo: PersistenceInfoPair
  }) => Effect.Effect<void, UnexpectedError, InnerWorkerCtx | Scope.Scope>
  connections: FiberSet.FiberSet
  broadcast: (
    message: typeof Devtools.NetworkStatusRes.Type | typeof Devtools.MutationBroadcast.Type,
  ) => Effect.Effect<void>
}
export type DevtoolsContext = DevtoolsContextEnabled | { enabled: false }

export type ShutdownState = 'running' | 'shutting-down'

export class OuterWorkerCtx extends Context.Tag('OuterWorkerCtx')<
  OuterWorkerCtx,
  {
    innerFiber: Fiber.RuntimeFiber<any, any>
  }
>() {}

export type InitialSetup = { _tag: 'Recreate'; snapshot: Ref.Ref<Uint8Array | undefined> } | { _tag: 'Reuse' }

export class InnerWorkerCtx extends Context.Tag('InnerWorkerCtx')<
  InnerWorkerCtx,
  {
    schema: LiveStoreSchema
    storeId: string
    storageOptions: StorageType
    mutationSemaphore: Effect.Semaphore
    db: PersistedSqlite
    dbLog: PersistedSqlite
    sqlite3: WaSqlite.SQLiteAPI
    bootStatusQueue: Queue.Queue<BootStatus>
    initialSetupDeferred: Deferred.Deferred<InitialSetup, UnexpectedError>
    // TODO we should find a more elegant way to handle cases which need this ref for their implementation
    shutdownStateSubRef: SubscriptionRef.SubscriptionRef<ShutdownState>
    mutationEventSchema: MutationEventSchema<any>
    mutationDefSchemaHashMap: Map<string, number>
    broadcastChannel: WebChannel.WebChannel<BCMessage.Message, BCMessage.Message>
    devtools: DevtoolsContext
    sync:
      | {
          impl: SyncImpl
          inititialMessages: Stream.Stream<MutationEvent.Any, InvalidPullError | IsOfflineError>
        }
      | undefined
  }
>() {}

export type ApplyMutation = (
  mutationEventEncoded: MutationEvent.Any,
  options: {
    syncStatus: SyncStatus
    shouldBroadcast: boolean
    persisted: boolean
    inTransaction: boolean
  },
) => Effect.Effect<void, SqliteError>

export const makeApplyMutation = (
  workerCtx: typeof InnerWorkerCtx.Service,
  createdAtMemo: () => string,
  db: number,
): ApplyMutation => {
  const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(workerCtx.schema)

  return (mutationEventEncoded, { syncStatus, shouldBroadcast, persisted, inTransaction }) =>
    Effect.gen(function* () {
      const {
        dbLog,
        mutationEventSchema,
        mutationDefSchemaHashMap,
        broadcastChannel,
        devtools,
        sync,
        schema,
        mutationSemaphore,
        sqlite3,
      } = workerCtx
      const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

      const mutationName = mutationEventDecoded.mutation
      const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

      const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

      const syncDb = makeSynchronousDatabase(sqlite3, db)
      const syncDbLog = dbLog.dbRef.current.syncDb

      // console.group('livestore-webworker: executing mutation', { mutationName, syncStatus, shouldBroadcast })

      const transaction = Effect.gen(function* () {
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
              id: mutationEventEncoded.id,
              mutation: mutationEventEncoded.mutation,
              argsJson: mutationEventEncoded.args ?? {},
              schemaHash: mutationDefSchemaHash,
              createdAt: createdAtMemo(),
              syncStatus,
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
        sync !== undefined &&
        syncStatus === 'pending'
      ) {
        yield* Effect.gen(function* () {
          if ((yield* SubscriptionRef.get(sync.impl.isConnected)) === false) return

          yield* sync.impl.push(mutationEventEncoded, persisted)

          yield* execSql(
            syncDbLog,
            ...updateRows({
              tableName: MUTATION_LOG_META_TABLE,
              columns: mutationLogMetaTable.sqliteDef.columns,
              where: { id: mutationEventEncoded.id },
              updateValues: { syncStatus: 'synced' },
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
}

const execSql = (syncDb: SynchronousDatabase, sql: string, bind: BindValues) => {
  const bindValues = prepareBindValues(bind, sql)
  return Effect.try({
    try: () => syncDb.execute(sql, bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql }, code: (cause as WaSqlite.SQLiteError).code }),
  }).pipe(Effect.asVoid)
}

const execSqlPrepared = (syncDb: SynchronousDatabase, sql: string, bindValues: PreparedBindValues) => {
  return Effect.try({
    try: () => syncDb.execute(sql, bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql }, code: (cause as WaSqlite.SQLiteError).code }),
  }).pipe(Effect.asVoid)
}
