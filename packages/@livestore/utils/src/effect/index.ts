// TODO remove again when fixed in `@effect/platform-browser`
import './effect-polyfill.js'
import '../global.js'

export {
  Scope,
  Ref,
  SynchronizedRef,
  Queue,
  Fiber,
  FiberId,
  RuntimeFlags,
  PubSub,
  Exit,
  Cause,
  Runtime,
  Scheduler,
  FiberRef,
  FiberRefs,
  FiberRefsPatch,
  Deferred,
  Metric,
  MetricState,
  Request,
  Tracer,
  Context,
  Data,
  Either,
  Brand,
  Hash,
  Equal,
  Chunk,
  Duration,
  Array as ReadonlyArray,
  Record as ReadonlyRecord,
  SortedMap,
  HashMap,
  HashSet,
  MutableHashSet,
  Option,
  Layer,
  STM,
  TRef,
  Channel,
  pipe,
  identity,
  Match,
} from 'effect'

export * as Stream from './Stream.js'

export * as SubscriptionRef from './SubscriptionRef.js'

export { TreeFormatter, AST as SchemaAST, Pretty as SchemaPretty, Serializable, JSONSchema } from '@effect/schema'
export * as Schema from './Schema.js'
export * as OtelTracer from '@effect/opentelemetry/Tracer'

export { Transferable, FileSystem, Worker, WorkerError, WorkerRunner, Terminal, HttpServer } from '@effect/platform'
export { BrowserWorker, BrowserWorkerRunner } from '@effect/platform-browser'

export * as Effect from './Effect.js'
export * as Schedule from './Schedule.js'
export * from './Error.js'
export * as ServiceContext from './ServiceContext.js'
export * as WebLock from './WebLock.js'
