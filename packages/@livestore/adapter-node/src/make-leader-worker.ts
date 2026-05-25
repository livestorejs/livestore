import './thread-polyfill.ts'
import inspector from 'node:inspector'

import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeWorkerRunner from '@effect/platform-node/NodeWorkerRunner'
if (process.execArgv.includes('--inspect') === true) {
  inspector.open()
  inspector.waitForDebugger()
}

import type * as otel from '@opentelemetry/api'

import type { SyncOptions } from '@livestore/common'
import { LogConfig, UnknownError } from '@livestore/common'
import type { StreamEventsOptions } from '@livestore/common/leader-thread'
import { Eventlog, LeaderThreadCtx, streamEventsWithSyncState } from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect, FetchHttpClient, Layer, OtelTracer, Queue, RpcServer, Schema, Stream, Tracer } from '@livestore/utils/effect'

import type { TestingOverrides } from './leader-thread-shared.ts'
import { makeLeaderThread } from './leader-thread-shared.ts'
import * as WorkerSchema from './worker-schema.ts'

export type WorkerOptions = {
  schema: LiveStoreSchema
  sync?: SyncOptions
  syncPayloadSchema?: Schema.Schema<any>
  otelOptions?: {
    tracer?: otel.Tracer
    /** @default 'livestore-node-leader-thread' */
    serviceName?: string
  }
  testing?: TestingOverrides
} & LogConfig.WithLoggerOptions

export const getWorkerArgs = () => Schema.decodeSync(WorkerSchema.WorkerArgv)(process.argv[2]!)

export const makeWorker = (options: WorkerOptions) => {
  makeWorkerEffect(options).pipe((effect) => NodeRuntime.runMain(effect as unknown as Effect.Effect<unknown, unknown, never>))
}

