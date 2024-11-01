import type {
  BootStatus,
  EventId,
  PreparedBindValues,
  PreparedStatement,
  SyncBackend,
  SynchronousDatabase,
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
  SESSION_CHANGESET_META_TABLE,
  sessionChangesetMetaTable,
  sql,
  SqliteError,
} from '@livestore/common'
import type { LiveStoreSchema, MutationEvent, MutationEventSchema, SyncStatus } from '@livestore/common/schema'
import type { BindValues } from '@livestore/common/sql-queries'
import { insertRow, updateRows } from '@livestore/common/sql-queries'
import { shouldNeverHappen } from '@livestore/utils'
import type {
  Deferred,
  Fiber,
  FiberSet,
  HttpClient,
  Option,
  Queue,
  Ref,
  Scope,
  WebChannel,
} from '@livestore/utils/effect'
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
    isLeader: boolean
    persistenceInfo: PersistenceInfoPair
  }) => Effect.Effect<void, UnexpectedError, InnerWorkerCtx | Scope.Scope | HttpClient.HttpClient>
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

export type InitialSyncInfo = Option.Option<{
  cursor: EventId
  metadata: Option.Option<Schema.JsonValue>
}>

export type InitialSetup =
  | { _tag: 'Recreate'; snapshotRef: Ref.Ref<Uint8Array | undefined>; syncInfo: InitialSyncInfo }
  | { _tag: 'Reuse'; syncInfo: InitialSyncInfo }

export class InnerWorkerCtx extends Context.Tag('InnerWorkerCtx')<
  InnerWorkerCtx,
  {
    schema: LiveStoreSchema
    storeId: string
    originId: string
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
    syncBackend: SyncBackend | undefined
  }
>() {}

export type ApplyMutation = (
  mutationEventEncoded: MutationEvent.AnyEncoded,
  options: {
    syncStatus: SyncStatus
    shouldBroadcast: boolean
    persisted: boolean
    inTransaction: boolean
    syncMetadataJson: Option.Option<Schema.JsonValue>
  },
) => Effect.Effect<void, SqliteError, HttpClient.HttpClient>

export const makeApplyMutation = (
  workerCtx: typeof InnerWorkerCtx.Service,
  createdAtMemo: () => string,
  db: number,
): Effect.Effect<ApplyMutation, never, Scope.Scope> =>
  Effect.gen(function* () {
    const shouldExcludeMutationFromLog = makeShouldExcludeMutationFromLog(workerCtx.schema)

    const { dbLog } = workerCtx

    const syncDbLog = dbLog.dbRef.current.syncDb
    const selectMaxOrderKeyStmt = yield* Effect.acquireRelease(
      Effect.sync(() => syncDbLog.prepare(sql`SELECT MAX(orderKey) as max FROM mutation_log`)),
      (stmt) => Effect.sync(() => stmt.finalize()),
    )

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
        } = workerCtx
        const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

        const mutationName = mutationEventDecoded.mutation
        const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

        const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

        const syncDb = makeSynchronousDatabase(sqlite3, db)

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

          const orderKey = yield* selectSqlPrepared<{ max: number }>(selectMaxOrderKeyStmt, {}).pipe(
            Effect.map((res) => res[0]!.max + 1),
          )

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
                // TODO inline the sqlite select above into the insert statement
                // will probably require some kind of "sql string interpolation" for the current sql client
                // additionally to the currently supported bind values
                orderKey,
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

const execSql = (syncDb: SynchronousDatabase, sql: string, bind: BindValues) => {
  const bindValues = prepareBindValues(bind, sql)
  return Effect.try({
    try: () => syncDb.execute(sql, bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql }, code: (cause as WaSqlite.SQLiteError).code }),
  }).pipe(Effect.asVoid)
}

const selectSqlPrepared = <T>(stmt: PreparedStatement, bind: BindValues) => {
  const bindValues = prepareBindValues(bind, stmt.sql)
  return Effect.try({
    try: () => stmt.select<T>(bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql: stmt.sql }, code: (cause as WaSqlite.SQLiteError).code }),
  })
}

// TODO actually use prepared statements
const execSqlPrepared = (syncDb: SynchronousDatabase, sql: string, bindValues: PreparedBindValues) => {
  return Effect.try({
    try: () => syncDb.execute(sql, bindValues),
    catch: (cause) =>
      new SqliteError({ cause, query: { bindValues, sql }, code: (cause as WaSqlite.SQLiteError).code }),
  }).pipe(Effect.asVoid)
}
