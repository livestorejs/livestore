import './thread-polyfill.js'

import inspector from 'node:inspector'
import path from 'node:path'

if (process.execArgv.includes('--inspect')) {
  inspector.open()
  inspector.waitForDebugger()
}

import { NodeFileSystem, NodeWorkerRunner } from '@effect/platform-node'
import type { NetworkStatus, SyncOptions } from '@livestore/common'
import { Devtools, liveStoreStorageFormatVersion, UnexpectedError } from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb } from '@livestore/common/leader-thread'
import {
  configureConnection,
  getLocalHeadFromDb,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
} from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { MutationEvent } from '@livestore/common/schema'
import { makeNodeDevtoolsChannel } from '@livestore/devtools-node-common/web-channel'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import type { FileSystem, HttpClient, Scope } from '@livestore/utils/effect'
import {
  Effect,
  FetchHttpClient,
  identity,
  Layer,
  Logger,
  LogLevel,
  OtelTracer,
  Schema,
  Stream,
  WorkerRunner,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import { startDevtoolsServer } from './devtools/devtools-server.js'
import { makeShutdownChannel } from './shutdown-channel.js'
import * as WorkerSchema from './worker-schema.js'

export type WorkerOptions = {
  sync?: SyncOptions
  otelOptions?: {
    tracer?: otel.Tracer
    /** @default 'livestore-node-leader-thread' */
    serviceName?: string
  }
}

export const getWorkerArgs = () => Schema.decodeSync(WorkerSchema.WorkerArgv)(process.argv[2]!)

export const makeWorker = (options: WorkerOptions) => {
  makeWorkerEffect(options).pipe(Effect.runFork)
}

export const makeWorkerEffect = (options: WorkerOptions) => {
  const TracingLive = options.otelOptions?.tracer
    ? Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
        Layer.provideMerge(Layer.succeed(OtelTracer.OtelTracer, options.otelOptions.tracer)),
      )
    : undefined

  return WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerInner.Request, {
    InitialMessage: (args) => makeLeaderThread({ ...args, syncOptions: options.sync }),
    PushToLeader: ({ batch }) =>
      Effect.andThen(LeaderThreadCtx, (_) =>
        _.syncProcessor.push(batch.map((item) => new MutationEvent.EncodedWithMeta(item))),
      ).pipe(Effect.uninterruptible, Effect.withSpan('@livestore/node:worker:PushToLeader')),
    BootStatusStream: () =>
      Effect.andThen(LeaderThreadCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
    PullStream: ({ cursor }) =>
      Effect.gen(function* () {
        const { connectedClientSessionPullQueues } = yield* LeaderThreadCtx
        const pullQueue = yield* connectedClientSessionPullQueues.makeQueue(cursor)
        return Stream.fromQueue(pullQueue)
      }).pipe(Stream.unwrapScoped),
    Export: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbReadModel.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/node:worker:Export'),
      ),
    ExportMutationlog: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbMutationLog.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/node:worker:ExportMutationlog'),
      ),
    GetCurrentMutationEventId: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return getLocalHeadFromDb(workerCtx.dbMutationLog)
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/node:worker:GetCurrentMutationEventId'),
      ),
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
    GetLeaderSyncState: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return yield* workerCtx.syncProcessor.syncState
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/node:worker:GetLeaderSyncState')),
    // GetRecreateSnapshot: () =>
    //   Effect.gen(function* () {
    //     const workerCtx = yield* LeaderThreadCtx
    //     const result = yield* Deferred.await(workerCtx.initialSetupDeferred)
    //     // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
    //     const cachedSnapshot =
    //       result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined
    //     return cachedSnapshot ?? workerCtx.db.export()
    //   }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/node:worker:GetRecreateSnapshot')),
    Shutdown: () =>
      Effect.gen(function* () {
        // const { db, dbMutationLog } = yield* LeaderThreadCtx
        yield* Effect.logDebug('[@livestore/node:worker] Shutdown')

        // if (devtools.enabled) {
        //   yield* FiberSet.clear(devtools.connections)
        // }
        // db.close()
        // dbMutationLog.close()

        // Buy some time for Otel to flush
        // TODO find a cleaner way to do this
        // yield* Effect.sleep(1000)
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/node:worker:Shutdown')),
    ExtraDevtoolsMessage: ({ message }) =>
      Effect.andThen(LeaderThreadCtx, (_) => _.extraIncomingMessagesQueue.offer(message)).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/node:worker:ExtraDevtoolsMessage'),
      ),
  }).pipe(
    Layer.provide(NodeWorkerRunner.layer),
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: options.otelOptions?.serviceName ?? 'livestore-node-leader-thread' }),
    Effect.provide(Logger.prettyWithThread(options.otelOptions?.serviceName ?? 'livestore-node-leader-thread')),
    Effect.provide(FetchHttpClient.layer),
    Effect.provide(NodeFileSystem.layer),
    TracingLive ? Effect.provide(TracingLive) : identity,
    Logger.withMinimumLogLevel(LogLevel.Debug),
  )
}

