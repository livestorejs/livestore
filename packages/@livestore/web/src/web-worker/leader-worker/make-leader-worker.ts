import type { NetworkStatus, SyncBackend } from '@livestore/common'
import { ROOT_ID, sql, UnexpectedError } from '@livestore/common'
import type { InitialSyncOptions } from '@livestore/common/leader-thread'
import {
  bootLeaderThread,
  configureConnection,
  LeaderThreadCtx,
  makeApplyMutation,
  makeLeaderThreadCtx,
  OuterWorkerCtx,
} from '@livestore/common/leader-thread'
import { type LiveStoreSchema } from '@livestore/common/schema'
import { syncDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { isDevEnv, memoizeByStringifyArgs, shouldNeverHappen } from '@livestore/utils'
import type { HttpClient, Scope, WorkerError } from '@livestore/utils/effect'
import {
  BrowserWorkerRunner,
  Deferred,
  Effect,
  FetchHttpClient,
  Fiber,
  FiberSet,
  Layer,
  Logger,
  LogLevel,
  Option,
  Ref,
  Scheduler,
  Stream,
  SubscriptionRef,
  WorkerRunner,
} from '@livestore/utils/effect'

import * as OpfsUtils from '../../opfs-utils.js'
import { getAppDbFileName, sanitizeOpfsDir } from '../common/persisted-sqlite.js'
import { makeShutdownChannel } from '../common/shutdown-channel.js'
import { makeSyncBroadcastChannel } from '../common/sync-channel.js'
import type { ExecutionBacklogItem } from '../common/worker-schema.js'
import * as WorkerSchema from '../common/worker-schema.js'

export type WorkerOptions = {
  schema: LiveStoreSchema
  makeSyncBackend?: (initProps: any) => Effect.Effect<SyncBackend<any>, UnexpectedError, Scope.Scope>
  /** @default { _tag: 'Skip' } */
  initialSyncOptions?: InitialSyncOptions
}

if (isDevEnv()) {
  globalThis.__opfsUtils = OpfsUtils
}

export const makeWorker = (options: WorkerOptions) => {
  makeWorkerRunnerOuter(options).pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(Logger.pretty),
    Effect.provide(FetchHttpClient.layer),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runFork,
  )
}

const makeWorkerRunnerOuter = (
  workerOptions: WorkerOptions,
): Layer.Layer<never, WorkerError.WorkerError, WorkerRunner.PlatformRunner | HttpClient.HttpClient> =>
  WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerOuter.InitialMessage, {
    InitialMessage: ({ port: incomingRequestsPort }) =>
      Effect.gen(function* () {
        const innerFiber = yield* makeWorkerRunnerInner(workerOptions).pipe(
          Layer.provide(BrowserWorkerRunner.layerMessagePort(incomingRequestsPort)),
          Layer.launch,
          Effect.scoped,
          Effect.withSpan('@livestore/web:worker:wrapper:InitialMessage:innerFiber'),
          Effect.tapCauseLogPretty,
          Effect.annotateLogs({ thread: self.name }),
          Effect.provide(Logger.pretty),
          Logger.withMinimumLogLevel(LogLevel.Debug),
          Effect.withScheduler(Scheduler.messageChannel()),
          // We're increasing the Effect ops limit here to allow for larger chunks of operations at a time
          Effect.withMaxOpsBeforeYield(4096),
          Effect.forkScoped,
        )

        return Layer.succeed(OuterWorkerCtx, OuterWorkerCtx.of({ innerFiber }))
      }).pipe(Effect.withSpan('@livestore/web:worker:wrapper:InitialMessage'), Layer.unwrapScoped),
  })

