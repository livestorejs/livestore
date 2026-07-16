import type * as otel from '@opentelemetry/api'

import type { BootStatus, BootWarningReason, LogConfig, SqliteDb, SyncOptions } from '@livestore/common'
import { Devtools, UnknownError } from '@livestore/common'
import type { DevtoolsOptions, StreamEventsOptions } from '@livestore/common/leader-thread'
import {
  configureConnection,
  Eventlog,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
  streamEventsWithSyncState,
} from '@livestore/common/leader-thread'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { LiveStoreEvent } from '@livestore/common/schema'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/browser'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { isDevEnv, LS_DEV } from '@livestore/utils'
import {
  Cause,
  Deferred,
  Effect,
  FetchHttpClient,
  identity,
  Layer,
  OtelTracer,
  Queue,
  References,
  RpcServer,
  RpcWorker,
  Schema,
  Scope,
  Stream,
  TaskTracing,
} from '@livestore/utils/effect'
import { BrowserWorkerRunner, Opfs, WebError } from '@livestore/utils/effect/browser'
import * as WebmeshWorker from '@livestore/webmesh/worker'

import { cleanupOldStateDbFiles, getStateDbFileName, sanitizeOpfsDir } from '../common/persisted-sqlite.ts'
import { requestScopedCauseRpcServerOptions } from '../common/rpc-server-options.ts'
import { makeShutdownChannel } from '../common/shutdown-channel.ts'
import * as WorkerSchema from '../common/worker-schema.ts'

export type WorkerOptions = {
  schema: LiveStoreSchema
  sync?: SyncOptions
  syncPayloadSchema?: Schema.Top
  otelOptions?: {
    tracer?: otel.Tracer
  }
} & LogConfig.LoggerOptions

if (isDevEnv() === true) {
  globalThis.__debugLiveStoreUtils = {
    opfs: Opfs.debugUtils,
    blobUrl: (buffer: Uint8Array<ArrayBuffer>) =>
      URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })),
    runSync: <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect),
    runFork: <A, E>(effect: Effect.Effect<A, E>) => Effect.runFork(effect),
  }
}

export const makeWorker = (options: WorkerOptions) => {
  Effect.runFork(makeWorkerEffect(options))
}

export const makeWorkerEffect = (options: WorkerOptions) => {
  const TracingLive =
    options.otelOptions?.tracer !== undefined
      ? OtelTracer.layerWithoutOtelTracer.pipe(
          Layer.provideMerge(Layer.succeed(OtelTracer.OtelTracer, options.otelOptions.tracer)),
        )
      : Layer.empty

  const runtimeLayer = Layer.mergeAll(
    FetchHttpClient.layer,
    TracingLive,
    Layer.succeed(References.MaxOpsBeforeYield, 4096),
  )

  return makeWorkerRunnerOuter(options).pipe(
    Effect.provide(RpcServer.layerProtocolWorkerRunner),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(runtimeLayer),
    LS_DEV === true ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
    Effect.provide(
      Layer.mergeAll(
        options.logger ?? Layer.empty,
        Layer.succeed(References.MinimumLogLevel, options.logLevel ?? (isDevEnv() === true ? 'Debug' : 'Info')),
      ),
    ),
  )
}

const makeWorkerRunnerOuter = (workerOptions: WorkerOptions) =>
  Effect.gen(function* () {
    // Port coming from client session and forwarded via the shared worker.
    const {
      port: incomingRequestsPort,
      storeId,
      clientId,
    } = yield* RpcWorker.initialMessage(WorkerSchema.LeaderWorkerOuterInitialMessage.payloadSchema)

    return yield* RpcServer.make(WorkerSchema.LeaderWorkerInnerRpcs, requestScopedCauseRpcServerOptions).pipe(
      Effect.provide(makeWorkerRunnerInner(workerOptions)),
      Effect.provide(makeMessagePortRpcServerProtocol(incomingRequestsPort)),
      Effect.withSpan('@livestore/adapter-web:worker:wrapper:InitialMessage:innerFiber'),
      Effect.tapCauseLogPretty,
      Effect.provide(
        Layer.mergeAll(
          Opfs.layer,
          WebmeshWorker.CacheService.layer({
            nodeName: Devtools.makeNodeName.client.leader({ storeId, clientId }),
          }),
        ),
      ),
    )
  }).pipe(Effect.withSpan('@livestore/adapter-web:worker:wrapper:InitialMessage'))

