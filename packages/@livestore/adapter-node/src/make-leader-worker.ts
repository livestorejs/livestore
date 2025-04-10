import './thread-polyfill.js'

import inspector from 'node:inspector'
import path from 'node:path'

if (process.execArgv.includes('--inspect')) {
  inspector.open()
  inspector.waitForDebugger()
}

import type { SyncOptions } from '@livestore/common'
import { Devtools, liveStoreStorageFormatVersion, UnexpectedError } from '@livestore/common'
import type { DevtoolsOptions, LeaderSqliteDb } from '@livestore/common/leader-thread'
import {
  configureConnection,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
  Mutationlog,
} from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
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
import { PlatformNode } from '@livestore/utils/node'
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
        _.syncProcessor.push(
          batch.map((item) => new LiveStoreEvent.EncodedWithMeta(item)),
          // We'll wait in order to keep back pressure on the client session
          { waitForProcessing: true },
        ),
      ).pipe(Effect.uninterruptible, Effect.withSpan('@livestore/adapter-node:worker:PushToLeader')),
    BootStatusStream: () =>
      Effect.andThen(LeaderThreadCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
    PullStream: ({ cursor }) =>
      Effect.gen(function* () {
        const { syncProcessor } = yield* LeaderThreadCtx
        return syncProcessor.pull({ cursor })
      }).pipe(Stream.unwrapScoped),
    Export: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbReadModel.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:worker:Export'),
      ),
    ExportMutationlog: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbMutationLog.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:worker:ExportMutationlog'),
      ),
    GetLeaderHead: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return Mutationlog.getClientHeadFromDb(workerCtx.dbMutationLog)
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/adapter-node:worker:GetLeaderHead')),
    GetLeaderSyncState: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return yield* workerCtx.syncProcessor.syncState
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:worker:GetLeaderSyncState'),
      ),
    GetRecreateSnapshot: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        // const result = yield* Deferred.await(workerCtx.initialSetupDeferred)
        // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
        // const cachedSnapshot =
        //   result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined
        // return cachedSnapshot ?? workerCtx.db.export()
        const snapshot = workerCtx.dbReadModel.export()
        return { snapshot, migrationsReport: workerCtx.initialState.migrationsReport }
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:worker:GetRecreateSnapshot'),
      ),
    Shutdown: () =>
      Effect.gen(function* () {
        // const { db, dbMutationLog } = yield* LeaderThreadCtx
        yield* Effect.logDebug('[@livestore/adapter-node:worker] Shutdown')

        // if (devtools.enabled) {
        //   yield* FiberSet.clear(devtools.connections)
        // }
        // db.close()
        // dbMutationLog.close()

        // Buy some time for Otel to flush
        // TODO find a cleaner way to do this
        // yield* Effect.sleep(1000)
      }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/adapter-node:worker:Shutdown')),
    ExtraDevtoolsMessage: ({ message }) =>
      Effect.andThen(LeaderThreadCtx, (_) => _.extraIncomingMessagesQueue.offer(message)).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:worker:ExtraDevtoolsMessage'),
      ),
  }).pipe(
    Layer.provide(PlatformNode.NodeWorkerRunner.layer),
    WorkerRunner.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({
      thread: options.otelOptions?.serviceName ?? 'livestore-node-leader-thread',
      processId: process.pid,
    }),
    Effect.provide(Logger.prettyWithThread(options.otelOptions?.serviceName ?? 'livestore-node-leader-thread')),
    Effect.provide(FetchHttpClient.layer),
    Effect.provide(PlatformNode.NodeFileSystem.layer),
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
  syncPayload,
}: WorkerSchema.LeaderWorkerInner.InitialMessage & {
  syncOptions: SyncOptions | undefined
  schemaPath: string
}): Layer.Layer<LeaderThreadCtx, UnexpectedError, Scope.Scope | HttpClient.HttpClient | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const schema = yield* Effect.promise(() => import(schemaPath).then((m) => m.schema as LiveStoreSchema))

    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
      Effect.withSpan('@livestore/adapter-node:leader-thread:loadSqlite3Wasm'),
    )
    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
    const runtime = yield* Effect.runtime<never>()

    const schemaHashSuffix = schema.migrationOptions.strategy === 'manual' ? 'fixed' : schema.hash.toString()

    const makeDb = (kind: 'app' | 'mutationlog') =>
      makeSqliteDb({
        _tag: 'fs',
        directory: path.join(baseDirectory ?? '', storeId),
        fileName:
          kind === 'app' ? getAppDbFileName(schemaHashSuffix) : `mutationlog@${liveStoreStorageFormatVersion}.db`,
        // TODO enable WAL for nodejs
        configureDb: (db) =>
          configureConnection(db, { foreignKeys: true }).pipe(Effect.provide(runtime), Effect.runSync),
      }).pipe(Effect.acquireRelease((db) => Effect.sync(() => db.close())))

    // Might involve some async work, so we're running them concurrently
    const [dbReadModel, dbMutationLog] = yield* Effect.all([makeDb('app'), makeDb('mutationlog')], { concurrency: 2 })

    const devtoolsOptions = yield* makeDevtoolsOptions({
      devtoolsEnabled: devtools.enabled,
      devtoolsPort: devtools.port,
      devtoolsHost: devtools.host,
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
      syncPayload,
    })
  }).pipe(
    Effect.tapCauseLogPretty,
    UnexpectedError.mapToUnexpectedError,
    Effect.withSpan('@livestore/adapter-node:worker:InitialMessage'),
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
  devtoolsHost,
  schemaPath,
}: {
  devtoolsEnabled: boolean
  dbReadModel: LeaderSqliteDb
  dbMutationLog: LeaderSqliteDb
  storeId: string
  clientId: string
  devtoolsPort: number
  devtoolsHost: string
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
          host: devtoolsHost,
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

        const devtoolsWebChannel = yield* makeNodeDevtoolsChannel({
          nodeName: `leader-${storeId}-${clientId}`,
          target: `devtools-${storeId}-${clientId}-static`,
          url: `ws://localhost:${devtoolsPort}`,
          schema: { listen: Devtools.Leader.MessageToApp, send: Devtools.Leader.MessageFromApp },
        })

        return {
          devtoolsWebChannel,
          persistenceInfo: {
            readModel: dbReadModel.metadata.persistenceInfo,
            mutationLog: dbMutationLog.metadata.persistenceInfo,
          },
        }
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    }
  })