export const makeWorkerEffect = (options: WorkerOptions) => {
  const TracingLive = options.otelOptions?.tracer !== undefined
    ? Layer.effect(Tracer.Tracer, OtelTracer.make).pipe(
        Layer.provideMerge(Layer.succeed(OtelTracer.OtelTracer, options.otelOptions.tracer)),
      )
    : undefined

  // Merge the runtime dependencies once so we can provide them together without chaining Effect.provide.
  const runtimeLayer = Layer.mergeAll(
    FetchHttpClient.layer,
    NodeFileSystem.layer,
    TracingLive ?? Layer.empty,
  )

  const LeaderThreadLive = Layer.unwrapScoped(
    Effect.gen(function* () {
      const protocol = yield* RpcServer.Protocol
      const args = yield* protocol.initialMessage.pipe(
        Effect.flatMap((option) => Effect.fromOption(option)),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.toCodecJson(WorkerSchema.LeaderWorkerInnerInitialMessage))),
        Effect.orDie,
      )
      return yield* Effect.gen(function* () {
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
          syncPayloadEncoded: args.syncPayloadEncoded,
          syncPayloadSchema: options.syncPayloadSchema,
        })
      })
    }),
  )

  const WorkerHandlers = WorkerSchema.LeaderWorkerInnerRpcs.toLayer({
    PushToLeader: ({ batch }) =>
      Effect.andThen(LeaderThreadCtx, (_) =>
        _.syncProcessor.push(
          batch.map(
            (item: typeof LiveStoreEvent.Client.Encoded.Type) => new LiveStoreEvent.Client.EncodedWithMeta(item),
          ),
          // We'll wait in order to keep back pressure on the client session
          { waitForProcessing: true },
        ),
      ).pipe(Effect.uninterruptible, Effect.withSpan('@livestore/adapter-node:worker:PushToLeader')),
    BootStatusStream: () =>
      Effect.map(LeaderThreadCtx, (_) => Stream.fromQueue(_.bootStatusQueue)).pipe(Stream.unwrap),
    PullStream: ({ cursor }) =>
      Effect.gen(function* () {
        const { syncProcessor } = yield* LeaderThreadCtx
        return syncProcessor.pull({ cursor })
      }).pipe(Stream.unwrapScoped),
    StreamEvents: (options) =>
      LeaderThreadCtx.pipe(
        Effect.map(({ dbEventlog, syncProcessor }) => {
          const streamOptions = options as StreamEventsOptions
          return streamEventsWithSyncState({
            dbEventlog,
            syncState: syncProcessor.syncState,
            options: streamOptions,
          })
        }),
        Stream.unwrapScoped,
        Stream.withSpan('@livestore/adapter-node:worker:StreamEvents'),
      ),
    Export: () =>
      Effect.map(LeaderThreadCtx, (_) => _.dbState.export()).pipe(
        Effect.withSpan('@livestore/adapter-node:worker:Export'),
      ),
    ExportEventlog: () =>
      Effect.map(LeaderThreadCtx, (_) => _.dbEventlog.export()).pipe(
        Effect.withSpan('@livestore/adapter-node:worker:ExportEventlog'),
      ),
    GetLeaderHead: Effect.fn('@livestore/adapter-node:worker:GetLeaderHead')(function* () {
      const workerCtx = yield* LeaderThreadCtx
      return Eventlog.getClientHeadFromDb(workerCtx.dbEventlog)
    }),
    GetLeaderSyncState: Effect.fn('@livestore/adapter-node:worker:GetLeaderSyncState')(function* () {
      const workerCtx = yield* LeaderThreadCtx
      return yield* workerCtx.syncProcessor.syncState
    }),
    SyncStateStream: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return workerCtx.syncProcessor.syncState.changes
      }).pipe(Stream.unwrapScoped),
    GetNetworkStatus: Effect.fn('@livestore/adapter-node:worker:GetNetworkStatus')(function* () {
      const workerCtx = yield* LeaderThreadCtx
      return yield* workerCtx.networkStatus
    }),
    NetworkStatusStream: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return workerCtx.networkStatus.changes
      }).pipe(Stream.unwrapScoped),
    GetRecreateSnapshot: Effect.fn('@livestore/adapter-node:worker:GetRecreateSnapshot')(function* () {
      const workerCtx = yield* LeaderThreadCtx
      // const result = yield* Deferred.await(workerCtx.initialSetupDeferred)
      // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
      // const cachedSnapshot =
      //   result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined
      // return cachedSnapshot ?? workerCtx.db.export()
      const snapshot = workerCtx.dbState.export()
      return { snapshot, migrationsReport: workerCtx.initialState.migrationsReport }
    }),
    Shutdown: Effect.fn('@livestore/adapter-node:worker:Shutdown')(function* () {
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
    }),
    ExtraDevtoolsMessage: ({ message }) =>
      Effect.andThen(LeaderThreadCtx, (_) => Queue.offer(_.extraIncomingMessagesQueue, message)).pipe(
        Effect.asVoid,
        Effect.withSpan('@livestore/adapter-node:worker:ExtraDevtoolsMessage'),
      ),
  })

  const WorkerLive = WorkerHandlers.pipe(
    Layer.provide(LeaderThreadLive),
    Layer.provideMerge(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(NodeWorkerRunner.layer),
  )

  return RpcServer.make(WorkerSchema.LeaderWorkerInnerRpcs).pipe(
    Effect.provide(WorkerLive),
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({
      thread: options.otelOptions?.serviceName ?? 'livestore-node-leader-thread',
      processId: process.pid,
    }),
    LogConfig.withLoggerConfig(
      { logger: options.logger, logLevel: options.logLevel },
      { threadName: options.otelOptions?.serviceName ?? 'livestore-node-leader-thread' },
    ),
    // TODO bring back with Effect 4 once it's easier to work with replacing loggers.
    // We basically only want to provide this logger if it's replacing the default logger, not if there's a custom logger already provided.
    // Effect.provide(Logger.prettyWithThread(options.otelOptions?.serviceName ?? 'livestore-node-leader-thread')),
    Effect.provide(runtimeLayer),
  )
}
