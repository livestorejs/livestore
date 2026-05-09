import { Devtools, isWorkerTransportError, LogConfig, liveStoreVersion, UnknownError } from '@livestore/common'
import * as DevtoolsWeb from '@livestore/devtools-web-common/web-channel'
import * as WebmeshWorker from '@livestore/devtools-web-common/worker'
import { isDevEnv, isNotUndefined, LS_DEV } from '@livestore/utils'
import {
  Deferred,
  Effect,
  EffectRpcClient,
  Exit,
  FetchHttpClient,
  identity,
  Layer,
  Option,
  Ref,
  RpcClientError,
  RpcServer,
  RpcWorker,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  TaskTracing,
} from '@livestore/utils/effect'
import { BrowserWorker, BrowserWorkerRunner } from '@livestore/utils/effect/browser'

import { makeShutdownChannel } from '../common/shutdown-channel.ts'
import * as WorkerSchema from '../common/worker-schema.ts'

type LeaderWorkerClient = EffectRpcClient.FromGroup<
  typeof WorkerSchema.LeaderWorkerInnerRpcs,
  RpcClientError.RpcClientError
>

// Extract from `livestore-shared-worker-${storeId}`
const storeId = self.name.replace('livestore-shared-worker-', '')

// We acquire a lock that is held as long as this shared worker is alive.
// This way, when the shared worker is terminated (e.g. by the browser when the page is closed),
// the lock is released and any thread waiting for the lock can be notified.
const LIVESTORE_SHARED_WORKER_TERMINATION_LOCK = `livestore-shared-worker-termination-lock-${storeId}`
navigator.locks.request(
  LIVESTORE_SHARED_WORKER_TERMINATION_LOCK,
  { steal: true },
  // We use a never-resolving promise to hold the lock
  async () => new Promise(() => {}),
)

if (isDevEnv() === true) {
  globalThis.__debugLiveStoreUtils = {
    blobUrl: (buffer: Uint8Array<ArrayBuffer>) =>
      URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })),
    runSync: <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect),
    runFork: <A, E>(effect: Effect.Effect<A, E>) => Effect.runFork(effect),
  }
}