const makeLeaderThread = ({
  storeId,
  clientId,
  syncOptions,
  baseDirectory,
  devtools,
  schemaPath,
}: WorkerSchema.LeaderWorkerInner.InitialMessage & {
  syncOptions: SyncOptions | undefined
  schemaPath: string
}): Layer.Layer<LeaderThreadCtx, UnexpectedError, Scope.Scope | HttpClient.HttpClient | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const schema = yield* Effect.promise(() => import(schemaPath).then((m) => m.schema as LiveStoreSchema))

    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
      Effect.withSpan('@livestore/node:leader-thread:loadSqlite3Wasm'),
    )
    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })

    const schemaHashSuffix = schema.migrationOptions.strategy === 'manual' ? 'fixed' : schema.hash.toString()

    const makeDb = (kind: 'app' | 'mutationlog') =>
      makeSqliteDb({
        _tag: 'fs',
        directory: path.join(baseDirectory ?? '', storeId),
        fileName:
          kind === 'app' ? getAppDbFileName(schemaHashSuffix) : `mutationlog@${liveStoreStorageFormatVersion}.db`,
        // TODO enable WAL for nodejs
        configureDb: (db) => configureConnection(db, { foreignKeys: true }),
      }).pipe(Effect.acquireRelease((db) => Effect.sync(() => db.close())))

    // Might involve some async work, so we're running them concurrently
    const [dbReadModel, dbMutationLog] = yield* Effect.all([makeDb('app'), makeDb('mutationlog')], { concurrency: 2 })

    const devtoolsOptions = yield* makeDevtoolsOptions({
      devtoolsEnabled: devtools.enabled,
      devtoolsPort: devtools.port,
      dbReadModel,
      dbMutationLog,
      storeId,
      clientId,
      schemaPath,
    })

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
    Effect.withSpan('@livestore/node:worker:InitialMessage'),
    Layer.unwrapScoped,
  )

const getAppDbFileName = (suffix: string) => `app${suffix}@${liveStoreStorageFormatVersion}.db`

const makeDevtoolsOptions = ({
  devtoolsEnabled,
  dbReadModel,
  dbMutationLog,
  storeId,
  clientId,
  devtoolsPort,
  schemaPath,
}: {
  devtoolsEnabled: boolean
  dbReadModel: LeaderSqliteDb
  dbMutationLog: LeaderSqliteDb
  storeId: string
  clientId: string
  devtoolsPort: number
  schemaPath: string
}): Effect.Effect<DevtoolsOptions, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    if (devtoolsEnabled === false) {
      return {
        enabled: false,
      }
    }

    return {
      enabled: true,
      makeBootContext: Effect.gen(function* () {
        // TODO instead of failing when the port is already in use, we should try to use that WS server instead of starting a new one
        yield* startDevtoolsServer({
          schemaPath,
          storeId,
          clientId,
          sessionId: 'static', // TODO make this dynamic
          port: devtoolsPort,
        })

        return {
          devtoolsWebChannel: yield* makeNodeDevtoolsChannel({
            nodeName: `leader-${storeId}-${clientId}`,
            target: `devtools`,
            url: `ws://localhost:${devtoolsPort}`,
            schema: {
              listen: Devtools.Leader.MessageToApp,
              send: Devtools.Leader.MessageFromApp,
            },
          }),
          persistenceInfo: {
            readModel: dbReadModel.metadata.persistenceInfo,
            mutationLog: dbMutationLog.metadata.persistenceInfo,
          },
        }
      }),
    }
  })