const makeWorkerRunnerInner = ({ schema, makeSyncBackend, initialSyncOptions }: WorkerOptions) =>
  WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerInner.Request, {
    InitialMessage: ({ storageOptions, storeId, originId, syncOptions, devtoolsEnabled }) =>
      Effect.gen(function* () {
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
        const makeSyncDb = syncDbFactory({ sqlite3 })

        const schemaHashSuffix = schema.migrationOptions.strategy === 'manual' ? 'fixed' : schema.hash.toString()

        const makeDb = (kind: 'app' | 'mutationlog') =>
          makeSyncDb({
            _tag: 'opfs',
            opfsDirectory: sanitizeOpfsDir(storageOptions.directory, storeId),
            fileName: kind === 'app' ? getAppDbFileName(schemaHashSuffix) : 'mutationlog.db',
            configureDb: (db) => configureConnection(db, { fkEnabled: true }),
          }).pipe(Effect.acquireRelease((db) => Effect.sync(() => db.close())))

        // Might involve some async work, so we're running them concurrently
        const [db, dbLog] = yield* Effect.all([makeDb('app'), makeDb('mutationlog')], { concurrency: 2 })

        const broadcastChannel = yield* makeSyncBroadcastChannel(schema, storeId)

        const leaderThreadCtx = yield* makeLeaderThreadCtx({
          schema,
          storeId,
          originId,
          makeSyncDb,
          // TODO handle cases where options are provided but makeSyncBackend is not provided
          // TODO handle cases where makeSyncBackend is provided but options are not
          // TODO handle cases where backend and options don't match
          makeSyncBackend: makeSyncBackend === undefined ? undefined : makeSyncBackend(syncOptions),
          db,
          dbLog,
          devtoolsEnabled,
          initialSyncOptions,
          broadcastChannel,
        })

        const leaderContextLayer = Layer.succeed(LeaderThreadCtx, leaderThreadCtx)

        yield* bootLeaderThread.pipe(Effect.provide(leaderContextLayer), Effect.tapCauseLogPretty, Effect.forkScoped)

        return leaderContextLayer
      }).pipe(
        Effect.tapCauseLogPretty,
        UnexpectedError.mapToUnexpectedError,
        Effect.withPerformanceMeasure('@livestore/web:worker:InitialMessage'),
        Effect.withSpan('@livestore/web:worker:InitialMessage'),
        Layer.unwrapScoped,
      ),
    GetRecreateSnapshot: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        const result = yield* Deferred.await(workerCtx.initialSetupDeferred)

        // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
        const cachedSnapshot =
          result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined

        return cachedSnapshot ?? workerCtx.db.export()
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:GetRecreateSnapshot')),
    Export: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.db.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/web:worker:Export'),
      ),
    ExportMutationlog: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbLog.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/web:worker:ExportMutationlog'),
      ),
    ExecuteBulk: ({ items }) =>
      executeBulk(items).pipe(
        Effect.uninterruptible,
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/web:worker:ExecuteBulk'),
      ),
    BootStatusStream: () =>
      Effect.andThen(LeaderThreadCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
    GetCurrentMutationEventId: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        const result = workerCtx.dbLog.select<{ idGlobal: number; idLocal: number }>(
          sql`SELECT idGlobal, idLocal FROM mutation_log ORDER BY idGlobal DESC, idLocal DESC LIMIT 1`,
        )[0]

        return result ? { global: result.idGlobal, local: result.idLocal } : ROOT_ID
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:GetCurrentMutationEventId')),
    NetworkStatusStream: () =>
      Effect.gen(function* (_) {
        const ctx = yield* LeaderThreadCtx

        if (ctx.syncBackend === undefined) {
          return Stream.make<[NetworkStatus]>({ isConnected: false, timestampMs: Date.now() })
        }

        return ctx.syncBackend.isConnected.changes.pipe(
          Stream.map((isConnected) => ({ isConnected, timestampMs: Date.now() })),
        )
      }).pipe(Stream.unwrap),
    Shutdown: () =>
      Effect.gen(function* () {
        const { db, dbLog, devtools } = yield* LeaderThreadCtx
        yield* Effect.logDebug('[@livestore/web:worker] Shutdown')

        if (devtools.enabled) {
          yield* FiberSet.clear(devtools.connections)
        }

        db.close()
        dbLog.close()
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:Shutdown')),
    // NOTE We're using a stream here to express a scoped effect over the worker boundary
    // so the code below can cause an interrupt on the worker client side
    ConnectDevtoolsStream: ({ port, appHostId, isLeader }) =>
      Stream.asyncScoped<{ storeMessagePort: MessagePort }, UnexpectedError, LeaderThreadCtx | HttpClient.HttpClient>(
        (emit) =>
          Effect.gen(function* () {
            const leaderthreadCtx = yield* LeaderThreadCtx

            if (leaderthreadCtx.devtools.enabled === false) {
              return yield* new UnexpectedError({ cause: 'Devtools are disabled' })
            }

            const storeMessagePortDeferred = yield* Deferred.make<MessagePort, UnexpectedError>()

            const shutdownChannel = yield* makeShutdownChannel(leaderthreadCtx.storeId)

            const fiber: Fiber.RuntimeFiber<void, UnexpectedError> = yield* leaderthreadCtx.devtools
              .connect({
                // @ts-expect-error TODO fix
                coordinatorMessagePortOrChannel: port,
                storeMessagePortDeferred,
                disconnect: Effect.suspend(() => Fiber.interrupt(fiber)),
                storeId: leaderthreadCtx.storeId,
                appHostId,
                isLeader,
                persistenceInfo: {
                  db: leaderthreadCtx.db.metadata.persistenceInfo,
                  mutationLog: leaderthreadCtx.dbLog.metadata.persistenceInfo,
                },
                shutdownChannel,
              })
              .pipe(
                Effect.tapError((cause) => Effect.promise(() => emit.fail(cause))),
                Effect.onInterrupt(() => Effect.promise(() => emit.end())),
                FiberSet.run(leaderthreadCtx.devtools.connections),
              )

            const storeMessagePort = yield* Deferred.await(storeMessagePortDeferred)

            emit.single({ storeMessagePort })
          }),
      ).pipe(Stream.withSpan('@livestore/web:worker:ConnectDevtools')),
  })

const executeBulk = (executionItems: ReadonlyArray<ExecutionBacklogItem>) =>
  Effect.gen(function* () {
    let batchItems: ExecutionBacklogItem[] = []
    const leaderThreadCtx = yield* LeaderThreadCtx
    const { db, dbLog, shutdownStateSubRef } = yield* LeaderThreadCtx

    if ((yield* SubscriptionRef.get(shutdownStateSubRef)) !== 'running') {
      console.warn('livestore-webworker: shutting down, skipping execution')
      return
    }

    const createdAtMemo = memoizeByStringifyArgs(() => new Date().toISOString())
    const applyMutation = yield* makeApplyMutation(createdAtMemo, db)

    let offset = 0

    while (offset < executionItems.length) {
      try {
        db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
        dbLog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

        batchItems = executionItems.slice(offset, offset + 50)
        offset += 50

        // console.group('livestore-webworker: executing batch')
        // batchItems.forEach((_) => {
        //   if (_._tag === 'execute') {
        //     console.log(_.query, _.bindValues)
        //   } else if (_._tag === 'mutate') {
        //     console.log(_.mutationEventEncoded.mutation, _.mutationEventEncoded.id, _.mutationEventEncoded.args)
        //   }
        // })
        // console.groupEnd()

        for (const item of batchItems) {
          if (item._tag === 'execute') {
            const { query, bindValues } = item
            db.execute(query, bindValues)

            // NOTE we're not writing `execute` events to the mutation_log
          } else if (item._tag === 'mutate') {
            const mutationDef =
              leaderThreadCtx.schema.mutations.get(item.mutationEventEncoded.mutation) ??
              shouldNeverHappen(`Unknown mutation: ${item.mutationEventEncoded.mutation}`)

            yield* applyMutation(item.mutationEventEncoded, {
              shouldBroadcast: true,
              persisted: item.persisted,
              inTransaction: true,
              syncStatus: mutationDef.options.localOnly ? 'localOnly' : 'pending',
              syncMetadataJson: Option.none(),
            })
          } else {
            // TODO handle txn
          }
        }

        db.execute('COMMIT', undefined) // Commit the transaction
        dbLog.execute('COMMIT', undefined) // Commit the transaction
      } catch (error) {
        try {
          db.execute('ROLLBACK', undefined) // Rollback in case of an error
          dbLog.execute('ROLLBACK', undefined) // Rollback in case of an error
        } catch (e) {
          console.error('Error rolling back transaction', e)
        }

        shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
      }
    }
  })
