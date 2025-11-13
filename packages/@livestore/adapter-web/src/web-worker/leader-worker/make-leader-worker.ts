import type { SqliteDb, SyncOptions } from '@livestore/common'
import { Devtools, LogConfig, UnknownError } from '@livestore/common'
import type { DevtoolsOptions } from '@livestore/common/leader-thread'
import { configureConnection, Eventlog, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import * as WebmeshWorker from '@livestore/devtools-web-common/worker'
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
  OtelTracer,
  Scheduler,
  type Schema,
  Stream,
  TaskTracing,
  WorkerRunner,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import * as OpfsUtils from '../../opfs-utils.ts'
import { cleanupOldStateDbFiles, getStateDbFileName, sanitizeOpfsDir } from '../common/persisted-sqlite.ts'
import { makeShutdownChannel } from '../common/shutdown-channel.ts'
import * as WorkerSchema from '../common/worker-schema.ts'

export type WorkerOptions = {
  schema: LiveStoreSchema
  sync?: SyncOptions
  syncPayloadSchema?: Schema.Schema<any>
  otelOptions?: {
    tracer?: otel.Tracer
  }
} & LogConfig.WithLoggerOptions

if (isDevEnv()) {
  globalThis.__debugLiveStoreUtils = {
    opfs: OpfsUtils,
    blobUrl: (buffer: Uint8Array<ArrayBuffer>) =>
      URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })),
    runSync: (effect: Effect.Effect<any, any, never>) => Effect.runSync(effect),
    runFork: (effect: Effect.Effect<any, any, never>) => Effect.runFork(effect),
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

  const runtimeLayer = Layer.mergeAll(FetchHttpClient.layer, TracingLive ?? Layer.empty)

  return makeWorkerRunnerOuter(options).pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    WorkerRunner.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(runtimeLayer),
    LS_DEV ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
    // We're using this custom scheduler to improve op batching behaviour and reduce the overhead
    // of the Effect fiber runtime given we have different tradeoffs on a worker thread.
    // Despite the "message channel" name, is has nothing to do with the `incomingRequestsPort` above.
    Effect.withScheduler(Scheduler.messageChannel()),
    // We're increasing the Effect ops limit here to allow for larger chunks of operations at a time
    Effect.withMaxOpsBeforeYield(4096),
    LogConfig.withLoggerConfig({ logger: options.logger, logLevel: options.logLevel }, { threadName: self.name }),
  )
}

const makeWorkerRunnerOuter = (
  workerOptions: WorkerOptions,
): Layer.Layer<never, WorkerError.WorkerError, WorkerRunner.PlatformRunner | HttpClient.HttpClient> =>
  WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerOuterInitialMessage, {
    // Port coming from client session and forwarded via the shared worker
    InitialMessage: ({ port: incomingRequestsPort, storeId, clientId }) =>
      Effect.gen(function* () {
        yield* makeWorkerRunnerInner(workerOptions).pipe(
          Layer.provide(BrowserWorkerRunner.layerMessagePort(incomingRequestsPort)),
          WorkerRunner.launch,
          Effect.scoped,
          Effect.withSpan('@livestore/adapter-web:worker:wrapper:InitialMessage:innerFiber'),
          Effect.tapCauseLogPretty,
          Effect.provide(
            WebmeshWorker.CacheService.layer({ nodeName: Devtools.makeNodeName.client.leader({ storeId, clientId }) }),
          ),
          Effect.forkScoped,
        )

        return Layer.empty
      }).pipe(Effect.withSpan('@livestore/adapter-web:worker:wrapper:InitialMessage'), Layer.unwrapScoped),
  })

