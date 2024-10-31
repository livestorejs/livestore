import { IntentionalShutdownCause, UnexpectedError } from '@livestore/common'
import { isNotUndefined } from '@livestore/utils'
import {
  BrowserWorker,
  BrowserWorkerRunner,
  Deferred,
  Duration,
  Effect,
  Exit,
  FetchHttpClient,
  Layer,
  Logger,
  LogLevel,
  Queue,
  Ref,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  Worker,
  WorkerRunner,
} from '@livestore/utils/effect'

import { makeDevtoolsWebBridge } from './shared-worker-devtools-web-bridge.js'
import { makeShutdownChannel } from './shutdown-channel.js'
import * as WorkerSchema from './worker-schema.js'

const makeWorkerRunner = Effect.gen(function* () {
  const dedicatedWorkerContextSubRef = yield* SubscriptionRef.make<
    | {
        worker: Worker.SerializedWorkerPool<WorkerSchema.DedicatedWorkerInner.Request>
        scope: Scope.CloseableScope
      }
    | undefined
  >(undefined)

  const initialMessagePayloadDeferredRef = yield* Deferred.make<
    typeof WorkerSchema.SharedWorker.InitialMessagePayloadFromCoordinator.Type
  >().pipe(Effect.andThen(Ref.make))

  const waitForWorker = SubscriptionRef.waitUntil(dedicatedWorkerContextSubRef, isNotUndefined).pipe(
    Effect.map((_) => _.worker),
  )

  const forwardRequest = <TReq extends WorkerSchema.DedicatedWorkerInner.Request>(
    req: TReq,
  ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer _R>
    ? Effect.Effect<A, UnexpectedError, never>
    : never =>
    waitForWorker.pipe(
      // Effect.logBefore(`forwardRequest: ${req._tag}`),
      Effect.andThen((worker) => worker.executeEffect(req) as Effect.Effect<unknown, unknown, never>),
      // Effect.tap((_) => Effect.log(`forwardRequest: ${req._tag}`, _)),
      // Effect.tapError((cause) => Effect.logError(`forwardRequest err: ${req._tag}`, cause)),
      Effect.logWarnIfTakesLongerThan({
        label: `@livestore/web:shared-worker:forwardRequest:${req._tag}`,
        duration: 500,
      }),
      UnexpectedError.mapToUnexpectedError,
      Effect.tapCauseLogPretty,
    ) as any

  // const forwardRequestStream = <TReq extends WorkerSchema.DedicatedWorkerInner.Request>(
  //   req: TReq,
  // ): TReq extends Serializable.WithResult<infer A, infer _I, infer _E, infer _EI, infer _R>
  //   ? Stream.Stream<A, UnexpectedError, never>
  //   : never =>
  //   waitForWorker.pipe(
  //     Effect.logBefore(`forwardRequestStream: ${req._tag}`),
  //     Effect.andThen((worker) => worker.execute(req) as Stream.Stream<unknown, unknown, never>),
  //     Effect.interruptible,
  //     UnexpectedError.mapToUnexpectedError,
  //     Effect.tapCauseLogPretty,
  //     Stream.unwrap,
  //     Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)),
  //     UnexpectedError.mapToUnexpectedErrorStream,
  //   ) as any

  // TODO bring back the `forwardRequestStream` impl above. Needs debugging with Tim Smart
  // It seems the in-progress streams are not being closed properly if the worker is closed (e.g. by closing the leader tab)
  const forwardRequestStream = <TReq extends WorkerSchema.DedicatedWorkerInner.Request>(
    req: TReq,
  ): TReq extends Schema.WithResult<infer A, infer _I, infer _E, infer _EI, infer _R>
    ? Stream.Stream<A, UnexpectedError, never>
    : never =>
    Effect.gen(function* () {
      const { worker, scope } = yield* SubscriptionRef.waitUntil(dedicatedWorkerContextSubRef, isNotUndefined)
      const queue = yield* Queue.unbounded()

      yield* Scope.addFinalizer(scope, Queue.shutdown(queue))

      const workerStream = worker.execute(req) as Stream.Stream<unknown, unknown, never>

      yield* workerStream.pipe(
        Stream.tap((_) => Queue.offer(queue, _)),
        Stream.runDrain,
        Effect.forkIn(scope),
      )

      return Stream.fromQueue(queue)
    }).pipe(
      UnexpectedError.mapToUnexpectedError,
      Effect.tapCauseLogPretty,
      Stream.unwrap,
      UnexpectedError.mapToUnexpectedErrorStream,
      // Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)),
    ) as any

  const resetCurrentWorkerCtx = Effect.gen(function* () {
    const prevWorker = yield* SubscriptionRef.get(dedicatedWorkerContextSubRef)
    if (prevWorker !== undefined) {
      // NOTE we're already unsetting the current worker here, so new incoming requests are queued for the new worker
      yield* SubscriptionRef.set(dedicatedWorkerContextSubRef, undefined)

      yield* Scope.close(prevWorker.scope, Exit.void).pipe(
        Effect.timeout(Duration.seconds(1)),
        Effect.logWarnIfTakesLongerThan({
          label: '@livestore/web:shared-worker:close-previous-worker',
          duration: 500,
        }),
        // Effect.catchTag('TimeoutException', () => Scope.close(prevWorker.scope, Exit.fail('boom'))),
        Effect.ignoreLogged,
      )
    }
  })

  const devtoolsWebBridge = yield* makeDevtoolsWebBridge

  const reset = Effect.gen(function* () {
    yield* Effect.logDebug('reset')

    const initialMessagePayloadDeferred =
      yield* Deferred.make<typeof WorkerSchema.SharedWorker.InitialMessagePayloadFromCoordinator.Type>()
    yield* Ref.set(initialMessagePayloadDeferredRef, initialMessagePayloadDeferred)

    yield* resetCurrentWorkerCtx
    yield* devtoolsWebBridge.reset
  })

  return WorkerRunner.layerSerialized(WorkerSchema.SharedWorker.Request, {
    InitialMessage: (message) =>
      Effect.gen(function* () {
        if (message.payload._tag === 'FromWebBridge') return

        const initialMessagePayloadDeferred = yield* Ref.get(initialMessagePayloadDeferredRef)
        const deferredAlreadyDone = yield* Deferred.isDone(initialMessagePayloadDeferred)
        const initialMessage = message.payload.initialMessage

        if (deferredAlreadyDone) {
          const previousInitialMessage = yield* Deferred.await(initialMessagePayloadDeferred)
          const messageSchema = WorkerSchema.DedicatedWorkerInner.InitialMessage.pipe(
            Schema.omit('needsRecreate', 'devtoolsEnabled'),
          )
          const isEqual = Schema.equivalence(messageSchema)
          if (isEqual(initialMessage, previousInitialMessage.initialMessage) === false) {
            const diff = Schema.debugDiff(messageSchema)(previousInitialMessage.initialMessage, initialMessage)

            yield* new UnexpectedError({
              cause: 'Initial message already sent and was different now',
              payload: {
                diff,
                previousInitialMessage,
                newInitialMessage: initialMessage,
              },
            })
          }
        } else {
          yield* Deferred.succeed(initialMessagePayloadDeferred, message.payload)
        }
      }),
    UpdateMessagePort: ({ port }) =>
      Effect.gen(function* () {
        const initialMessagePayload = yield* initialMessagePayloadDeferredRef.get.pipe(Effect.andThen(Deferred.await))

        yield* resetCurrentWorkerCtx

        const scope = yield* Scope.make()

        const workerDeferred = yield* Deferred.make<
          Worker.SerializedWorkerPool<WorkerSchema.DedicatedWorkerInner.Request>,
          UnexpectedError
        >()
        // TODO we could also keep the pool instance around to re-use it by removing the previous worker and adding a new one
        yield* Worker.makePoolSerialized<WorkerSchema.DedicatedWorkerInner.Request>({
          size: 1,
          concurrency: 100,
          initialMessage: () => initialMessagePayload.initialMessage,
        }).pipe(
          Effect.tap((worker) => Deferred.succeed(workerDeferred, worker)),
          Effect.provide(BrowserWorker.layer(() => port)),
          Effect.catchAllCause((cause) => new UnexpectedError({ cause })),
          Effect.tapError((cause) => Deferred.fail(workerDeferred, cause)),
          Effect.withSpan('@livestore/web:shared-worker:makeWorkerProxyFromPort'),
          Effect.tapCauseLogPretty,
          Scope.extend(scope),
          Effect.forkIn(scope),
        )

        const shutdownChannel = yield* makeShutdownChannel(initialMessagePayload.initialMessage.storeId)

        yield* shutdownChannel.listen.pipe(
          Stream.flatten(),
          Stream.filter(Schema.is(IntentionalShutdownCause)),
          Stream.tap(() => reset),
          Stream.runDrain,
          Effect.tapCauseLogPretty,
          Effect.forkScoped,
          Scope.extend(scope),
          Effect.forkIn(scope),
        )

        const worker = yield* Deferred.await(workerDeferred)

        yield* SubscriptionRef.set(dedicatedWorkerContextSubRef, { worker, scope })
      }).pipe(
        Effect.withSpan('@livestore/web:shared-worker:updateMessagePort'),
        UnexpectedError.mapToUnexpectedError,
        Effect.tapCauseLogPretty,
      ),

    // Proxied requests
    BootStatusStream: forwardRequestStream,
    ExecuteBulk: forwardRequest,
    Export: forwardRequest,
    GetRecreateSnapshot: forwardRequest,
    ExportMutationlog: forwardRequest,
    Setup: forwardRequest,
    GetCurrentMutationEventId: forwardRequest,
    NetworkStatusStream: forwardRequestStream,
    Shutdown: forwardRequest,
    ConnectDevtoolsStream: forwardRequestStream,

    ...devtoolsWebBridge.handlers,
  })
}).pipe(Layer.unwrapScoped)

export const makeWorker = () => {
  makeWorkerRunner.pipe(
    Layer.provide(BrowserWorkerRunner.layer),
    Layer.launch,
    Effect.scoped,
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: self.name }),
    Effect.provide(Logger.pretty),
    Effect.provide(FetchHttpClient.layer),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runFork,
  )
}

makeWorker()
