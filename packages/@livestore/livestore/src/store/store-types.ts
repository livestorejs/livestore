import {
  type ClientSession,
  type ClientSessionSyncProcessor,
  type ClientSessionSyncProcessorSimulationParams,
  type IntentionalShutdownCause,
  type InvalidPullError,
  type IsOfflineError,
  isQueryBuilder,
  type MaterializeError,
  type QueryBuilder,
  type StoreInterrupted,
  type SyncError,
  type UnknownError,
} from '@livestore/common'
import type { StreamEventsOptions } from '@livestore/common/leader-thread'
import type { LiveStoreEvent, LiveStoreSchema } from '@livestore/common/schema'
import type { Effect, Runtime, Schema, Scope } from '@livestore/utils/effect'
import { Deferred, Predicate } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type {
  LiveQuery,
  LiveQueryDef,
  ReactivityGraph,
  ReactivityGraphContext,
  SignalDef,
} from '../live-queries/base-class.ts'
import { TypeId } from '../live-queries/base-class.ts'
import type { DebugRefreshReasonBase, Ref } from '../reactive.ts'
import type { SqliteDbWrapper } from '../SqliteDbWrapper.ts'
import type { ReferenceCountedSet } from '../utils/data-structures.ts'
import type { StackInfo } from '../utils/stack-info.ts'
import type { Store } from './store.ts'

/**
 * Union type representing the possible states of a LiveStore context.
 *
 * Used by framework integrations (React, Solid, etc.) to track Store lifecycle:
 * - `running`: Store is active and ready for queries/commits
 * - `error`: Store failed during boot or operation
 * - `shutdown`: Store was intentionally shut down or interrupted
 */
export type LiveStoreContext =
  | LiveStoreContextRunning
  | {
      stage: 'error'
      error: UnknownError | unknown
    }
  | {
      stage: 'shutdown'
      cause: IntentionalShutdownCause | StoreInterrupted | SyncError
    }

export type ShutdownDeferred = Deferred.Deferred<
  IntentionalShutdownCause,
  UnknownError | SyncError | StoreInterrupted | MaterializeError | InvalidPullError | IsOfflineError
>
export const makeShutdownDeferred: Effect.Effect<ShutdownDeferred> = Deferred.make<
  IntentionalShutdownCause,
  UnknownError | SyncError | StoreInterrupted | MaterializeError | InvalidPullError | IsOfflineError
>()

/**
 * Context state when the Store is active and ready for use.
 *
 * This is the normal operating state where you can query data, commit events,
 * and subscribe to changes.
 */
export type LiveStoreContextRunning = {
  stage: 'running'
  store: Store
}

export type OtelOptions = {
  tracer: otel.Tracer
  rootSpanContext: otel.Context
}

export const StoreInternalsSymbol = Symbol.for('livestore.StoreInternals')
export type StoreInternalsSymbol = typeof StoreInternalsSymbol

/**
 * Opaque bag containing the Store's implementation details.
 *
 * Not part of the public API — shapes and semantics may change without notice.
 * Access only from within the @livestore/livestore package (and Devtools) via
 * `StoreInternalsSymbol` to avoid accidental coupling in application code.
 */
