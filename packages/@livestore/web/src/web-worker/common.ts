import type {
  BootStatus,
  InvalidPullError,
  IsOfflineError,
  PreparedBindValues,
  SyncImpl,
  UnexpectedError,
} from '@livestore/common'
import {
  Devtools,
  getExecArgsFromMutation,
  liveStoreVersion,
  MUTATION_LOG_META_TABLE,
  mutationLogMetaTable,
  prepareBindValues,
  sql,
  SqliteError,
} from '@livestore/common'
import type { LiveStoreSchema, MutationEvent, MutationEventSchema, SyncStatus } from '@livestore/common/schema'
import type { BindValues } from '@livestore/common/sql-queries'
import { insertRow, updateRows } from '@livestore/common/sql-queries'
import { memoizeByRef, shouldNeverHappen } from '@livestore/utils'
import type { Deferred, Fiber, FiberSet, Queue, Ref, Scope, Stream } from '@livestore/utils/effect'
import { Context, Effect, Runtime, Schema, SubscriptionRef } from '@livestore/utils/effect'

import { BCMessage } from '../common/index.js'
import type { SqliteWasm } from '../sqlite-utils.js'
import type { PersistedSqlite } from './persisted-sqlite.js'
import type { StorageType } from './worker-schema.js'

export const getAppDbFileName = (prefix: string, suffix: number) => {
  return `${prefix}${suffix}.db`
}

export const getMutationlogDbFileName = (prefix: string) => {
  return `${prefix}mutationlog.db`
}

export const getAppDbIdbStoreName = (prefix: string, schemaHash: number) => {
  return `${prefix}${schemaHash}`
}

export const getMutationlogDbIdbStoreName = (prefix: string) => {
  return `${prefix}mutationlog`
}

export const configureConnection = (db: SqliteWasm.Database, { fkEnabled }: { fkEnabled: boolean }) =>
  execSql(
    db,
    sql`
    PRAGMA page_size=8192;
    PRAGMA journal_mode=MEMORY;
    ${fkEnabled ? sql`PRAGMA foreign_keys='ON';` : sql`PRAGMA foreign_keys='OFF';`}
  `,
    {},
  )

export type DevtoolsContextEnabled = {
  enabled: true
  connect: (options: {
    coordinatorMessagePort: MessagePort
    storeMessagePortDeferred: Deferred.Deferred<MessagePort, UnexpectedError>
    disconnect: Effect.Effect<void>
    channelId: string
    isLeaderTab: boolean
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
    keySuffix: string
    storageOptions: StorageType
    schema: LiveStoreSchema
    mutationSemaphore: Effect.Semaphore
    db: PersistedSqlite
    dbLog: PersistedSqlite
    sqlite3: SqliteWasm.Sqlite3Static
    bootStatusQueue: Queue.Queue<BootStatus>
    initialSetupDeferred: Deferred.Deferred<InitialSetup, UnexpectedError>
    // TODO we should find a more elegant way to handle cases which need this ref for their implementation
    shutdownStateSubRef: SubscriptionRef.SubscriptionRef<ShutdownState>
    mutationEventSchema: MutationEventSchema<any>
    mutationDefSchemaHashMap: Map<string, number>
    broadcastChannel: BroadcastChannel
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
  workerCtx: Context.Tag.Service<InnerWorkerCtx>,
  createdAtMemo: () => string,
  db: SqliteWasm.Database,
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
      } = workerCtx
      const mutationEventDecoded = Schema.decodeUnknownSync(mutationEventSchema)(mutationEventEncoded)

      const mutationName = mutationEventDecoded.mutation
      const mutationDef = schema.mutations.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

      const execArgsArr = getExecArgsFromMutation({ mutationDef, mutationEventDecoded })

      // console.group('livestore-webworker: executing mutation', { mutationName, syncStatus, shouldBroadcast })

      const transaction = Effect.gen(function* () {
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
      })

      yield* mutationSemaphore.withPermits(1)(transaction)

      // console.groupEnd()

      // write to mutation_log
      const excludeFromMutationLogAndSyncing = shouldExcludeMutationFromLog(mutationName, mutationEventDecoded)
      if (persisted && excludeFromMutationLogAndSyncing === false) {
        const mutationDefSchemaHash =
          mutationDefSchemaHashMap.get(mutationName) ?? shouldNeverHappen(`Unknown mutation: ${mutationName}`)

        yield* execSql(
          dbLog.dbRef.current,
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
        broadcastChannel.postMessage(
          Schema.encodeSync(BCMessage.Message)(
            BCMessage.Broadcast.make({ mutationEventEncoded, ref: '', sender: 'leader-worker', persisted }),
          ),
        )

        if (devtools.enabled) {
          yield* devtools.broadcast(
            Devtools.MutationBroadcast.make({ mutationEventEncoded, persisted, liveStoreVersion }),
          )
        }
      }

      const runtime = yield* Effect.runtime()

      // TODO do this via a batched queue
      if (
        excludeFromMutationLogAndSyncing === false &&
        mutationDef.options.localOnly === false &&
        sync !== undefined &&
        syncStatus === 'pending'
      ) {
        Effect.gen(function* () {
          if ((yield* SubscriptionRef.get(sync.impl.isConnected)) === false) return

          yield* sync.impl.push(mutationEventEncoded, persisted)

          yield* execSql(
            dbLog.dbRef.current,
            ...updateRows({
              tableName: MUTATION_LOG_META_TABLE,
              columns: mutationLogMetaTable.sqliteDef.columns,
              where: { id: mutationEventEncoded.id },
              updateValues: { syncStatus: 'synced' },
            }),
          )
        }).pipe(Effect.tapCauseLogPretty, Runtime.runFork(runtime))
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

const execSql = (db: SqliteWasm.Database, sql: string, bind: BindValues) => {
  const bindValues = prepareBindValues(bind, sql)
  return Effect.try({
    try: () => db.exec({ sql, bind: bindValues }),
    catch: (cause) => new SqliteError({ cause, bindValues, code: (cause as any).resultCode, sql }),
  }).pipe(Effect.asVoid)
}

const execSqlPrepared = (db: SqliteWasm.Database, sql: string, bindValues: PreparedBindValues) => {
  return Effect.try({
    try: () => db.exec({ sql, bind: bindValues }),
    catch: (cause) => new SqliteError({ cause, bindValues, code: (cause as any).resultCode, sql }),
  }).pipe(Effect.asVoid)
}

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
