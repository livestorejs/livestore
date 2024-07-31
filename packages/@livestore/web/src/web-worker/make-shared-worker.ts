import { UnexpectedError } from '@livestore/common'
import { isNotUndefined } from '@livestore/utils'
import type { Serializable } from '@livestore/utils/effect'
import {
  BrowserWorker,
  BrowserWorkerRunner,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Logger,
  LogLevel,
  Schema,
  SchemaEquivalence,
  Scope,
  Stream,
  SubscriptionRef,
  Worker,
  WorkerRunner,
} from '@livestore/utils/effect'

import * as WorkerSchema from './schema.js'

const makeWorkerRunner = Effect.gen(function* () {
  const dedicatedWorkerContextSubRef = yield* SubscriptionRef.make<
    | {
        worker: Worker.SerializedWorkerPool<WorkerSchema.DedicatedWorkerInner.Request>
        scope: Scope.CloseableScope
      }
    | undefined
  >(undefined)

  type ChannelId = string
  const devtoolsPortDeferreds = new Map<ChannelId, Deferred.Deferred<MessagePort>>()
  // @ts-expect-error Only for debugging
  globalThis.__debugDevtoolsPortDeferreds = devtoolsPortDeferreds

  const initialMessageDeferred = yield* Deferred.make<WorkerSchema.DedicatedWorkerInner.InitialMessage>()

  const waitForWorker = SubscriptionRef.waitUntil(dedicatedWorkerContextSubRef, isNotUndefined).pipe(
    Effect.map((_) => _.worker),
  )

  const forwardRequest = <TReq extends WorkerSchema.DedicatedWorkerInner.Request>(
    req: TReq,
  ): TReq extends Serializable.WithResult<infer A, infer _I, infer _E, infer _EI, infer _R>
    ? Effect.Effect<A, UnexpectedError, never>
    : never =>
    waitForWorker.pipe(
      Effect.andThen((worker) => worker.executeEffect(req) as Effect.Effect<unknown, unknown, never>),
      Effect.logWarnIfTakesLongerThan({
        label: `@livestore/web:shared-worker:forwardRequest:${req._tag}`,
        duration: 500,
      }),
      UnexpectedError.mapToUnexpectedError,
      Effect.tapCauseLogPretty,
    ) as any

  const forwardRequestStream = <TReq extends WorkerSchema.DedicatedWorkerInner.Request>(
    req: TReq,
  ): TReq extends Serializable.WithResult<infer A, infer _I, infer _E, infer _EI, infer _R>
    ? Stream.Stream<A, UnexpectedError, never>
    : never =>
    SubscriptionRef.waitUntil(dedicatedWorkerContextSubRef, isNotUndefined).pipe(
      Effect.andThen(({ worker }) => worker.execute(req) as Stream.Stream<unknown, unknown, never>),
      UnexpectedError.mapToUnexpectedError,
      Effect.tapCauseLogPretty,
      Stream.unwrap,
      // Stream.ensuring(Effect.logDebug(`shutting down stream for ${req._tag}`)),
      UnexpectedError.mapToUnexpectedErrorStream,
    ) as any

  return WorkerRunner.layerSerialized(WorkerSchema.SharedWorker.Request, {
    InitialMessage: (message) =>
      Effect.gen(function* () {
        if (message.payload._tag === 'FromWebBridge') return

        const deferredAlreadyDone = yield* Deferred.isDone(initialMessageDeferred)
        const initialMessage = message.payload.initialMessage

        if (deferredAlreadyDone) {
          const previousInitialMessage = yield* Deferred.await(initialMessageDeferred)
          const messageSchema = WorkerSchema.DedicatedWorkerInner.InitialMessage.pipe(
            // TODO there can still be a case when recreating from an imported mutation log
            // where the `needsRecreate` will be different and needs to be respected and propagated
            // To support this case we probably need to further refactor the `initialMessageDeferred`
            // into a SubRef to support multiple updates
            // An alternative path could be to fully shutdown the SharedWorker during import (possibly via a special broadcast channel)
            Schema.omit('devtools', 'needsRecreate'),
          )
          const isEqual = SchemaEquivalence.make(messageSchema)
          if (isEqual(initialMessage, previousInitialMessage) === false) {
            const diff = Schema.debugDiff(messageSchema)(previousInitialMessage, initialMessage)

            yield* new UnexpectedError({
              cause: {
                message: 'Initial message already sent and was different now',
                diff,
                previousInitialMessage,
                newInitialMessage: initialMessage,
              },
            })
          }
        } else {
          yield* Deferred.succeed(initialMessageDeferred, initialMessage)
        }
      }),
    UpdateMessagePort: ({ port }) =>
      Effect.gen(function* () {
        const initialMessage = yield* Deferred.await(initialMessageDeferred)

        const prevWorker = yield* SubscriptionRef.get(dedicatedWorkerContextSubRef)
        if (prevWorker !== undefined) {
          // NOTE we're already unsetting the current worker here, so new incoming requests are queued for the new worker
          yield* SubscriptionRef.set(dedicatedWorkerContextSubRef, undefined)

          yield* Scope.close(prevWorker.scope, Exit.void).pipe(
            Effect.timeout(Duration.seconds(1)),
            Effect.ignoreLogged,
            Effect.logWarnIfTakesLongerThan({
              label: '@livestore/web:shared-worker:close-previous-worker',
              duration: 500,
            }),
          )
        }

        const scope = yield* Scope.make()

        const workerDeferred = yield* Deferred.make<
          Worker.SerializedWorkerPool<WorkerSchema.DedicatedWorkerInner.Request>,
          UnexpectedError
        >()
        // TODO we could also keep the pool instance around to re-use it by removing the previous worker and adding a new one
        yield* Worker.makePoolSerialized<WorkerSchema.DedicatedWorkerInner.Request>({
          size: 1,
          concurrency: 100,
          initialMessage: () => initialMessage,
        }).pipe(
          Effect.tap((worker) => Deferred.succeed(workerDeferred, worker)),
          Effect.provide(BrowserWorker.layer(() => port)),
          Effect.catchAllCause((cause) => new UnexpectedError({ cause })),
          Effect.tapError((cause) => Deferred.fail(workerDeferred, cause)),
          Effect.withSpan('@livestore/web:shared-worker:makeWorkerProxyFromPort'),
          Effect.tapCauseLogPretty,
          Effect.forkIn(scope),
        )

        const worker = yield* Deferred.await(workerDeferred)
        yield* SubscriptionRef.set(dedicatedWorkerContextSubRef, { worker, scope })
      }).pipe(
        Effect.withSpan('@livestore/web:shared-worker:updateMessagePort'),
        UnexpectedError.mapToUnexpectedError,
        Effect.tapCauseLogPretty,
      ),

    OfferDevtoolsPort: ({ port, channelId }) =>
      Effect.gen(function* () {
        console.log('OfferDevtoolsPort', channelId)
        const existingDeferred = devtoolsPortDeferreds.get(channelId)
        if (existingDeferred === undefined) {
          const deferred = yield* Deferred.make<MessagePort>()
          yield* Deferred.succeed(deferred, port)
          devtoolsPortDeferreds.set(channelId, deferred)
        } else {
          yield* Deferred.succeed(existingDeferred, port)
        }
      }).pipe(Effect.withSpan('@livestore/web:shared-worker:offerDevtoolsPort'), UnexpectedError.mapToUnexpectedError),

    WaitForDevtoolsPort: ({ channelId }) =>
      Effect.gen(function* () {
        console.log('WaitForDevtoolsPort', channelId)
        if (!devtoolsPortDeferreds.has(channelId)) {
          const deferred = yield* Deferred.make<MessagePort>()
          devtoolsPortDeferreds.set(channelId, deferred)
        }

        const deferred = devtoolsPortDeferreds.get(channelId)!
        const port = yield* Deferred.await(deferred)

        devtoolsPortDeferreds.delete(channelId)

        return { port }
      }).pipe(
        Effect.withSpan('@livestore/web:shared-worker:waitForDevtoolsPort'),
        UnexpectedError.mapToUnexpectedError,
      ),

    // Proxied requests
    BootStatusStream: forwardRequestStream,
    ExecuteBulk: forwardRequest,
    Export: forwardRequest,
    GetRecreateSnapshot: forwardRequest,
    ExportMutationlog: forwardRequest,
    Setup: forwardRequest,
    NetworkStatusStream: forwardRequestStream,
    ListenForReloadStream: forwardRequestStream,
    Shutdown: forwardRequest,
    ConnectDevtools: forwardRequest,
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
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runFork,
  )
}

makeWorker()