const makeMessagePortRpcServerProtocol = (port: MessagePort): Layer.Layer<RpcServer.Protocol> =>
  Layer.effect(
    RpcServer.Protocol,
    Effect.gen(function* () {
      const disconnects = yield* Queue.unbounded<number>()
      const initialMessage = yield* Deferred.make<unknown>()
      const closed = yield* Deferred.make<void>()
      const clientIds = new Set<number>()

      return RpcServer.Protocol.of({
        disconnects,
        send: (_clientId, response, transferables) =>
          Effect.sync(() => port.postMessage([1, response], { transfer: (transferables ?? []) as Transferable[] })),
        end: () => Effect.void,
        clientIds: Effect.sync(() => clientIds),
        initialMessage: Effect.asSome(Deferred.await(initialMessage)),
        supportsAck: true,
        supportsTransferables: true,
        supportsSpanPropagation: true,
        run: (writeRequest) =>
          Effect.gen(function* () {
            const context = yield* Effect.context<never>()
            const runFork = Effect.runForkWith(context)
            const onMessage = (event: MessageEvent) => {
              const message = event.data as readonly [0 | 1, unknown?]
              if (message[0] === 1) {
                runFork(
                  Effect.gen(function* () {
                    yield* Queue.offer(disconnects, 0)
                    yield* Deferred.succeed(closed, undefined)
                  }),
                )
                return
              }

              const request = message[1] as { readonly _tag?: string; readonly value?: unknown }
              clientIds.add(0)
              if (request._tag === 'InitialMessage') {
                runFork(Deferred.succeed(initialMessage, request.value))
              } else {
                runFork(writeRequest(0, request as never))
              }
            }

            port.addEventListener('message', onMessage)
            port.start()
            port.postMessage([0])

            return yield* Deferred.await(closed).pipe(
              Effect.andThen(Effect.interrupt),
              Effect.ensuring(
                Effect.sync(() => {
                  port.removeEventListener('message', onMessage)
                  port.close()
                }),
              ),
            )
          }),
      })
    }),
  )

