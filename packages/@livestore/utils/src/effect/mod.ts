import '../global.ts'

import { Effect as Effect_, Layer as Layer_, Option as Option_, Queue as Queue_, Stream as Stream_ } from 'effect'

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
  Worker,
  WorkerError,
  WorkerRunner,
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
}

export namespace Queue {
  export type Queue<A, E = never> = Queue_.Queue<A, E>
  export type Enqueue<A, E = never> = Queue_.Enqueue<A, E>
  export type Dequeue<A, E = never> = Queue_.Dequeue<A, E>
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