export type StoreInternals = {
  /**
   * Runtime event schema used for encoding/decoding events.
   *
   * Exposed primarily for Devtools (e.g. databrowser) to validate ad‑hoc
   * event payloads. Application code should not depend on it directly.
   */
  readonly eventSchema: Schema.Schema<LiveStoreEvent.Client.Decoded, LiveStoreEvent.Client.Encoded>

  /**
   * The active client session backing this Store. Provides access to the
   * leader thread, network status, and shutdown signaling.
   *
   * Do not close or mutate directly — use `store.shutdown(...)`.
   */
  readonly clientSession: ClientSession

  /**
   * Wrapper around the local SQLite state database. Centralizes query
   * planning, caching, and change tracking used by reads and materializers.
   */
  readonly sqliteDbWrapper: SqliteDbWrapper

  /**
   * Effect runtime and scope used to fork background fibers for the Store.
   *
   * - `runtime` executes effects from imperative Store APIs.
   * - `lifetimeScope` owns forked fibers; closed during Store shutdown.
   */
  readonly effectContext: {
    /** Effect runtime to run Store effects with proper environment. */
    readonly runtime: Runtime.Runtime<Scope.Scope>
    /** Scope that owns all long‑lived fibers spawned by the Store. */
    readonly lifetimeScope: Scope.Scope
  }

  /**
   * OpenTelemetry primitives used for instrumentation of commits, queries,
   * and Store boot lifecycle.
   */
  readonly otel: StoreOtel

  /**
   * The Store's reactive graph instance used to model dependencies and
   * propagate updates. Provides APIs to create refs/thunks/effects and to
   * subscribe to refresh cycles.
   */
  readonly reactivityGraph: ReactivityGraph

  /**
   * Per‑table reactive refs used to broadcast invalidations when materializers
   * write to tables. Values are always `null`; equality is intentionally
   * `false` to force recomputation.
   *
   * Keys are SQLite table names (user tables; some system tables may be
   * intentionally excluded from refresh).
   */
  readonly tableRefs: Readonly<Record<string, Ref<null, ReactivityGraphContext, RefreshReason>>>

  /**
   * Set of currently subscribed LiveQuery instances (reference‑counted).
   * Used for Devtools and diagnostics.
   */
  readonly activeQueries: ReferenceCountedSet<LiveQuery<any>>

  /**
   * Client‑session sync processor orchestrating push/pull and materialization
   * of events into local state.
   */
  readonly syncProcessor: ClientSessionSyncProcessor

  /**
   * Starts background fibers for sync and observation. Must be run exactly
   * once per Store instance. Scoped; installs finalizers to end spans and
   * detach reactive refs.
   */
  readonly boot: Effect.Effect<void, UnknownError, Scope.Scope>

  /**
   * Tracks whether the Store has been shut down. When true, mutating APIs
   * should reject via `checkShutdown`.
   */
  isShutdown: boolean
}

/**
 * Parameters for constructing a Store instance.
 *
 * @internal This type is used by the Store constructor and is not part of the public API.
 * For creating stores, use `createStore()` or `StoreRegistry` instead.
 */
export type StoreConstructorParams<TSchema extends LiveStoreSchema = LiveStoreSchema.Any, TContext = {}> = {
  clientSession: ClientSession
  schema: TSchema
  storeId: string
  context: TContext
  otelOptions: OtelOptions
  effectContext: {
    runtime: Runtime.Runtime<Scope.Scope>
    lifetimeScope: Scope.Scope
  }
  confirmUnsavedChanges: boolean
  batchUpdates: (runUpdates: () => void) => void
  params: {
    leaderPushBatchSize: number
    eventQueryBatchSize?: number
    simulation?: {
      clientSessionSyncProcessor: typeof ClientSessionSyncProcessorSimulationParams.Type
    }
  }
  __runningInDevtools: boolean
}

/**
 * Tagged union describing why a reactive refresh occurred.
 *
 * Used internally for debugging and devtools to trace the cause of query re-evaluations.
 * Each variant includes context about what triggered the refresh.
 */
export type RefreshReason =
  | DebugRefreshReasonBase
  | {
      _tag: 'commit'
      /** The events that were applied */
      events: ReadonlyArray<LiveStoreEvent.Client.Decoded | LiveStoreEvent.Input.Decoded>

      /** The tables that were written to by the event */
      writeTables: ReadonlyArray<string>
    }
  | {
      // TODO rename to a more appropriate name which is framework-agnostic
      _tag: 'react'
      api: string
      label?: string
      stackInfo?: StackInfo
    }
  | { _tag: 'subscribe.initial'; label?: string }
  | { _tag: 'subscribe.update'; label?: string }
  | { _tag: 'manual'; label?: string }

/**
 * Debug information captured for each query execution.
 *
 * Used by devtools and performance monitoring to track query behavior.
 */
export type QueryDebugInfo = {
  /** Query type discriminator ('db', 'computed', etc.) */
  _tag: string
  /** Human-readable query label */
  label: string
  /** SQL query string or computed function representation */
  query: string
  /** Execution time in milliseconds */
  durationMs: number
}

export type StoreOtel = {
  tracer: otel.Tracer
  rootSpanContext: otel.Context
  commitsSpanContext: otel.Context
  queriesSpanContext: otel.Context
}

export type StoreCommitOptions = {
  label?: string
  skipRefresh?: boolean
  spanLinks?: otel.Link[]
  otelContext?: otel.Context
}

/**
 * filter: Narrowed to the store's event types
 * includeClientOnly: Omitted from public API until supported
 */
export type StoreEventsOptions<TSchema extends LiveStoreSchema> = Omit<
  StreamEventsOptions,
  'filter' | 'includeClientOnly'
> & {
  /**
   * Only include events of the given names.
   * @default undefined (include all)
   */
  filter?: ReadonlyArray<keyof TSchema['_EventDefMapType']>
}

