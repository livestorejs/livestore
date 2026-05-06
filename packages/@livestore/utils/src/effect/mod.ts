import '../global.ts'

import {
  Context as Context_,
  Effect as Effect_,
  Layer as Layer_,
  Option as Option_,
  Queue as Queue_,
  Stream as Stream_,
} from 'effect'
import * as Worker_ from 'effect/unstable/workers/Worker'
import * as WorkerRunner_ from 'effect/unstable/workers/WorkerRunner'

// export { DevTools as EffectDevtools } from '@effect/experimental'
export { Sse, Msgpack as MsgPack } from 'effect/unstable/encoding'
export { Otlp } from 'effect/unstable/observability'
export { FileSystem, PlatformError, Terminal } from 'effect'
export {
  FetchHttpClient,
  Headers,
  HttpEffect as HttpApp,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  UrlParams,
} from 'effect/unstable/http'
export {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/unstable/httpapi'
export { KeyValueStore } from 'effect/unstable/persistence'
export { Socket } from 'effect/unstable/socket'
export {
  Transferable,
  WorkerError,
} from 'effect/unstable/workers'
export {
  Rpc,
  // RpcClient, // TODO bring back "original" RpcClient from effect/rpc
  RpcClientError,
  RpcGroup,
  RpcMessage,
  RpcMiddleware,
  RpcSchema,
  RpcSerialization,
  RpcServer,
  RpcTest,
  RpcWorker,
} from 'effect/unstable/rpc'
export {
  AiError,
  LanguageModel,
  LanguageModel as AiLanguageModel,
  McpSchema,
  McpServer,
  Model,
  Model as AiModel,
  Prompt,
  Tool,
  Tool as AiTool,
  Toolkit,
  Toolkit as AiToolkit,
} from 'effect/unstable/ai'
export * as StandardSchema from '@standard-schema/spec'
export {
  Array as ReadonlyArray,
  Brand,
  Cache,
  Cause,
  Channel,
  Chunk,
  Config,
  ConfigProvider,
  Console,
  Context,
  Data,
  Deferred,
  Duration,
  Equal,
  Exit,
  Fiber,
  FiberHandle,
  FiberMap,
  FiberSet,
  Filter,
  Hash,
  HashMap,
  HashSet,
	  Inspectable,
	  identity,
	  Latch,
	  LogLevel,
  ManagedRuntime,
  Match,
  Metric,
  MutableHashMap,
  MutableHashSet,
  Order,
  Predicate,
  PrimaryKey,
  PubSub,
  // Subscribable,
  pipe,
  RcMap,
  RcRef,
  Record as ReadonlyRecord,
  Redacted,
  References,
  Ref,
  Request,
	  Result,
	  Runtime,
	  Semaphore,
	  SchemaGetter,
  Scope,
  SchemaIssue,
  SchemaParser,
  SchemaRepresentation,
  SchemaTransformation,
  ScopedRef,
  Sink,
  Struct,
  SynchronizedRef,
  Tuple,
  Tracer,
  Types,
} from 'effect'
export { ConfigError } from 'effect/Config'
export * as FastCheck from 'effect/testing/FastCheck'
export * as TestClock from 'effect/testing/TestClock'
export type { NonEmptyArray } from 'effect/Array'
export { constVoid, dual } from 'effect/Function'
export * as Graph from 'effect/Graph'
export * as SchemaAST from 'effect/SchemaAST'

export namespace Mailbox {
  export interface Mailbox<A> {
    readonly offer: (value: A) => Effect_.Effect<boolean>
    readonly offerAll: (values: Iterable<A>) => Effect_.Effect<Array<A>>
    readonly shutdown: Effect_.Effect<void>
    readonly queue: Queue_.Queue<A>
  }
}

export const Mailbox = {
  make: <A>(): Effect_.Effect<Mailbox.Mailbox<A>> =>
    Queue_.unbounded<A>().pipe(
      Effect_.map((queue) => ({
        offer: (value) => Queue_.offer(queue, value),
        offerAll: (values) => Queue_.offerAll(queue, values),
        shutdown: Queue_.shutdown(queue),
        queue,
      })),
    ),
  toStream: <A>(mailbox: Mailbox.Mailbox<A>): Stream_.Stream<A> => Stream_.fromQueue(mailbox.queue),
}

export const Layer = {
  ...Layer_,
  unwrapScoped: Layer_.unwrap,
  catchAllCause: Layer_.catchCause,
  fail: <E>(error: E) => Layer_.unwrap(Effect_.fail(error)),
}

export namespace Layer {
  export type Layer<A, E = never, R = never> = Layer_.Layer<A, E, R>
}

export const Queue = {
  ...Queue_,
  awaitShutdown: <_A, _E>(_queue: Queue_.Queue<_A, _E>) => Effect_.never,
}

export namespace Queue {
  export type Queue<A, E = never> = Queue_.Queue<A, E>
  export type Enqueue<A, E = never> = Queue_.Enqueue<A, E>
  export type Dequeue<A, E = never> = Queue_.Dequeue<A, E>
}

type SerializedResponse =
  | { readonly _tag: 'Chunk'; readonly requestId: number; readonly value: unknown }
  | { readonly _tag: 'Done'; readonly requestId: number }
  | { readonly _tag: 'Failure'; readonly requestId: number; readonly error: unknown }

type SerializedRequest =
  | { readonly _tag: 'Request'; readonly requestId: number; readonly request: any }
  | { readonly _tag: 'InitialMessage'; readonly request: any }

type TransferableValue = MessagePort | ArrayBuffer

const collectTransferables = (value: unknown, seen = new Set<object>()): TransferableValue[] => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)

  const transferables: TransferableValue[] = []
  if (
    (typeof MessagePort !== 'undefined' && value instanceof MessagePort) ||
    (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)
  ) {
    transferables.push(value as TransferableValue)
  }

  if (Array.isArray(value)) {
    for (const item of value) transferables.push(...collectTransferables(item, seen))
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) {
      transferables.push(...collectTransferables(item, seen))
    }
  }

  return transferables
}

