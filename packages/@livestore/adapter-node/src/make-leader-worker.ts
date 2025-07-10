import './thread-polyfill.js'

import inspector from 'node:inspector'

if (process.execArgv.includes('--inspect')) {
  inspector.open()
  inspector.waitForDebugger()
}

import type { SyncOptions } from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import { Eventlog, LeaderThreadCtx } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
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

import type { TestingOverrides } from './leader-thread-shared.js'
import { makeLeaderThread } from './leader-thread-shared.js'
import * as WorkerSchema from './worker-schema.js'

export type WorkerOptions = {
  schema: LiveStoreSchema
  sync?: SyncOptions
  otelOptions?: {
    tracer?: otel.Tracer
    /** @default 'livestore-node-leader-thread' */
    serviceName?: string
  }
  testing?: TestingOverrides
}

export const getWorkerArgs = () => Schema.decodeSync(WorkerSchema.WorkerArgv)(process.argv[2]!)

export const makeWorker = (options: WorkerOptions) => {
  makeWorkerEffect(options).pipe(
    Effect.provide(Logger.prettyWithThread(options.otelOptions?.serviceName ?? 'livestore-node-leader-thread')),
    PlatformNode.NodeRuntime.runMain,
  )
}

export const makeWorkerEffect = (options: WorkerOptions) => {
  const TracingLive = options.otelOptions?.tracer
    ? Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
        Layer.provideMerge(Layer.succeed(OtelTracer.OtelTracer, options.otelOptions.tracer)),
      )
    : undefined

  return WorkerRunner.layerSerialized(WorkerSchema.LeaderWorkerInner.Request, {
    InitialMessage: (args) =>
      Effect.gen(function* () {
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm()).pipe(
          Effect.withSpan('@livestore/adapter-node:leader-thread:loadSqlite3Wasm'),
        )
        const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
        return yield* makeLeaderThread({
          ...args,
          syncOptions: options.sync,
          schema: options.schema,
          testing: options.testing,
          makeSqliteDb,
        })
      }).pipe(Layer.unwrapScoped),
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
      Effect.andThen(LeaderThreadCtx, (_) => _.dbState.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:worker:Export'),
      ),
    ExportEventlog: () =>
      Effect.andThen(LeaderThreadCtx, (_) => _.dbEventlog.export()).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:worker:ExportEventlog'),
      ),
    GetLeaderHead: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return Eventlog.getClientHeadFromDb(workerCtx.dbEventlog)
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
        const snapshot = workerCtx.dbState.export()
        return { snapshot, migrationsReport: workerCtx.initialState.migrationsReport }
      }).pipe(
        UnexpectedError.mapToUnexpectedError,
        Effect.withSpan('@livestore/adapter-node:worker:GetRecreateSnapshot'),
      ),
    Shutdown: () =>
      Effect.gen(function* () {
        // const { db, dbEventlog } = yield* LeaderThreadCtx
        yield* Effect.logDebug('[@livestore/adapter-node:worker] Shutdown')

        // if (devtools.enabled) {
        //   yield* FiberSet.clear(devtools.connections)
        // }
        // db.close()
        // dbEventlog.close()

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
    // TODO bring back with Effect 4 once it's easier to work with replacing loggers.
    // We basically only want to provide this logger if it's replacing the default logger, not if there's a custom logger already provided.
    // Effect.provide(Logger.prettyWithThread(options.otelOptions?.serviceName ?? 'livestore-node-leader-thread')),
    Effect.provide(FetchHttpClient.layer),
    Effect.provide(PlatformNode.NodeFileSystem.layer),
    TracingLive ? Effect.provide(TracingLive) : identity,
    Logger.withMinimumLogLevel(LogLevel.Debug),
  )
}