const makeWorkerRunner = Effect.gen(function* () {
  const leaderWorkerContextSubRef = yield* SubscriptionRef.make<
    | {
        worker: LeaderWorkerClient
        scope: Scope.Closeable
      }
    | undefined
  >(undefined)

  const waitForWorker = SubscriptionRef.waitUntil(leaderWorkerContextSubRef, isNotUndefined).pipe(
    Effect.map((_) => _),
  )

  const forwardRequest = <A, E, R>(
    tag: string,
    run: (worker: LeaderWorkerClient) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, never, never> =>
    // Forward the request to the active worker and convert transport errors to defects.
    waitForWorker.pipe(
      Effect.andThen(({ worker }) => run(worker)),
      Effect.catchIf(isWorkerTransportError, (e) => Effect.die(e)),
      Effect.interruptible,
      Effect.logWarnIfTakesLongerThan({
        label: `@livestore/adapter-web:shared-worker:forwardRequest:${tag}`,
        duration: 500,
      }),
      Effect.tapCauseLogPretty,
    ) as Effect.Effect<A, never, never>

  const forwardRequestStream = <A, E, R>(
    tag: string,
    run: (worker: LeaderWorkerClient) => Stream.Stream<A, E, R>,
  ): Stream.Stream<A, never, never> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`forwardRequestStream: ${tag}`)
      const { worker, scope } = yield* SubscriptionRef.waitUntil(leaderWorkerContextSubRef, isNotUndefined)
      const stream = run(worker).pipe(Stream.catchIf(isWorkerTransportError, (e) => Stream.die(e)))
      // It seems the request stream is not automatically interrupted when the scope shuts down
      // so we need to manually interrupt it when the scope shuts down
      const shutdownDeferred = yield* Deferred.make<void>()
      yield* Scope.addFinalizer(scope, Deferred.succeed(shutdownDeferred, undefined))

      // Here we're creating an empty stream that will finish when the scope shuts down
      const scopeShutdownStream = Effect.gen(function* () {
        yield* Deferred.await(shutdownDeferred)
        return Stream.empty
      }).pipe(Stream.unwrap)

      return Stream.merge(stream, scopeShutdownStream, { haltStrategy: 'either' })
    }).pipe(
      Effect.interruptible,
      Effect.tapCauseLogPretty,
      Stream.unwrap,
      Stream.ensuring(Effect.logDebug(`shutting down stream for ${tag}`)),
    ) as Stream.Stream<A, never, never>

  const resetCurrentWorkerCtx = Effect.gen(function* () {
    const prevWorker = yield* SubscriptionRef.get(leaderWorkerContextSubRef)
    if (prevWorker !== undefined) {
      // NOTE we're already unsetting the current worker here, so new incoming requests are queued for the new worker
      yield* SubscriptionRef.set(leaderWorkerContextSubRef, undefined)

      yield* Effect.yieldNow

      yield* Scope.close(prevWorker.scope, Exit.void).pipe(
        Effect.logWarnIfTakesLongerThan({
          label: '@livestore/adapter-web:shared-worker:close-previous-worker',
          duration: 500,
        }),
      )
    }
  }).pipe(Effect.withSpan('@livestore/adapter-web:shared-worker:resetCurrentWorkerCtx'))

  const reset = Effect.gen(function* () {
    yield* Effect.logDebug('reset')
    // Clear cached invariants so a fresh configuration can be accepted after shutdown
    yield* Ref.set(invariantsRef, undefined)
    // Tear down current leader worker context
    yield* resetCurrentWorkerCtx
  })

  // Cache first-applied invariants to enforce stability across leader transitions
  const InvariantsSchema = Schema.Struct({
    storeId: Schema.String,
    storageOptions: WorkerSchema.StorageType,
    syncPayloadEncoded: Schema.UndefinedOr(Schema.JsonValue),
    liveStoreVersion: Schema.Literal(liveStoreVersion),
    devtoolsEnabled: Schema.Boolean,
  })
  type Invariants = typeof InvariantsSchema.Type
  const invariantsRef = yield* Ref.make<Invariants | undefined>(undefined)
  const sameInvariants = Schema.toEquivalence(InvariantsSchema)

  return WorkerSchema.SharedWorkerRpcs.toLayer({
    // Whenever the client session leader changes (and thus creates a new leader thread), the new client session leader
    // sends a new MessagePort to the shared worker which proxies messages to the new leader thread.
    UpdateMessagePort: ({ port, initial, liveStoreVersion: clientLiveStoreVersion }) =>
      Effect.gen(function* () {
        // Enforce invariants: storeId, storageOptions, syncPayloadEncoded, liveStoreVersion must remain stable
        const invariants: Invariants = {
          storeId: initial.storeId,
          storageOptions: initial.storageOptions,
          syncPayloadEncoded: initial.syncPayloadEncoded,
          liveStoreVersion: clientLiveStoreVersion,
          devtoolsEnabled: initial.devtoolsEnabled,
        }
        const prev = yield* Ref.get(invariantsRef)
        // Early return on mismatch to keep happy path linear
        if (prev !== undefined && sameInvariants(prev, invariants) === false) {
          const diff = Schema.debugDiff(InvariantsSchema)(prev, invariants)
          return yield* new UnknownError({
            cause: 'Store invariants changed across leader transitions',
            payload: { diff, previous: prev, next: invariants },
          })
        }
        // First writer records invariants
        if (prev === undefined) {
          yield* Ref.set(invariantsRef, invariants)
        }

        yield* resetCurrentWorkerCtx

        const scope = yield* Scope.make()

        yield* Effect.gen(function* () {
          const shutdownChannel = yield* makeShutdownChannel(initial.storeId)

          yield* shutdownChannel.listen.pipe(
            Stream.mapEffect(Effect.fromResult),
            Stream.tap(() => reset),
            Stream.runDrain,
            Effect.tapCauseLogPretty,
            Effect.forkScoped,
          )

          const workerLayer = EffectRpcClient.layerProtocolWorker({ size: 1, concurrency: 100 }).pipe(
            Layer.provide(
              RpcWorker.layerInitialMessage(WorkerSchema.LeaderWorkerInnerInitialMessage, Effect.succeed(initial)),
            ),
            Layer.provide(BrowserWorker.layer(() => port as unknown as globalThis.Worker)),
          )
          const protocolContext = yield* Layer.buildWithScope(workerLayer, scope)
          const worker = yield* EffectRpcClient.make(WorkerSchema.LeaderWorkerInnerRpcs).pipe(
            Effect.provide(protocolContext),
            Effect.withSpan('@livestore/adapter-web:shared-worker:makeWorkerProxyFromPort'),
          )

          // Prepare the web mesh connection for leader worker to be able to connect to the devtools
          const { node } = yield* WebmeshWorker.CacheService
          const { storeId, clientId } = initial

          yield* DevtoolsWeb.connectViaWorker({
            node,
            worker,
            target: Devtools.makeNodeName.client.leader({ storeId, clientId }),
          }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

          yield* SubscriptionRef.set(leaderWorkerContextSubRef, { worker, scope })
        }).pipe(Effect.tapCauseLogPretty, Scope.provide(scope), Effect.forkIn(scope))
      }).pipe(
        Effect.withSpan('@livestore/adapter-web:shared-worker:updateMessagePort'),
        Effect.tapCauseLogPretty,
      ),

    // Proxied requests
    BootStatusStream: () => forwardRequestStream('BootStatusStream', (worker) => worker.BootStatusStream(undefined)),
    PushToLeader: (payload) => forwardRequest('PushToLeader', (worker) => worker.PushToLeader(payload)),
    PullStream: (payload) => forwardRequestStream('PullStream', (worker) => worker.PullStream(payload)),
    StreamEvents: (payload) => forwardRequestStream('StreamEvents', (worker) => worker.StreamEvents(payload)),
    Export: () => forwardRequest('Export', (worker) => worker.Export(undefined)),
    GetRecreateSnapshot: () => forwardRequest('GetRecreateSnapshot', (worker) => worker.GetRecreateSnapshot(undefined)),
    ExportEventlog: () => forwardRequest('ExportEventlog', (worker) => worker.ExportEventlog(undefined)),
    GetLeaderSyncState: () => forwardRequest('GetLeaderSyncState', (worker) => worker.GetLeaderSyncState(undefined)),
    SyncStateStream: () => forwardRequestStream('SyncStateStream', (worker) => worker.SyncStateStream(undefined)),
    GetLeaderHead: () => forwardRequest('GetLeaderHead', (worker) => worker.GetLeaderHead(undefined)),
    GetNetworkStatus: () => forwardRequest('GetNetworkStatus', (worker) => worker.GetNetworkStatus(undefined)),
    NetworkStatusStream: () =>
      forwardRequestStream('NetworkStatusStream', (worker) => worker.NetworkStatusStream(undefined)),
    Shutdown: () => forwardRequest('Shutdown', (worker) => worker.Shutdown(undefined)),
    ExtraDevtoolsMessage: (payload) =>
      forwardRequest('ExtraDevtoolsMessage', (worker) => worker.ExtraDevtoolsMessage(payload)),

    // Accept devtools connections (from leader and client sessions)
    CreateConnection: WebmeshWorker.CreateConnection,
  })
}).pipe(Layer.unwrapScoped, Layer.provideMerge(RpcServer.layerProtocolWorkerRunner))

export const makeWorker = (options?: LogConfig.WithLoggerOptions): void => {
  const runtimeLayer = Layer.mergeAll(
    FetchHttpClient.layer,
    WebmeshWorker.CacheService.layer({ nodeName: DevtoolsWeb.makeNodeName.sharedWorker({ storeId }) }),
  )

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- propagated from `makeWorkerRunner`
  RpcServer.make(WorkerSchema.SharedWorkerRpcs).pipe(
    Effect.provide(makeWorkerRunner.pipe(Layer.provide(BrowserWorkerRunner.layer))),
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(runtimeLayer),
    LS_DEV === true ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
    // TODO remove type-cast (currently needed to silence a tsc bug)
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- TSC bug workaround; the cast uses `any` as an intermediate
    (_) => _ as any as Effect.Effect<void>,
    LogConfig.withLoggerConfig(options, { threadName: self.name }),
    Effect.runFork,
  )
}

makeWorker()