export const Worker = {
  ...Worker_,
  makePoolSerialized: <_Request>(_options: {
    readonly size?: number
    readonly concurrency?: number
    readonly initialMessage?: () => any
  } = {}) =>
    Effect_.gen(function* () {
      const platform = yield* Worker_.WorkerPlatform
      const worker = yield* platform.spawn<SerializedResponse, SerializedRequest>(0)
      let nextRequestId = 0
      const pending = new Map<number, Queue_.Queue<unknown, unknown>>()

      yield* worker.run((message) =>
        Effect_.sync(() => {
          const queue = pending.get(message.requestId)
          if (queue === undefined) return

          if (message._tag === 'Chunk') {
            Queue_.offerUnsafe(queue, message.value)
          } else if (message._tag === 'Done') {
            pending.delete(message.requestId)
            Queue_.endUnsafe(queue)
          } else {
            pending.delete(message.requestId)
            Queue_.fail(queue, message.error).pipe(Effect_.runFork)
          }
        }),
      ).pipe(Effect_.forkScoped)

      const initialMessage = _options.initialMessage?.()
      if (initialMessage !== undefined) {
        yield* worker.send({ _tag: 'InitialMessage', request: initialMessage }, collectTransferables(initialMessage))
      }

      const execute = <A = any, E = any, R = never>(request: any): Stream_.Stream<A, E, R> =>
        Stream_.callback<any, any>((queue) =>
          Effect_.sync(() => {
            const requestId = nextRequestId++
            pending.set(requestId, queue)
            worker
              .send({ _tag: 'Request', requestId, request }, collectTransferables(request))
              .pipe(Effect_.runFork)
          }),
        ) as any

      const executeEffect = <A = any, E = any, R = never>(request: any): Effect_.Effect<A, E, R> =>
        execute(request).pipe(Stream_.runCollect, Effect_.map((items) => items[0] as A))

      return {
        execute,
        executeEffect,
      }
    }),
  makeSerialized: <Request>(options: { readonly initialMessage?: () => Request } = {}) =>
    Worker.makePoolSerialized<Request>({
      size: 1,
      concurrency: 1,
      ...(options.initialMessage === undefined ? {} : { initialMessage: options.initialMessage }),
    }),
}

