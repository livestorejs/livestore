import type { NetworkStatus, SqliteDb, SyncOptions } from '@livestore/common'
import { Devtools, UnexpectedError } from '@livestore/common'
import type { DevtoolsOptions } from '@livestore/common/leader-thread'
import {
  configureConnection,
  getClientHeadFromDb,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
} from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { MutationEvent } from '@livestore/common/schema'
import { makeChannelForConnectedMeshNode } from '@livestore/devtools-web-common/web-channel'
import * as WebMeshWorker from '@livestore/devtools-web-common/worker'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { isDevEnv, LS_DEV } from '@livestore/utils'
import type { HttpClient, Scope, WorkerError } from '@livestore/utils/effect'
import {
  BrowserWorkerRunner,
  Effect,
  FetchHttpClient,
  identity,
  Layer,
  Logger,
  LogLevel,
  OtelTracer,
  Scheduler,
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
  sync?: SyncOptions
  otelOptions?: {
    tracer?: otel.Tracer
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
    Effect.provide(Logger.prettyWithThread(self.name)),
    Effect.provide(FetchHttpClient.layer),
    LS_DEV ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
    TracingLive ? Effect.provide(TracingLive) : identity,
    // We're using this custom scheduler to improve op batching behaviour and reduce the overhead
    // of the Effect fiber runtime given we have different tradeoffs on a worker thread.
    // Despite the "message channel" name, is has nothing to do with the `incomingRequestsPort` above.
    Effect.withScheduler(Scheduler.messageChannel()),
    // We're increasing the Effect ops limit here to allow for larger chunks of operations at a time
    Effect.withMaxOpsBeforeYield(4096),
    Logger.withMinimumLogLevel(LogLevel.Debug),
  )
}

const makeWorkerRunnerOuter = (
  workerOptions: WorkerOptions,
): Layer.Layer<never, WorkerError.WorkerError, WorkerRunner.PlatformRunner | HttpClient.HttpClient> =>
  WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerOuter.InitialMessage, {
    // Port coming from client session and forwarded via the shared worker
    InitialMessage: ({ port: incomingRequestsPort, storeId, clientId }) =>
      Effect.gen(function* () {
        yield* makeWorkerRunnerInner(workerOptions).pipe(
          Layer.provide(BrowserWorkerRunner.layerMessagePort(incomingRequestsPort)),
          Layer.launch,
          Effect.scoped,
          Effect.withSpan('@livestore/adapter-web:worker:wrapper:InitialMessage:innerFiber'),
          Effect.tapCauseLogPretty,
          Effect.provide(WebMeshWorker.CacheService.layer({ nodeName: `leader-${storeId}-${clientId}` })),
          Effect.forkScoped,
        )

        return Layer.empty
      }).pipe(Effect.withSpan('@livestore/adapter-web:worker:wrapper:InitialMessage'), Layer.unwrapScoped),
  })