const makeWorkerRunnerInner = ({ schema, sync: syncOptions, syncPayloadSchema }: WorkerOptions) =>
  WorkerSchema.LeaderWorkerInnerRpcs.toLayer(
    Effect.gen(function* () {
      const leaderThreadScope = yield* Scope.make()
      yield* Effect.addFinalizer((exit) => Scope.close(leaderThreadScope, exit))

      const leaderThreadContextOnce = yield* Effect.cached(
        Effect.gen(function* () {
          const { storageOptions, storeId, clientId, devtoolsEnabled, debugInstanceId, syncPayloadEncoded } =
            yield* RpcWorker.initialMessage(WorkerSchema.LeaderWorkerInnerInitialMessage.payloadSchema)

          const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
          const makeSqliteDb = sqliteDbFactory({ sqlite3 })
          const services = yield* Effect.context()

          // Check OPFS availability and determine storage mode
          const opfsCheck = yield* checkOpfsAvailability
          const useOpfs = opfsCheck === undefined

          // Track boot warning to emit later
          let bootWarning: BootStatus | undefined
          if (useOpfs === false) {
            yield* Effect.logWarning(
              '[@livestore/adapter-web:worker] OPFS unavailable, using in-memory storage',
              opfsCheck,
            )
            bootWarning = { stage: 'warning', ...opfsCheck }
          }

          const opfsDirectory = useOpfs === true ? yield* sanitizeOpfsDir(storageOptions.directory, storeId) : undefined

          const makeOpfsDb = (kind: 'state' | 'eventlog') =>
            Effect.acquireRelease(
              makeSqliteDb({
                _tag: 'opfs',
                opfsDirectory: opfsDirectory!,
                fileName: kind === 'state' ? getStateDbFileName(schema) : 'eventlog.db',
                configureDb: (db) =>
                  configureConnection(db, {
                    //  The persisted databases use the AccessHandlePoolVFS which always uses a single database connection.
                    //  Multiple connections are not supported. This means that we can use the exclusive locking mode to
                    //  avoid unnecessary system calls and enable the use of the WAL journal mode without the use of shared memory.
                    // TODO bring back exclusive locking mode when `WAL` is working properly
                    // lockingMode: 'EXCLUSIVE',
                    foreignKeys: true,
                  }).pipe(Effect.runSyncWith(services)),
              }),
              (db) =>
                Effect.try({
                  try: () => db.close(),
                  catch: (cause) => new Cause.UnknownError(cause),
                }).pipe(Effect.ignore),
            )

          const makeInMemoryDb = () =>
            Effect.acquireRelease(
              makeSqliteDb({
                _tag: 'in-memory',
                configureDb: (db) => configureConnection(db, { foreignKeys: true }).pipe(Effect.runSyncWith(services)),
              }),
              (db) =>
                Effect.try({
                  try: () => db.close(),
                  catch: (cause) => new Cause.UnknownError(cause),
                }).pipe(Effect.ignore),
            )

          // Use OPFS if available, otherwise fall back to in-memory
          const [dbState, dbEventlog] =
            useOpfs === true
              ? yield* Effect.all([makeOpfsDb('state'), makeOpfsDb('eventlog')], { concurrency: 2 })
              : yield* Effect.all([makeInMemoryDb(), makeInMemoryDb()], { concurrency: 2 })

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

          return yield* Layer.buildWithScope(
            makeLeaderThreadLayer({
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
              syncPayloadSchema: syncPayloadSchema as Schema.Decoder<Schema.Json, never> | undefined,
              ...(bootWarning !== undefined ? { bootWarning } : {}),
            }),
            leaderThreadScope,
          )
        }).pipe(
          Scope.provide(leaderThreadScope),
          Effect.tapCauseLogPretty,
          UnknownError.mapToUnknownError,
          Effect.withPerformanceMeasure('@livestore/adapter-web:worker:InitialMessage'),
          Effect.withSpan('@livestore/adapter-web:worker:InitialMessage'),
          Effect.orDie,
        ),
      )

      const provideLeaderThread = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const leaderThreadContext = yield* leaderThreadContextOnce
          return yield* effect.pipe(Effect.provide(leaderThreadContext))
        })
      const provideLeaderThreadStream = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const leaderThreadContext = yield* leaderThreadContextOnce
            return stream.pipe(Stream.provide(leaderThreadContext))
          }),
        )

      return WorkerSchema.LeaderWorkerInnerRpcs.of({
        GetRecreateSnapshot: () =>
          Effect.gen(function* () {
            const workerCtx = yield* LeaderThreadCtx

            // NOTE we can only return the cached snapshot once as it's transferred (i.e. disposed), so we need to set it to undefined
            // const cachedSnapshot =
            //   result._tag === 'Recreate' ? yield* Ref.getAndSet(result.snapshotRef, undefined) : undefined

            // return cachedSnapshot ?? workerCtx.db.export()

            const snapshot = workerCtx.dbState.export()
            return { snapshot, migrationsReport: workerCtx.initialState.migrationsReport }
          }).pipe(provideLeaderThread),
        PullStream: ({ cursor }) =>
          Effect.gen(function* () {
            const { syncProcessor } = yield* LeaderThreadCtx // <- syncState comes from here
            return syncProcessor.pull({ cursor })
          }).pipe(
            provideLeaderThread,
            Stream.unwrap,
            // For debugging purposes
            // Stream.tapLogWithLabel('@livestore/adapter-web:worker:PullStream'),
          ),
        PushToLeader: ({ batch }) =>
          Effect.andThen(LeaderThreadCtx, ({ syncProcessor }) =>
            syncProcessor.push(batch.map((event) => new LiveStoreEvent.Client.EncodedWithMeta(event))),
          ).pipe(
            provideLeaderThread,
            Effect.uninterruptible,
            Effect.withSpan('@livestore/adapter-web:worker:PushToLeader'),
          ),
        StreamEvents: (options) =>
          LeaderThreadCtx.pipe(
            Effect.map(({ dbEventlog, syncProcessor }) =>
              streamEventsWithSyncState({
                dbEventlog,
                syncState: syncProcessor.syncState,
                options: options as StreamEventsOptions,
              }),
            ),
            provideLeaderThread,
            Stream.unwrap,
            Stream.withSpan('@livestore/adapter-web:worker:StreamEvents'),
          ),
        Export: () =>
          LeaderThreadCtx.pipe(
            Effect.flatMap((_) => Effect.sync(() => _.dbState.export())),
            provideLeaderThread,
            Effect.withSpan('@livestore/adapter-web:worker:Export'),
          ),
        ExportEventlog: () =>
          LeaderThreadCtx.pipe(
            Effect.flatMap((_) => Effect.sync(() => _.dbEventlog.export())),
            provideLeaderThread,
            Effect.withSpan('@livestore/adapter-web:worker:ExportEventlog'),
          ),
        BootStatusStream: () =>
          LeaderThreadCtx.pipe(
            Effect.map((_) => Stream.fromQueue(_.bootStatusQueue)),
            provideLeaderThread,
            Stream.unwrap,
          ),
        GetLeaderHead: () =>
          Effect.gen(function* () {
            const workerCtx = yield* LeaderThreadCtx
            return Eventlog.getClientHeadFromDb(workerCtx.dbEventlog)
          }).pipe(provideLeaderThread),
        GetLeaderSyncState: () =>
          Effect.gen(function* () {
            const workerCtx = yield* LeaderThreadCtx
            return yield* workerCtx.syncProcessor.syncState
          }).pipe(provideLeaderThread),
        SyncStateStream: () =>
          Effect.gen(function* () {
            const workerCtx = yield* LeaderThreadCtx
            return workerCtx.syncProcessor.syncState.changes
          }).pipe(provideLeaderThread, Stream.unwrap),
        GetNetworkStatus: () =>
          Effect.gen(function* () {
            const workerCtx = yield* LeaderThreadCtx
            return yield* workerCtx.networkStatus
          }).pipe(provideLeaderThread),
        NetworkStatusStream: () =>
          Effect.gen(function* () {
            const workerCtx = yield* LeaderThreadCtx
            return workerCtx.networkStatus.changes
          }).pipe(provideLeaderThread, Stream.unwrap),
        Shutdown: Effect.fn('@livestore/adapter-web:worker:Shutdown')(function* () {
          yield* Effect.logDebug('[@livestore/adapter-web:worker] Shutdown')

          // Buy some time for Otel to flush
          // TODO find a cleaner way to do this
          yield* Effect.sleep(300)
        }),
        ExtraDevtoolsMessage: ({ message }) =>
          Effect.andThen(LeaderThreadCtx, (_) => Queue.offer(_.extraIncomingMessagesQueue, message)).pipe(
            provideLeaderThread,
            Effect.asVoid,
            Effect.withSpan('@livestore/adapter-web:worker:ExtraDevtoolsMessage'),
          ),
        'WebmeshWorker.CreateConnection': (payload) =>
          WebmeshWorker.CreateConnection(payload).pipe(provideLeaderThreadStream),
      })
    }),
  )

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
      boot: Effect.succeed({
        node,
        persistenceInfo: {
          state: dbState.metadata.persistenceInfo,
          eventlog: dbEventlog.metadata.persistenceInfo,
        },
        mode: 'direct' as const,
      }),
    }
  })

/**
 * Attempts to access OPFS and returns a warning if unavailable.
 *
 * Common failure scenarios:
 * - Safari/Firefox private browsing: SecurityError or NotAllowedError
 * - Permission denied: NotAllowedError
 * - Quota exceeded: QuotaExceededError
 */
const checkOpfsAvailability = Effect.gen(function* () {
  const opfs = yield* Opfs.Opfs
  return yield* opfs.getRootDirectoryHandle.pipe(
    Effect.as(undefined),
    Effect.catch((error) => {
      const reason: BootWarningReason =
        Schema.is(WebError.SecurityError)(error) === true || Schema.is(WebError.NotAllowedError)(error) === true
          ? 'private-browsing'
          : 'storage-unavailable'
      const message =
        reason === 'private-browsing'
          ? 'Storage unavailable in private browsing mode. LiveStore will continue without persistence.'
          : 'Storage access denied. LiveStore will continue without persistence.'
      return Effect.succeed({ reason, message } as const)
    }),
  )
})