export namespace Worker {
  export type SerializedWorkerPool<_Request> = {
    readonly execute: <A = any, E = any, R = never>(request: any) => Stream_.Stream<A, E, R>
    readonly executeEffect: <A = any, E = any, R = never>(request: any) => Effect_.Effect<A, E, R>
  }
}

export const WorkerRunner = {
  ...WorkerRunner_,
  layerSerialized: <_Request>(
    _schema: unknown,
    handlers: Record<string, (request: any) => any>,
  ) =>
    Layer_.effectDiscard(
      Effect_.gen(function* () {
        const platform = yield* WorkerRunner_.WorkerRunnerPlatform
        const runner = yield* platform.start<SerializedResponse, SerializedRequest>()
        let context = yield* Effect_.context<any>()

        yield* runner.run((portId, message) => {
          if (message._tag === 'InitialMessage') {
            const handler = handlers[message.request._tag]
            if (handler === undefined) return
            const result = handler(message.request)
            if (Effect_.isEffect(result)) return result.pipe(Effect_.provide(context), Effect_.asVoid)
            if (Layer_.isLayer(result)) {
              return Layer_.build(result as Layer_.Layer<any, any, any>).pipe(
                Effect_.tap((handlerContext) =>
                  Effect_.sync(() => {
                    context = Context_.merge(context, handlerContext)
                  }),
                ),
                Effect_.provide(context),
                Effect_.asVoid,
              )
            }
            return result.pipe(Stream_.runDrain, Effect_.provide(context))
          }

          const handler = handlers[message.request._tag]
          if (handler === undefined) {
            return runner.send(portId, {
              _tag: 'Failure',
              requestId: message.requestId,
              error: new Error(`No worker handler registered for ${message.request._tag}`),
            })
          }

          const result = handler(message.request)
          const sendFailure = (error: unknown) =>
            runner.send(portId, { _tag: 'Failure', requestId: message.requestId, error })

          if (Stream_.isStream(result)) {
            return result.pipe(
              Stream_.tap((value) =>
                runner.send(portId, { _tag: 'Chunk', requestId: message.requestId, value }, collectTransferables(value)),
              ),
              Stream_.runDrain,
              Effect_.matchCauseEffect({
                onFailure: sendFailure,
                onSuccess: () => runner.send(portId, { _tag: 'Done', requestId: message.requestId }),
              }),
              Effect_.provide(context),
            )
          }

          const effect = result as Effect_.Effect<any, any, any>
          return effect.pipe(
            Effect_.matchCauseEffect({
              onFailure: sendFailure,
              onSuccess: (value) =>
                runner.send(portId, { _tag: 'Chunk', requestId: message.requestId, value }, collectTransferables(value)).pipe(
                  Effect_.andThen(runner.send(portId, { _tag: 'Done', requestId: message.requestId })),
                ),
            }),
            Effect_.provide(context),
          )
        }).pipe(Effect_.forever)
      }),
    ),
  launch: (layer: Layer_.Layer<any, any, any>): Effect_.Effect<never, any, any> => Layer_.launch(layer as any) as any,
}

export namespace WorkerRunner {
  export type PlatformRunner = WorkerRunner_.WorkerRunnerPlatform
}

export const Option = {
  ...Option_,
  fromNullable: Option_.fromNullishOr,
}

export namespace Option {
  export type Option<A> = Option_.Option<A>
  export type Some<A> = Option_.Some<A>
  export type None<A = never> = Option_.None<A>
}

export * as BucketQueue from './BucketQueue.ts'
export * as Debug from './Debug.ts'
export * as Effect from './Effect.ts'
export * from './Error.ts'
export * as Logger from './Logger.ts'
export * as OtelTracer from './OtelTracer.ts'
export * as RpcClient from './RpcClient.ts'
export * as Schedule from './Schedule.ts'
export * as Scheduler from './Scheduler.ts'
export * as Schema from './Schema/index.ts'
export * as ServiceContext from './ServiceContext.ts'
export * as Stream from './Stream.ts'
export * as Subscribable from './Subscribable.ts'
export * as SubscriptionRef from './SubscriptionRef.ts'
export * as TaskTracing from './TaskTracing.ts'
export * as WebChannel from './WebChannel/mod.ts'
export * as WebSocket from './WebSocket.ts'
