import type { LogConfig } from '@livestore/common'
import { Devtools, isWorkerTransportError, liveStoreVersion, UnknownError } from '@livestore/common'
import { isDevEnv, LS_DEV } from '@livestore/utils'
import {
  Deferred,
  Effect,
  Exit,
  FetchHttpClient,
  identity,
  Layer,
  Option,
  Predicate,
  Ref,
  References,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  TaskTracing,
  Worker,
  WorkerRunner,
} from '@livestore/utils/effect'
import { BrowserWorker, BrowserWorkerRunner } from '@livestore/utils/effect/browser'
import * as WebmeshWorker from '@livestore/webmesh/worker'

import { makeShutdownChannel } from '../common/shutdown-channel.ts'
import { makeSharedWorkerNodeName } from '../common/webmesh-node-names.ts'
import * as WorkerSchema from '../common/worker-schema.ts'

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

// @effect-diagnostics-next-line anyUnknownInErrorContext:off -- `SerializedRunner.Handlers` uses `any` in the R channel, propagating as `unknown` in `HandlersContext`
const makeWorkerRunner = Effect.gen(function* () {
  const leaderWorkerContextSubRef = yield* SubscriptionRef.make<
    | {
        worker: Worker.SerializedWorkerPool<WorkerSchema.LeaderWorkerInnerRequest>
        scope: Scope.Closeable
      }
    | undefined
  >(undefined)

  const waitForWorker = SubscriptionRef.waitUntil(leaderWorkerContextSubRef, (c) => Predicate.isNotUndefined(c)).pipe(
    Effect.map((_) => _.worker),
  )

  const forwardRequest = <A, I, E, EI, R>(
    req: WorkerSchema.LeaderWorkerInnerRequest & Schema.WithResult<A, I, E, EI, R>,
  ): Effect.Effect<A, E, R> =>
    // Forward the request to the active worker and convert transport errors to defects.
    waitForWorker.pipe(
      // Effect.logBefore(`forwardRequest: ${req._tag}`),
      Effect.andThen((worker) => worker.executeEffect(req)),
      Effect.catchIf(isWorkerTransportError, (e) => Effect.die(e)),
      // Effect.tap((_) => Effect.log(`forwardRequest: ${req._tag}`, _)),
      // Effect.tapError((cause) => Effect.logError(`forwardRequest err: ${req._tag}`, cause)),
      Effect.interruptible,
      Effect.logWarnIfTakesLongerThan({
        label: `@livestore/adapter-web:shared-worker:forwardRequest:${req._tag}`,
        duration: 500,
      }),
      Effect.tapCauseLogPretty,
    )

  const forwardRequestStream = <A, I, E, EI, R>(
    req: WorkerSchema.LeaderWorkerInnerRequest & Schema.WithResult<A, I, E, EI, R>,
  ): Stream.Stream<A, E, R> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`forwardRequestStream: ${req._tag}`)
      const { worker, scope } = yield* SubscriptionRef.waitUntil(leaderWorkerContextSubRef, isLeaderWorkerContext)
      const stream = worker
        .execute(req)
        .pipe(Stream.refineOrDie((e) => (isWorkerTransportError(e) === true ? Option.none() : Option.some(e))))
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
      Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)),
    )

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
    syncPayloadEncoded: Schema.UndefinedOr(Schema.Json),
    liveStoreVersion: Schema.Literal(liveStoreVersion),
    devtoolsEnabled: Schema.Boolean,
  })
  type Invariants = typeof InvariantsSchema.Type
  const invariantsRef = yield* Ref.make<Invariants | undefined>(undefined)
  const sameInvariants = Schema.toEquivalence(InvariantsSchema)

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- `SerializedRunner.Handlers` uses `any` in the R channel
  return WorkerRunner.layerSerialized(WorkerSchema.SharedWorkerRequest, {
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
            Stream.flatten(),
            Stream.tap(() => reset),
            Stream.runDrain,
            Effect.tapCauseLogPretty,
            // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
            Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
          )

          const workerLayer = yield* Layer.build(BrowserWorker.layer(() => port))

          const worker = yield* Worker.makePoolSerialized<WorkerSchema.LeaderWorkerInnerRequest>({
            size: 1,
            concurrency: 100,
            initialMessage: () => initial,
          }).pipe(
            Effect.provide(workerLayer),
            Effect.withSpan('@livestore/adapter-web:shared-worker:makeWorkerProxyFromPort'),
          )

          // Prepare the web mesh connection for leader worker to be able to connect to the devtools
          const { node } = yield* WebmeshWorker.CacheService
          const { storeId, clientId } = initial

          yield* WebmeshWorker.connectViaWorker({
            node,
            worker,
            target: Devtools.makeNodeName.client.leader({ storeId, clientId }),
          }).pipe(
            Effect.tapCauseLogPretty,
            // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
            Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
          )

          yield* SubscriptionRef.set(leaderWorkerContextSubRef, { worker, scope })
        }).pipe(
          Effect.tapCauseLogPretty,
          Scope.provide(scope),
          // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
          Effect.forkIn(scope, { startImmediately: true, uninterruptible: 'inherit' }),
        )
      }).pipe(Effect.withSpan('@livestore/adapter-web:shared-worker:updateMessagePort'), Effect.tapCauseLogPretty),

    // Proxied requests
    BootStatusStream: forwardRequestStream,
    PushToLeader: forwardRequest,
    PullStream: forwardRequestStream,
    StreamEvents: forwardRequestStream,
    Export: forwardRequest,
    GetRecreateSnapshot: forwardRequest,
    ExportEventlog: forwardRequest,
    Setup: forwardRequest,
    GetLeaderSyncState: forwardRequest,
    SyncStateStream: forwardRequestStream,
    GetLeaderHead: forwardRequest,
    GetNetworkStatus: forwardRequest,
    NetworkStatusStream: forwardRequestStream,
    Shutdown: forwardRequest,
    ExtraDevtoolsMessage: forwardRequest,

    // Accept devtools connections (from leader and client sessions)
    'WebmeshWorker.CreateConnection': WebmeshWorker.CreateConnection,
  })
}).pipe(Layer.unwrap)

export const makeWorker = (options?: LogConfig.LoggerOptions): void => {
  const runtimeLayer = Layer.mergeAll(
    FetchHttpClient.layer,
    WebmeshWorker.CacheService.layer({ nodeName: makeSharedWorkerNodeName({ storeId }) }),
  )

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- propagated from `makeWorkerRunner`
  makeWorkerRunner.pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    // WorkerRunner.launch,
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(runtimeLayer),
    LS_DEV === true ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
    // TODO remove type-cast (currently needed to silence a tsc bug)
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- TSC bug workaround; the cast uses `any` as an intermediate
    (_) => _ as any as Effect.Effect<void>,
    Effect.provide(
      Layer.mergeAll(
        options?.logger ?? Layer.empty,
        Layer.succeed(References.MinimumLogLevel, options?.logLevel ?? (isDevEnv() === true ? 'Debug' : 'Info')),
      ),
    ),
    Effect.runFork,
  )
}

makeWorker()
