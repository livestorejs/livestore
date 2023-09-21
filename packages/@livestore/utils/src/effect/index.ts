import '../global.js'

// io
export * as Effect from './Effect.js'
export * as Scope from '@effect/io/Scope'
export * as Schedule from './Schedule.js'
export * as Layer from '@effect/io/Layer'
export * as Ref from '@effect/io/Ref'
export * as SynchronizedRef from '@effect/io/SynchronizedRef'
export * as Queue from '@effect/io/Queue'
export * as Fiber from '@effect/io/Fiber'
export * as FiberId from '@effect/io/FiberId'
export * as RuntimeFlags from '@effect/io/RuntimeFlags'
export * as Hub from '@effect/io/Hub'
export * as Exit from '@effect/io/Exit'
export * as Cause from '@effect/io/Cause'
export * as Runtime from '@effect/io/Runtime'
export * as Scheduler from '@effect/io/Scheduler'
export * as FiberRef from '@effect/io/FiberRef'
export * as FiberRefs from '@effect/io/FiberRefs'
export * as FiberRefsPatch from '@effect/io/FiberRefsPatch'
export * as Deferred from '@effect/io/Deferred'
export * as Metric from '@effect/io/Metric'
export * as MetricState from '@effect/io/MetricState'
export * as Request from '@effect/io/Request'

// data
export * as Context from '@effect/data/Context'
export * as Data from '@effect/data/Data'
export { TaggedClass as Tagged } from '@effect/data/Data'
export * as Either from '@effect/data/Either'
export * as Brand from '@effect/data/Brand'
export * as Hash from '@effect/data/Hash'
export * as Equal from '@effect/data/Equal'
export * as Ord from '@effect/data/Order'
export * as Chunk from '@effect/data/Chunk'
export * as Duration from '@effect/data/Duration'
export * as ReadonlyArray from '@effect/data/ReadonlyArray'
export * as ReadonlyRecord from '@effect/data/ReadonlyRecord'
export * as SortedMap from '@effect/data/SortedMap'
export * as HashMap from '@effect/data/HashMap'
export * as HashSet from '@effect/data/HashSet'
export * as MutableHashSet from '@effect/data/MutableHashSet'
export * as Option from '@effect/data/Option'
export { pipe, identity } from '@effect/data/Function'

// stream
export * as Stream from '@effect/stream/Stream'
export * as Channel from '@effect/stream/Channel'
export * as SubscriptionRef from '@effect/stream/SubscriptionRef'

// schema
export * as Schema from '@effect/schema/Schema'

// match
export * as Match from '@effect/match'

// otel
export * as Otel from './Otel/index.js'

// error
export * from './Error.js'

// ServiceContext
export * as ServiceContext from './ServiceContext.js'
