import { Devtools, LogConfig, liveStoreVersion, UnknownError } from '@livestore/common'
import * as DevtoolsWeb from '@livestore/devtools-web-common/web-channel'
import * as WebmeshWorker from '@livestore/devtools-web-common/worker'
import { isDevEnv, isNotUndefined, LS_DEV } from '@livestore/utils'
import {
  Deferred,
  Effect,
  Exit,
  FetchHttpClient,
  identity,
  Layer,
  Ref,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  TaskTracing,
  Worker,
  WorkerRunner,
} from '@livestore/utils/effect'
import { BrowserWorker, BrowserWorkerRunner } from '@livestore/utils/effect/browser'

import { makeShutdownChannel } from '../common/shutdown-channel.ts'
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
        scope: Scope.CloseableScope
      }
    | undefined
  >(undefined)

  const waitForWorker = SubscriptionRef.waitUntil(leaderWorkerContextSubRef, isNotUndefined).pipe(
    Effect.map((_) => _.worker),
  )

  type SharedWorkerRequest = typeof WorkerSchema.SharedWorkerRequest.Type
  type SharedWorkerHandlers = WorkerRunner.SerializedRunner.Handlers<SharedWorkerRequest>

  const decorateForwardedEffect = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    label: string,
  ): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.interruptible,
      Effect.logWarnIfTakesLongerThan({
        label: `@livestore/adapter-web:shared-worker:forwardRequest:${label}`,
        duration: 500,
      }),
      Effect.tapCauseLogPretty,
    )

  const interruptWhenScopeCloses = <A, E, R>(
    stream: Stream.Stream<A, E, R>,
    scope: Scope.CloseableScope,
  ): Effect.Effect<Stream.Stream<A, E, R>> =>
    Effect.gen(function* () {
      // The leader worker scope outlives individual request fibers, so we need to interrupt
      // proxied streams explicitly when that scope shuts down.
      const shutdownDeferred = yield* Deferred.make<void>()
      yield* Scope.addFinalizer(scope, Deferred.succeed(shutdownDeferred, undefined))

      return Stream.interruptWhenDeferred(stream, shutdownDeferred)
    })

  const handleBootStatusStream: SharedWorkerHandlers['BootStatusStream'] = (req) =>
    Stream.unwrapScoped(
      Effect.gen(function* () {
        yield* Effect.logDebug(`forwardRequestStream: ${req._tag}`)
        const { worker, scope } = yield* SubscriptionRef.waitUntil(
          leaderWorkerContextSubRef,
          isNotUndefined,
        )

        return yield* interruptWhenScopeCloses(worker.execute(req), scope)
      }).pipe(Effect.interruptible, Effect.tapCauseLogPretty),
    ).pipe(Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)))

  const handlePushToLeader: SharedWorkerHandlers['PushToLeader'] = (req) =>
    decorateForwardedEffect(
      waitForWorker.pipe(
        // Effect.logBefore(`forwardRequest: ${req._tag}`),
        Effect.andThen((worker) => worker.executeEffect(req)),
        // Effect.tap((_) => Effect.log(`forwardRequest: ${req._tag}`, _)),
        // Effect.tapError((cause) => Effect.logError(`forwardRequest err: ${req._tag}`, cause)),
      ),
      req._tag,
    )

  const handlePullStream: SharedWorkerHandlers['PullStream'] = (req) =>
    Stream.unwrapScoped(
      Effect.gen(function* () {
        yield* Effect.logDebug(`forwardRequestStream: ${req._tag}`)
        const { worker, scope } = yield* SubscriptionRef.waitUntil(
          leaderWorkerContextSubRef,
          isNotUndefined,
        )

        return yield* interruptWhenScopeCloses(worker.execute(req), scope)
      }).pipe(Effect.interruptible, Effect.tapCauseLogPretty),
    ).pipe(Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)))

  const handleStreamEvents: SharedWorkerHandlers['StreamEvents'] = (req) =>
    Stream.unwrapScoped(
      Effect.gen(function* () {
        yield* Effect.logDebug(`forwardRequestStream: ${req._tag}`)
        const { worker, scope } = yield* SubscriptionRef.waitUntil(
          leaderWorkerContextSubRef,
          isNotUndefined,
        )

        return yield* interruptWhenScopeCloses(worker.execute(req), scope)
      }).pipe(Effect.interruptible, Effect.tapCauseLogPretty),
    ).pipe(Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)))

  const handleExport: SharedWorkerHandlers['Export'] = (req) =>
    decorateForwardedEffect(waitForWorker.pipe(Effect.andThen((worker) => worker.executeEffect(req))), req._tag)

  const handleGetRecreateSnapshot: SharedWorkerHandlers['GetRecreateSnapshot'] = (req) =>
    decorateForwardedEffect(waitForWorker.pipe(Effect.andThen((worker) => worker.executeEffect(req))), req._tag)

  const handleExportEventlog: SharedWorkerHandlers['ExportEventlog'] = (req) =>
    decorateForwardedEffect(waitForWorker.pipe(Effect.andThen((worker) => worker.executeEffect(req))), req._tag)

  const handleGetLeaderSyncState: SharedWorkerHandlers['GetLeaderSyncState'] = (req) =>
    decorateForwardedEffect(waitForWorker.pipe(Effect.andThen((worker) => worker.executeEffect(req))), req._tag)

  const handleSyncStateStream: SharedWorkerHandlers['SyncStateStream'] = (req) =>
    Stream.unwrapScoped(
      Effect.gen(function* () {
        yield* Effect.logDebug(`forwardRequestStream: ${req._tag}`)
        const { worker, scope } = yield* SubscriptionRef.waitUntil(
          leaderWorkerContextSubRef,
          isNotUndefined,
        )

        return yield* interruptWhenScopeCloses(worker.execute(req), scope)
      }).pipe(Effect.interruptible, Effect.tapCauseLogPretty),
    ).pipe(Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)))

  const handleGetLeaderHead: SharedWorkerHandlers['GetLeaderHead'] = (req) =>
    decorateForwardedEffect(waitForWorker.pipe(Effect.andThen((worker) => worker.executeEffect(req))), req._tag)

  const handleGetNetworkStatus: SharedWorkerHandlers['GetNetworkStatus'] = (req) =>
    decorateForwardedEffect(waitForWorker.pipe(Effect.andThen((worker) => worker.executeEffect(req))), req._tag)

  const handleNetworkStatusStream: SharedWorkerHandlers['NetworkStatusStream'] = (req) =>
    Stream.unwrapScoped(
      Effect.gen(function* () {
        yield* Effect.logDebug(`forwardRequestStream: ${req._tag}`)
        const { worker, scope } = yield* SubscriptionRef.waitUntil(
          leaderWorkerContextSubRef,
          isNotUndefined,
        )

        return yield* interruptWhenScopeCloses(worker.execute(req), scope)
      }).pipe(Effect.interruptible, Effect.tapCauseLogPretty),
    ).pipe(Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)))

  const handleShutdown: SharedWorkerHandlers['Shutdown'] = (req) =>
    decorateForwardedEffect(waitForWorker.pipe(Effect.andThen((worker) => worker.executeEffect(req))), req._tag)

  const handleExtraDevtoolsMessage: SharedWorkerHandlers['ExtraDevtoolsMessage'] = (req) =>
    decorateForwardedEffect(waitForWorker.pipe(Effect.andThen((worker) => worker.executeEffect(req))), req._tag)

  const resetCurrentWorkerCtx = Effect.gen(function* () {
    const prevWorker = yield* SubscriptionRef.get(leaderWorkerContextSubRef)
    if (prevWorker !== undefined) {
      // NOTE we're already unsetting the current worker here, so new incoming requests are queued for the new worker
      yield* SubscriptionRef.set(leaderWorkerContextSubRef, undefined)

      yield* Effect.yieldNow()

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
  const sameInvariants = Schema.equivalence(InvariantsSchema)

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
            Effect.forkScoped,
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

          yield* DevtoolsWeb.connectViaWorker({
            node,
            worker,
            target: Devtools.makeNodeName.client.leader({ storeId, clientId }),
          }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

          yield* SubscriptionRef.set(leaderWorkerContextSubRef, { worker, scope })
        }).pipe(Effect.tapCauseLogPretty, Scope.extend(scope), Effect.forkIn(scope))
      }).pipe(
        Effect.withSpan('@livestore/adapter-web:shared-worker:updateMessagePort'),
        UnknownError.mapToUnknownError,
        Effect.tapCauseLogPretty,
      ),

    // Proxied requests
    BootStatusStream: handleBootStatusStream,
    PushToLeader: handlePushToLeader,
    PullStream: handlePullStream,
    StreamEvents: handleStreamEvents,
    Export: handleExport,
    GetRecreateSnapshot: handleGetRecreateSnapshot,
    ExportEventlog: handleExportEventlog,
    GetLeaderSyncState: handleGetLeaderSyncState,
    SyncStateStream: handleSyncStateStream,
    GetLeaderHead: handleGetLeaderHead,
    GetNetworkStatus: handleGetNetworkStatus,
    NetworkStatusStream: handleNetworkStatusStream,
    Shutdown: handleShutdown,
    ExtraDevtoolsMessage: handleExtraDevtoolsMessage,

    // Accept devtools connections (from leader and client sessions)
    'DevtoolsWebCommon.CreateConnection': WebmeshWorker.CreateConnection,
  })
}).pipe(Layer.unwrapScoped)

export const makeWorker = (options?: LogConfig.WithLoggerOptions): void => {
  const runtimeLayer = Layer.mergeAll(
    FetchHttpClient.layer,
    WebmeshWorker.CacheService.layer({ nodeName: DevtoolsWeb.makeNodeName.sharedWorker({ storeId }) }),
  )

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- propagated from `makeWorkerRunner`
  const launchWorkerEffect = makeWorkerRunner.pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(runtimeLayer),
  )

  const tracedLaunchWorkerEffect =
    LS_DEV === true
      ? TaskTracing.withAsyncTaggingTracing((name) => Reflect.get(console, 'createTask')(name))(
          launchWorkerEffect,
        )
      : identity(launchWorkerEffect)

  tracedLaunchWorkerEffect.pipe(LogConfig.withLoggerConfig(options, { threadName: self.name }), Effect.runFork)
}

makeWorker()
