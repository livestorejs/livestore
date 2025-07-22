import { Devtools, UnexpectedError } from '@livestore/common'
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
  Logger,
  LogLevel,
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

if (isDevEnv()) {
  globalThis.__debugLiveStoreUtils = {
    blobUrl: (buffer: Uint8Array) => URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })),
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

  const initialMessagePayloadDeferredRef = yield* Deferred.make<
    typeof WorkerSchema.SharedWorkerInitialMessagePayloadFromClientSession.Type
  >().pipe(Effect.andThen(Ref.make))

  const waitForWorker = SubscriptionRef.waitUntil(leaderWorkerContextSubRef, isNotUndefined).pipe(
    Effect.map((_) => _.worker),
  )

  const forwardRequest = <TReq extends WorkerSchema.LeaderWorkerInnerRequest>(
    req: TReq,
  ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer _R>
    ? Effect.Effect<A, UnexpectedError, never>
    : never =>
    waitForWorker.pipe(
      // Effect.logBefore(`forwardRequest: ${req._tag}`),
      Effect.andThen((worker) => worker.executeEffect(req) as Effect.Effect<unknown, unknown, never>),
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
    ) as any

  const forwardRequestStream = <TReq extends WorkerSchema.LeaderWorkerInnerRequest>(
    req: TReq,
  ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer _R>
    ? Stream.Stream<A, UnexpectedError, never>
    : never =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`forwardRequestStream: ${req._tag}`)
      const { worker, scope } = yield* SubscriptionRef.waitUntil(leaderWorkerContextSubRef, isNotUndefined)
      const stream = worker.execute(req) as Stream.Stream<unknown, unknown, never>

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
    ) as any

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

  // const devtoolsWebBridge = yield* makeDevtoolsWebBridge

  const reset = Effect.gen(function* () {
    yield* Effect.logDebug('reset')

    const initialMessagePayloadDeferred =
      yield* Deferred.make<typeof WorkerSchema.SharedWorkerInitialMessagePayloadFromClientSession.Type>()
    yield* Ref.set(initialMessagePayloadDeferredRef, initialMessagePayloadDeferred)

    yield* resetCurrentWorkerCtx
    // yield* devtoolsWebBridge.reset
  })

  return WorkerRunner.layerSerialized(WorkerSchema.SharedWorkerRequest, {
    InitialMessage: (message) =>
      Effect.gen(function* () {
        if (message.payload._tag === 'FromWebBridge') return

        const initialMessagePayloadDeferred = yield* Ref.get(initialMessagePayloadDeferredRef)
        const deferredAlreadyDone = yield* Deferred.isDone(initialMessagePayloadDeferred)
        const initialMessage = message.payload.initialMessage

        if (deferredAlreadyDone) {
          const previousInitialMessage = yield* Deferred.await(initialMessagePayloadDeferred)
          const messageSchema = WorkerSchema.LeaderWorkerInnerInitialMessage.pipe(
            Schema.omit('devtoolsEnabled', 'debugInstanceId'),
          )
          const isEqual = Schema.equivalence(messageSchema)
          if (isEqual(initialMessage, previousInitialMessage.initialMessage) === false) {
            const diff = Schema.debugDiff(messageSchema)(previousInitialMessage.initialMessage, initialMessage)

            yield* new UnexpectedError({
              cause: 'Initial message already sent and was different now',
              payload: {
                diff,
                previousInitialMessage: previousInitialMessage.initialMessage,
                newInitialMessage: initialMessage,
              },
            })
          }
        } else {
          yield* Deferred.succeed(initialMessagePayloadDeferred, message.payload)
        }
      }),
    // Whenever the client session leader changes (and thus creates a new leader thread), the new client session leader
    // sends a new MessagePort to the shared worker which proxies messages to the new leader thread.
    UpdateMessagePort: ({ port }) =>
      Effect.gen(function* () {
        const initialMessagePayload = yield* initialMessagePayloadDeferredRef.get.pipe(Effect.andThen(Deferred.await))

        yield* resetCurrentWorkerCtx

        const scope = yield* Scope.make()

        yield* Effect.gen(function* () {
          const shutdownChannel = yield* makeShutdownChannel(initialMessagePayload.initialMessage.storeId)

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
            initialMessage: () => initialMessagePayload.initialMessage,
          }).pipe(
            Effect.provide(workerLayer),
            Effect.withSpan('@livestore/adapter-web:shared-worker:makeWorkerProxyFromPort'),
          )

          // Prepare the web mesh connection for leader worker to be able to connect to the devtools
          const { node } = yield* WebmeshWorker.CacheService
          const { storeId, clientId } = initialMessagePayload.initialMessage

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
    GetLeaderHead: forwardRequest,
    Shutdown: forwardRequest,
    ExtraDevtoolsMessage: forwardRequest,

    // Accept devtools connections (from leader and client sessions)
    'DevtoolsWebCommon.CreateConnection': WebmeshWorker.CreateConnection,
  })
}).pipe(Layer.unwrapScoped)

export const makeWorker = () => {
  // Extract from `livestore-shared-worker-${storeId}`
  const storeId = self.name.replace('livestore-shared-worker-', '')

  makeWorkerRunner.pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    // WorkerRunner.launch,
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(Logger.prettyWithThread(self.name)),
    Effect.provide(FetchHttpClient.layer),
    Effect.provide(WebmeshWorker.CacheService.layer({ nodeName: DevtoolsWeb.makeNodeName.sharedWorker({ storeId }) })),
    LS_DEV ? TaskTracing.withAsyncTaggingTracing((name) => (console as any).createTask(name)) : identity,
    // TODO remove type-cast (currently needed to silence a tsc bug)
    (_) => _ as any as Effect.Effect<void, any>,
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runFork,
  )
}

makeWorker()
