import type { NetworkStatus, SyncBackend } from '@livestore/common'
import { MutationEventEncodedWithDeferred, ROOT_ID, sql, UnexpectedError } from '@livestore/common'
import type { InitialSyncOptions } from '@livestore/common/leader-thread'
import {
  configureConnection,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
  OuterWorkerCtx,
} from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { syncDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { isDevEnv } from '@livestore/utils'
import type { HttpClient, WorkerError } from '@livestore/utils/effect'
import {
  BrowserWorkerRunner,
  Deferred,
  Effect,
  Exit,
  FetchHttpClient,
  Fiber,
  FiberSet,
  identity,
  Layer,
  Logger,
  LogLevel,
  OtelTracer,
  Scheduler,
  Scope,
  Stream,
  TaskTracing,
  WorkerRunner,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import * as OpfsUtils from '../../opfs-utils.js'
import { getAppDbFileName, sanitizeOpfsDir } from '../common/persisted-sqlite.js'
import { makeShutdownChannel } from '../common/shutdown-channel.js'
import * as WorkerSchema from '../common/worker-schema.js'

export type WorkerOptions = {
  schema: LiveStoreSchema
  makeSyncBackend?: (initProps: any) => Effect.Effect<SyncBackend<any>, UnexpectedError, Scope.Scope>
  /** @default { _tag: 'Skip' } */
  initialSyncOptions?: InitialSyncOptions
  otelOptions?: {
    tracer: otel.Tracer
  }
}

if (isDevEnv()) {
  globalThis.__debugLiveStoreUtils = {
    opfs: OpfsUtils,
    blobUrl: (buffer: Uint8Array) => URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })),
  }
}

export const makeWorker = (options: WorkerOptions) => {
  makeWorkerEffect(options).pipe(Effect.runFork)
}

export const makeWorkerEffect = (options: WorkerOptions) => {
  const TracingLive = options.otelOptions?.tracer
    ? Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
        Layer.provideMerge(Layer.succeed(OtelTracer.OtelTracer, options.otelOptions.tracer)),
      )
    : undefined

  return makeWorkerRunnerOuter(options).pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(Logger.pretty),
    Effect.provide(FetchHttpClient.layer),
    TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)),
    TracingLive ? Effect.provide(TracingLive) : identity,
    Logger.withMinimumLogLevel(LogLevel.Debug),
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

        return makeLeaderThreadLayer({
          schema,
          storeId,
          originId,
          makeSyncDb,
          // TODO handle cases where options are provided but makeSyncBackend is not provided
          // TODO handle cases where makeSyncBackend is provided but options are not
          // TODO handle cases where backend and options don't match
          makeSyncBackend:
            makeSyncBackend === undefined || syncOptions === undefined ? undefined : makeSyncBackend(syncOptions),
          db,
          dbLog,
          devtoolsEnabled,
          initialSyncOptions,
        })
      }).pipe(
        Effect.tapCauseLogPretty,
        UnexpectedError.mapToUnexpectedError,
        Effect.withPerformanceMeasure('@livestore/web:worker:InitialMessage'),
        Effect.withSpan('@livestore/web:worker:InitialMessage'),
        Layer.unwrapScoped,
      ),
    // GetRecreateSnapshot: () =>
    //   Effect.gen(function* () {
    //     const workerCtx = yield* LeaderThreadCtx

    //     // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
    //     const cachedSnapshot =
    //       result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined

    //     return cachedSnapshot ?? workerCtx.db.export()
    //   }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/web:worker:GetRecreateSnapshot')),
    PullStream: ({ cursor }) =>
      Effect.gen(function* () {
        const { connectedClientSessionPullQueues } = yield* LeaderThreadCtx
        const pullQueue = yield* connectedClientSessionPullQueues.makeQueue(cursor)
        return Stream.fromQueue(pullQueue)
      }).pipe(Stream.unwrapScoped),
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
      Effect.andThen(LeaderThreadCtx, (_) =>
        _.syncProcessor.push(
          items
            // TODO handle txn
            .filter((_) => _._tag === 'mutate')
            .flatMap((item) => item.batch)
            .map((mutationEvent) => new MutationEventEncodedWithDeferred(mutationEvent)),
        ),
      ).pipe(
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
        const { db, dbLog, devtools, scope } = yield* LeaderThreadCtx
        yield* Effect.logDebug('[@livestore/web:worker] Shutdown')

        if (devtools.enabled) {
          yield* FiberSet.clear(devtools.connections)
        }

        yield* Scope.close(scope, Exit.void)

        db.close()
        dbLog.close()

        // Buy some time for Otel to flush
        // TODO find a cleaner way to do this
        yield* Effect.sleep(1000)
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
