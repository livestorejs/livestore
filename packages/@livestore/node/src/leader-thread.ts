import './thread-polyfill.js'

import inspector from 'node:inspector'
import path from 'node:path'

if (process.execArgv.includes('--inspect')) {
  inspector.open()
  inspector.waitForDebugger()
}

import { NodeFileSystem, NodeWorkerRunner } from '@effect/platform-node'
import type { NetworkStatus } from '@livestore/common'
import { Devtools, liveStoreStorageFormatVersion, sql, UnexpectedError } from '@livestore/common'
import type { DevtoolsOptions, LeaderDatabase } from '@livestore/common/leader-thread'
import { configureConnection, LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { EventId, MutationEvent } from '@livestore/common/schema'
import { makeNodeDevtoolsChannel } from '@livestore/devtools-node-common/web-channel'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { syncDbFactory } from '@livestore/sqlite-wasm/node'
import type { FileSystem, HttpClient, Scope } from '@livestore/utils/effect'
import { Effect, FetchHttpClient, Layer, Logger, LogLevel, Schema, Stream, WorkerRunner } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'

import { startDevtoolsServer } from './devtools/devtools-server.js'
import { makeShutdownChannel } from './shutdown-channel.js'
import * as WorkerSchema from './worker-schema.js'

const argvOptions = Schema.decodeSync(WorkerSchema.WorkerArgv)(process.argv[2]!)

WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerInner.Request, {
  InitialMessage: (args) => makeLeaderThread(args),
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
    Effect.andThen(LeaderThreadCtx, (_) => _.db.export()).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/node:worker:Export'),
    ),
  ExportMutationlog: () =>
    Effect.andThen(LeaderThreadCtx, (_) => _.dbLog.export()).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.withSpan('@livestore/node:worker:ExportMutationlog'),
    ),
  GetCurrentMutationEventId: () =>
    Effect.gen(function* () {
      const workerCtx = yield* LeaderThreadCtx
      const result = workerCtx.dbLog.select<{ idGlobal: EventId.GlobalEventId; idLocal: EventId.LocalEventId }>(
        sql`SELECT idGlobal, idLocal FROM mutation_log ORDER BY idGlobal DESC, idLocal DESC LIMIT 1`,
      )[0]

      return result ? { global: result.idGlobal, local: result.idLocal } : EventId.ROOT
    }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/node:worker:GetCurrentMutationEventId')),
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
      const { db, dbLog } = yield* LeaderThreadCtx
      yield* Effect.logDebug('[@livestore/node:worker] Shutdown')

      // if (devtools.enabled) {
      //   yield* FiberSet.clear(devtools.connections)
      // }

      db.close()
      dbLog.close()

      // Buy some time for Otel to flush
      // TODO find a cleaner way to do this
      // yield* Effect.sleep(1000)
    }).pipe(UnexpectedError.mapToUnexpectedError, Effect.withSpan('@livestore/node:worker:Shutdown')),
}).pipe(
  Layer.provide(NodeWorkerRunner.layer),
  Layer.launch,
  Effect.scoped,
  Effect.tapCauseLogPretty,
  Effect.annotateLogs({ thread: argvOptions.otel?.workerServiceName ?? 'livestore-node-leader-thread' }),
  Effect.provide(Logger.prettyWithThread(argvOptions.otel?.workerServiceName ?? 'livestore-node-leader-thread')),
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(NodeFileSystem.layer),
  Effect.provide(
    OtelLiveHttp({
      serviceName: argvOptions.otel?.workerServiceName ?? 'livestore-node-leader-thread',
      skipLogUrl: true,
    }),
  ),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  Effect.runFork,
)

const makeLeaderThread = ({
  schemaPath,
  storeId,
  originId,
  syncOptions,
  makeSyncBackendUrl,
  baseDirectory,
  devtoolsEnabled,
  devtoolsPort,
  initialSyncOptions,
}: WorkerSchema.LeaderWorkerInner.InitialMessage): Layer.Layer<
  LeaderThreadCtx,
  UnexpectedError,
  Scope.Scope | HttpClient.HttpClient | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const schema = yield* Effect.promise(() => import(schemaPath).then((m) => m.schema as LiveStoreSchema))
    const makeSyncBackend = makeSyncBackendUrl
      ? yield* Effect.promise(() => import(makeSyncBackendUrl).then((m) => m.makeWsSync))
      : undefined

    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
      Effect.withSpan('@livestore/node:leader-thread:loadSqlite3Wasm'),
    )
    const makeSyncDb = yield* syncDbFactory({ sqlite3 })

    const schemaHashSuffix = schema.migrationOptions.strategy === 'manual' ? 'fixed' : schema.hash.toString()

    const makeDb = (kind: 'app' | 'mutationlog') =>
      makeSyncDb({
        _tag: 'fs',
        directory: path.join(baseDirectory ?? '', storeId),
        fileName:
          kind === 'app' ? getAppDbFileName(schemaHashSuffix) : `mutationlog@${liveStoreStorageFormatVersion}.db`,
        // TODO enable WAL for nodejs
        configureDb: (db) => configureConnection(db, { fkEnabled: true }),
      }).pipe(Effect.acquireRelease((db) => Effect.sync(() => db.close())))

    // Might involve some async work, so we're running them concurrently
    const [db, dbLog] = yield* Effect.all([makeDb('app'), makeDb('mutationlog')], { concurrency: 2 })

    const devtoolsOptions = yield* makeDevtoolsOptions({
      devtoolsEnabled,
      db,
      dbLog,
      storeId,
      devtoolsPort,
      schemaPath,
    })

    return makeLeaderThreadLayer({
      schema,
      storeId,
      originId,
      makeSyncDb,
      makeSyncBackend:
        makeSyncBackend === undefined || syncOptions === undefined ? undefined : makeSyncBackend(syncOptions),
      db,
      dbLog,
      devtoolsOptions,
      initialSyncOptions,
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
  db,
  dbLog,
  storeId,
  devtoolsPort,
  schemaPath,
}: {
  devtoolsEnabled: boolean
  db: LeaderDatabase
  dbLog: LeaderDatabase
  storeId: string
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
      makeContext: Effect.gen(function* () {
        const shutdownChannel = yield* makeShutdownChannel(storeId)

        yield* startDevtoolsServer({ schemaPath, storeId, port: devtoolsPort }).pipe(
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
        )

        const sessionId = 'static'
        const appHostId = `${storeId}-${sessionId}`
        return {
          devtoolsWebChannel: yield* makeNodeDevtoolsChannel({
            nodeName: `app-coordinator-${appHostId}`,
            target: `devtools`,
            url: `ws://localhost:${devtoolsPort}`,
            schema: { listen: Devtools.MessageToAppLeader, send: Devtools.MessageFromAppLeader },
          }),
          shutdownChannel,
          persistenceInfo: {
            db: db.metadata.persistenceInfo,
            mutationLog: dbLog.metadata.persistenceInfo,
          },
        }
      }),
    }
  })
