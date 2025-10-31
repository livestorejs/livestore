import { Devtools, LogConfig, liveStoreVersion, UnexpectedError } from '@livestore/common'
import * as DevtoolsWeb from '@livestore/devtools-web-common/web-channel'
import * as WebmeshWorker from '@livestore/devtools-web-common/worker'
import { isDevEnv, isNotUndefined, LS_DEV } from '@livestore/utils'
import {
  BrowserWorker,
  BrowserWorkerRunner,
  Deferred,
  Effect,
  Exit,
  FetchHttpClient,
  identity,
  Layer,
  ParseResult,
  Ref,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  TaskTracing,
  Worker,
  WorkerError,
  WorkerRunner,
} from '@livestore/utils/effect'

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

if (isDevEnv()) {
  globalThis.__debugLiveStoreUtils = {
    blobUrl: (buffer: Uint8Array<ArrayBuffer>) =>
      URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })),
    runSync: (effect: Effect.Effect<any, any, never>) => Effect.runSync(effect),
    runFork: (effect: Effect.Effect<any, any, never>) => Effect.runFork(effect),
  }
}

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

  const forwardRequest = <TReq extends WorkerSchema.LeaderWorkerInnerRequest>(
    req: TReq,
  ): Effect.Effect<
    Schema.WithResult.Success<TReq>,
    UnexpectedError | Schema.WithResult.Failure<TReq>,
    Schema.WithResult.Context<TReq>
  > =>
    // Forward the request to the active worker and normalize platform errors into UnexpectedError.
    waitForWorker.pipe(
      // Effect.logBefore(`forwardRequest: ${req._tag}`),
      Effect.andThen((worker) => worker.executeEffect(req) as Effect.Effect<unknown, unknown, unknown>),
      // Effect.tap((_) => Effect.log(`forwardRequest: ${req._tag}`, _)),
      // Effect.tapError((cause) => Effect.logError(`forwardRequest err: ${req._tag}`, cause)),
      Effect.interruptible,
      Effect.logWarnIfTakesLongerThan({
        label: `@livestore/adapter-web:shared-worker:forwardRequest:${req._tag}`,
        duration: 500,
      }),
      Effect.mapError((cause) =>
        Schema.is(UnexpectedError)(cause)
          ? cause
          : ParseResult.isParseError(cause) || Schema.is(WorkerError.WorkerError)(cause)
            ? new UnexpectedError({ cause })
            : cause,
      ),
      Effect.catchAllDefect((cause) => new UnexpectedError({ cause })),
      Effect.tapCauseLogPretty,
    ) as Effect.Effect<
      Schema.WithResult.Success<TReq>,
      UnexpectedError | Schema.WithResult.Failure<TReq>,
      Schema.WithResult.Context<TReq>
    >

  const forwardRequestStream = <TReq extends WorkerSchema.LeaderWorkerInnerRequest>(
    req: TReq,
  ): Stream.Stream<
    Schema.WithResult.Success<TReq>,
    UnexpectedError | Schema.WithResult.Failure<TReq>,
    Schema.WithResult.Context<TReq>
  > =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`forwardRequestStream: ${req._tag}`)
      const { worker, scope } = yield* SubscriptionRef.waitUntil(leaderWorkerContextSubRef, isNotUndefined)
      const stream = worker.execute(req) as Stream.Stream<unknown, unknown, unknown>

      // It seems the request stream is not automatically interrupted when the scope shuts down
      // so we need to manually interrupt it when the scope shuts down
      const shutdownDeferred = yield* Deferred.make<void>()
      yield* Scope.addFinalizer(scope, Deferred.succeed(shutdownDeferred, undefined))

      // Here we're creating an empty stream that will finish when the scope shuts down
      const scopeShutdownStream = Effect.gen(function* () {
        yield* shutdownDeferred
        return Stream.empty
      }).pipe(Stream.unwrap)

      return Stream.merge(stream, scopeShutdownStream, { haltStrategy: 'either' })
    }).pipe(
      Effect.interruptible,
      UnexpectedError.mapToUnexpectedError,
      Effect.tapCauseLogPretty,
      Stream.unwrap,
      Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)),
      UnexpectedError.mapToUnexpectedErrorStream,
    ) as Stream.Stream<
      Schema.WithResult.Success<TReq>,
      UnexpectedError | Schema.WithResult.Failure<TReq>,
      Schema.WithResult.Context<TReq>
    >

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
        if (prev !== undefined && !sameInvariants(prev, invariants)) {
          const diff = Schema.debugDiff(InvariantsSchema)(prev, invariants)
          return yield* new UnexpectedError({
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
        UnexpectedError.mapToUnexpectedError,
        Effect.tapCauseLogPretty,
      ),

    // Proxied requests
    BootStatusStream: forwardRequestStream,
    PushToLeader: forwardRequest,
    PullStream: forwardRequestStream,
    StreamEvents: forwardRequestStream,
    Export: forwardRequest,
    GetRecreateSnapshot: forwardRequest,
    ExportEventlog: forwardRequest,
    GetLeaderSyncState: forwardRequest,
    SyncStateStream: forwardRequestStream,
    GetLeaderHead: forwardRequest,
    GetNetworkStatus: forwardRequest,
    NetworkStatusStream: forwardRequestStream,
    Shutdown: forwardRequest,
    ExtraDevtoolsMessage: forwardRequest,

    // Accept devtools connections (from leader and client sessions)
    'DevtoolsWebCommon.CreateConnection': WebmeshWorker.CreateConnection,
  })
}).pipe(Layer.unwrapScoped)

export const makeWorker = (options?: LogConfig.WithLoggerOptions): void => {
  const runtimeLayer = Layer.mergeAll(
    FetchHttpClient.layer,
    WebmeshWorker.CacheService.layer({ nodeName: DevtoolsWeb.makeNodeName.sharedWorker({ storeId }) }),
  )

  makeWorkerRunner.pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    // WorkerRunner.launch,
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(runtimeLayer),
    LS_DEV ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
    // TODO remove type-cast (currently needed to silence a tsc bug)
    (_) => _ as any as Effect.Effect<void, any>,
    LogConfig.withLoggerConfig(options, { threadName: self.name }),
    Effect.runFork,
  )
}

makeWorker()