const makeWorkerRunnerInner = ({ schema, sync: syncOptions, syncPayloadSchema }: WorkerOptions) =>
  WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerInnerRequest, {
    InitialMessage: ({ storageOptions, storeId, clientId, devtoolsEnabled, debugInstanceId, syncPayloadEncoded }) =>
      Effect.gen(function* () {
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
        const makeSqliteDb = sqliteDbFactory({ sqlite3 })
        const runtime = yield* Effect.runtime<never>()

        const makeDb = (kind: 'state' | 'eventlog') =>
          makeSqliteDb({
            _tag: 'opfs',
            opfsDirectory: sanitizeOpfsDir(storageOptions.directory, storeId),
            fileName: kind === 'state' ? getStateDbFileName(schema) : 'eventlog.db',
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
        const [dbState, dbEventlog] = yield* Effect.all([makeDb('state'), makeDb('eventlog')], {
          concurrency: 2,
        })

        // Clean up old state database files after successful database creation
        // This prevents OPFS file pool capacity exhaustion from accumulated state db files after schema changes/migrations
        if (dbState.metadata._tag === 'opfs') {
          yield* cleanupOldStateDbFiles({
            vfs: dbState.metadata.vfs,
            currentSchema: schema,
            opfsDirectory: dbState.metadata.persistenceInfo.opfsDirectory,
          })
        }

        const devtoolsOptions = yield* makeDevtoolsOptions({ devtoolsEnabled, dbState, dbEventlog })
        const shutdownChannel = yield* makeShutdownChannel(storeId)

        return makeLeaderThreadLayer({
          schema,
          storeId,
          clientId,
          makeSqliteDb,
          syncOptions,
          dbState,
          dbEventlog,
          devtoolsOptions,
          shutdownChannel,
          syncPayloadEncoded,
          syncPayloadSchema,
        })
      }).pipe(
        Effect.tapCauseLogPretty,
        UnknownError.mapToUnknownError,
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

        const snapshot = workerCtx.dbState.export()
        return { snapshot, migrationsReport: workerCtx.initialState.migrationsReport }
      }).pipe(UnknownError.mapToUnknownError, Effect.withSpan('@livestore/adapter-web:worker:GetRecreateSnapshot')),
    PullStream: ({ cursor }) =>
      Effect.gen(function* () {
        const { syncProcessor } = yield* LeaderThreadCtx
        return syncProcessor.pull({ cursor })
      }).pipe(
        Stream.unwrapScoped,
        // For debugging purposes
        // Stream.tapLogWithLabel('@livestore/adapter-web:worker:PullStream'),
      ),
    PushToLeader: ({ batch }) =>
      Effect.andThen(LeaderThreadCtx, ({ syncProcessor }) =>
        syncProcessor.push(
          batch.map((event) => new LiveStoreEvent.EncodedWithMeta(event)),
          // We'll wait in order to keep back pressure on the client session
          { waitForProcessing: true },
        ),
      ).pipe(Effect.uninterruptible, Effect.withSpan('@livestore/adapter-web:worker:PushToLeader')),
    Export: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbState.export()).pipe(
        UnknownError.mapToUnknownError,
        Effect.withSpan('@livestore/adapter-web:worker:Export'),
      ),
    ExportEventlog: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbEventlog.export()).pipe(
        UnknownError.mapToUnknownError,
        Effect.withSpan('@livestore/adapter-web:worker:ExportEventlog'),
      ),
    BootStatusStream: () =>
      Effect.andThen(LeaderThreadCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
    GetLeaderHead: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return Eventlog.getClientHeadFromDb(workerCtx.dbEventlog)
      }).pipe(UnknownError.mapToUnknownError, Effect.withSpan('@livestore/adapter-web:worker:GetLeaderHead')),
    GetLeaderSyncState: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return yield* workerCtx.syncProcessor.syncState
      }).pipe(UnknownError.mapToUnknownError, Effect.withSpan('@livestore/adapter-web:worker:GetLeaderSyncState')),
    SyncStateStream: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return workerCtx.syncProcessor.syncState.changes
      }).pipe(Stream.unwrapScoped),
    GetNetworkStatus: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return yield* workerCtx.networkStatus
      }).pipe(UnknownError.mapToUnknownError, Effect.withSpan('@livestore/adapter-web:worker:GetNetworkStatus')),
    NetworkStatusStream: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return workerCtx.networkStatus.changes
      }).pipe(Stream.unwrapScoped),
    Shutdown: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug('[@livestore/adapter-web:worker] Shutdown')

        // Buy some time for Otel to flush
        // TODO find a cleaner way to do this
        yield* Effect.sleep(300)
      }).pipe(UnknownError.mapToUnknownError, Effect.withSpan('@livestore/adapter-web:worker:Shutdown')),
    ExtraDevtoolsMessage: ({ message }) =>
      Effect.andThen(LeaderThreadCtx, (_) => _.extraIncomingMessagesQueue.offer(message)).pipe(
        UnknownError.mapToUnknownError,
        Effect.withSpan('@livestore/adapter-web:worker:ExtraDevtoolsMessage'),
      ),
    'DevtoolsWebCommon.CreateConnection': WebmeshWorker.CreateConnection,
  })

const makeDevtoolsOptions = ({
  devtoolsEnabled,
  dbState,
  dbEventlog,
}: {
  devtoolsEnabled: boolean
  dbState: SqliteDb
  dbEventlog: SqliteDb
}): Effect.Effect<DevtoolsOptions, UnknownError, Scope.Scope | WebmeshWorker.CacheService> =>
  Effect.gen(function* () {
    if (devtoolsEnabled === false) {
      return { enabled: false }
    }

    const { node } = yield* WebmeshWorker.CacheService

    return {
      enabled: true,
      boot: Effect.gen(function* () {
        const persistenceInfo = {
          state: dbState.metadata.persistenceInfo,
          eventlog: dbEventlog.metadata.persistenceInfo,
        }

        return { node, persistenceInfo, mode: 'direct' }
      }),
    }
  })