/**
 * Function returned by `store.subscribe()` to stop receiving updates.
 *
 * Call this to unsubscribe from a query and release the associated resources.
 *
 * @example
 * ```ts
 * const unsubscribe = store.subscribe(todos$, (todos) => console.log(todos))
 * // Later...
 * unsubscribe()
 * ```
 */
export type Unsubscribe = () => void

/**
 * Options for `store.subscribe()`.
 *
 * @typeParam TResult - The result type of the subscribed query
 */
export type SubscribeOptions<TResult> = {
  /** Callback invoked when the subscription is established (receives the live query instance) */
  onSubscribe?: (query$: LiveQuery<TResult>) => void
  /** Callback invoked when the subscription is terminated */
  onUnsubsubscribe?: () => void
  /** Label for debugging and devtools */
  label?: string
  /** If true, skips invoking the callback for the initial value */
  skipInitialRun?: boolean
  /** OpenTelemetry context for tracing */
  otelContext?: otel.Context
  /** Stack trace info for debugging subscription origins */
  stackInfo?: StackInfo
}

/** All query definitions or instances the store can execute or subscribe to. */
export type Queryable<TResult> =
  | LiveQueryDef<TResult>
  | SignalDef<TResult>
  | LiveQuery<TResult>
  | QueryBuilder<TResult, any, any>

/**
 * Helper types for `Queryable`.
 *
 * Provides type-level utilities to work with `Queryable` values.
 */
export namespace Queryable {
  /**
   * Extracts the result type from a `Queryable`.
   *
   * Example:
   * - `Queryable.Result<LiveQueryDef<number>>` → `number`
   * - `Queryable.Result<SignalDef<string>>` → `string`
   * - `Queryable.Result<LiveQuery<{ id: string }>>` → `{ id: string }`
   * - `Queryable.Result<LiveQueryDef<A> | SignalDef<B>>` → `A | B`
   */
  export type Result<TQueryable extends Queryable<any>> = TQueryable extends Queryable<infer TResult> ? TResult : never
}

/**
 * Type guard that checks if a value is a query or signal definition.
 *
 * Use this to distinguish between definitions (blueprints) and instances (live queries).
 * Definitions are created by `queryDb()`, `computed()`, and `signal()`.
 *
 * @example
 * ```ts
 * const todos$ = queryDb(tables.todos.all())
 *
 * if (isLiveQueryDef(todos$)) {
 *   console.log('This is a definition:', todos$.label)
 * }
 * ```
 */
export const isLiveQueryDef = (value: unknown): value is LiveQueryDef<any> | SignalDef<any> => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  if (!('_tag' in value)) {
    return false
  }

  const tag = (value as LiveQueryDef<any> | SignalDef<any>)._tag
  if (tag !== 'def' && tag !== 'signal-def') {
    return false
  }

  const candidate = value as LiveQueryDef<any>
  if (typeof candidate.make !== 'function') {
    // The store calls make() to turn the definition into a live query instance.
    return false
  }

  if (typeof candidate.hash !== 'string' || typeof candidate.label !== 'string') {
    // Both identifiers must be present so the store can cache and log the query.
    return false
  }

  return true
}

/**
 * Type guard that checks if a value is a live query instance.
 *
 * Live query instances are stateful objects bound to a Store's reactivity graph.
 * They're created internally when you use a definition with `store.query()` or `store.subscribe()`.
 *
 * @example
 * ```ts
 * const [, , , query$] = useClientDocument(tables.uiState)
 *
 * if (isLiveQueryInstance(query$)) {
 *   console.log('Execution count:', query$.runs)
 * }
 * ```
 */
export const isLiveQueryInstance = (value: unknown): value is LiveQuery<any> => Predicate.hasProperty(value, TypeId)

/**
 * Type guard that checks if a value can be used with `store.query()` or `store.subscribe()`.
 *
 * Queryable values include:
 * - Query definitions (`LiveQueryDef` from `queryDb()`, `computed()`)
 * - Signal definitions (`SignalDef` from `signal()`)
 * - Live query instances (`LiveQuery`)
 * - Query builders (e.g., `tables.todos.where(...)`)
 *
 * @example
 * ```ts
 * const handleQuery = (input: unknown) => {
 *   if (isQueryable(input)) {
 *     return store.query(input)
 *   }
 *   throw new Error('Not a valid query')
 * }
 * ```
 */
export const isQueryable = (value: unknown): value is Queryable<unknown> =>
  isQueryBuilder(value) || isLiveQueryInstance(value) || isLiveQueryDef(value)