const makeWorkerRunnerInner = ({ schema, sync: syncOptions }: WorkerOptions) =>
  WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerInner.Request, {
    InitialMessage: ({ storageOptions, storeId, clientId, devtoolsEnabled, debugInstanceId }) =>
      Effect.gen(function* () {
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
        const makeSqliteDb = sqliteDbFactory({ sqlite3 })
        const runtime = yield* Effect.runtime<never>()

        const makeDb = (kind: 'app' | 'mutationlog') =>
          makeSqliteDb({
            _tag: 'opfs',
            opfsDirectory: sanitizeOpfsDir(storageOptions.directory, storeId),
            fileName: kind === 'app' ? getAppDbFileName(schema) : 'mutationlog.db',
            configureDb: (db) =>
              configureConnection(db, {
                //  The persisted databases use the AccessHandlePoolVFS which always uses a single database connection.
                //  Multiple connections are not supported. This means that we can use the exclusive locking mode to
                //  avoid unnecessary system calls and enable the use of the WAL journal mode without the use of shared memory.
                // TODO bring back exclusive locking mode when `WAL` is working properly
                // lockingMode: 'EXCLUSIVE',
                foreignKeys: true,
              }).pipe(Effect.provide(runtime), Effect.runSync),
          }).pipe(Effect.acquireRelease((db) => Effect.try(() => db.close()).pipe(Effect.ignoreLogged)))

        // Might involve some async work, so we're running them concurrently
        const [dbReadModel, dbMutationLog] = yield* Effect.all([makeDb('app'), makeDb('mutationlog')], {
          concurrency: 2,
        })

        const devtoolsOptions = yield* makeDevtoolsOptions({ devtoolsEnabled, dbReadModel, dbMutationLog })
        const shutdownChannel = yield* makeShutdownChannel(storeId)

        return makeLeaderThreadLayer({
          schema,
          storeId,
          clientId,
          makeSqliteDb,
          syncOptions,
          dbReadModel,
          dbMutationLog,
          devtoolsOptions,
          shutdownChannel,
        })
      }).pipe(
        Effect.tapCauseLogPretty,
        UnexpectedError.mapToUnexpectedError,
        Effect.withPerformanceMeasure('@livestore/adapter-web:worker:InitialMessage'),
        Effect.withSpan('@livestore/adapter-web:worker:InitialMessage'),
        Effect.annotateSpans({ debugInstanceId }),
        Layer.unwrapScoped,
      ),
    GetRecreateSnapshot: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx

        // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
        // const cachedSnapshot =
        //   result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined

        // return cachedSnapshot ?? workerCtx.db.export()

        const snapshot = workerCtx.dbReadModel.export()
        return { snapshot, migrationsReport: workerCtx.initialState.migrationsReport }
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-web:worker:GetRecreateSnapshot'),
      ),
    PullStream: ({ cursor }) =>
      Effect.gen(function* () {
        const { connectedClientSessionPullQueues } = yield* LeaderThreadCtx
        const pullQueue = yield* connectedClientSessionPullQueues.makeQueue(cursor)
        return Stream.fromQueue(pullQueue)
      }).pipe(
        Stream.unwrapScoped,
        // For debugging purposes
        // Stream.tapLogWithLabel('@livestore/adapter-web:worker:PullStream'),
      ),
    PushToLeader: ({ batch }) =>
      Effect.andThen(LeaderThreadCtx, ({ syncProcessor }) =>
        syncProcessor.push(
          batch.map((mutationEvent) => new MutationEvent.EncodedWithMeta(mutationEvent)),
          // We'll wait in order to keep back pressure on the client session
          { waitForProcessing: true },
        ),
      ).pipe(Effect.uninterruptible, Effect.withSpan('@livestore/adapter-web:worker:PushToLeader')),
    Export: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbReadModel.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-web:worker:Export'),
      ),
    ExportMutationlog: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbMutationLog.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-web:worker:ExportMutationlog'),
      ),
    BootStatusStream: () =>
      Effect.andThen(LeaderThreadCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
    GetLeaderHead: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return getClientHeadFromDb(workerCtx.dbMutationLog)
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/adapter-web:worker:GetLeaderHead')),
    GetLeaderSyncState: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return yield* workerCtx.syncProcessor.syncState
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-web:worker:GetLeaderSyncState'),
      ),
    NetworkStatusStream: () =>
      Effect.gen(function* (_) {
        const ctx = yield* LeaderThreadCtx

        if (ctx.syncBackend === undefined) {
          return Stream.make<[NetworkStatus]>({ isConnected: false, timestampMs: Date.now(), latchClosed: false })
        }

        return Stream.zipLatest(
          ctx.syncBackend.isConnected.changes,
          ctx.devtools.enabled ? ctx.devtools.syncBackendLatchState.changes : Stream.make({ latchClosed: false }),
        ).pipe(Stream.map(([isConnected, { latchClosed }]) => ({ isConnected, timestampMs: Date.now(), latchClosed })))
      }).pipe(Stream.unwrap),
    Shutdown: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug('[@livestore/adapter-web:worker] Shutdown')

        // Buy some time for Otel to flush
        // TODO find a cleaner way to do this
        yield* Effect.sleep(300)
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/adapter-web:worker:Shutdown')),
    ExtraDevtoolsMessage: ({ message }) =>
      Effect.andThen(LeaderThreadCtx, (_) => _.extraIncomingMessagesQueue.offer(message)).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-web:worker:ExtraDevtoolsMessage'),
      ),
    'DevtoolsWebCommon.CreateConnection': WebMeshWorker.CreateConnection,
  })

const makeDevtoolsOptions = ({
  devtoolsEnabled,
  dbReadModel,
  dbMutationLog,
}: {
  devtoolsEnabled: boolean
  dbReadModel: SqliteDb
  dbMutationLog: SqliteDb
}): Effect.Effect<DevtoolsOptions, UnexpectedError, Scope.Scope | WebMeshWorker.CacheService> =>
  Effect.gen(function* () {
    if (devtoolsEnabled === false) {
      return { enabled: false }
    }
    const { node } = yield* WebMeshWorker.CacheService

    return {
      enabled: true,
      makeBootContext: Effect.gen(function* () {
        return {
          devtoolsWebChannel: yield* makeChannelForConnectedMeshNode({
            node,
            target: `devtools`,
            schema: { listen: Devtools.Leader.MessageToApp, send: Devtools.Leader.MessageFromApp },
          }),
          persistenceInfo: {
            readModel: dbReadModel.metadata.persistenceInfo,
            mutationLog: dbMutationLog.metadata.persistenceInfo,
          },
        }
      }),
    }
  })
