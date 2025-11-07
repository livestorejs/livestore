import {
  type ClientSession,
  type ClientSessionSyncProcessorSimulationParams,
  type IntentionalShutdownCause,
  type InvalidPullError,
  type IsOfflineError,
  isQueryBuilder,
  type MaterializeError,
  type QueryBuilder,
  type StoreInterrupted,
  type SyncError,
  type UnexpectedError,
} from '@livestore/common'
import type { EventSequenceNumber, LiveStoreEvent, LiveStoreSchema } from '@livestore/common/schema'
import type { Effect, Runtime, Scope } from '@livestore/utils/effect'
import { Deferred, Predicate } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { LiveQuery, LiveQueryDef, SignalDef } from '../live-queries/base-class.ts'
import { TypeId } from '../live-queries/base-class.ts'
import type { DebugRefreshReasonBase } from '../reactive.ts'
import type { StackInfo } from '../utils/stack-info.ts'
import type { Store } from './store.ts'

export type LiveStoreContext =
  | LiveStoreContextRunning
  | {
      stage: 'error'
      error: UnexpectedError | unknown
    }
  | {
      stage: 'shutdown'
      cause: IntentionalShutdownCause | StoreInterrupted | SyncError
    }

export type ShutdownDeferred = Deferred.Deferred<
  IntentionalShutdownCause,
  UnexpectedError | SyncError | StoreInterrupted | MaterializeError | InvalidPullError | IsOfflineError
>
export const makeShutdownDeferred: Effect.Effect<ShutdownDeferred> = Deferred.make<
  IntentionalShutdownCause,
  UnexpectedError | SyncError | StoreInterrupted | MaterializeError | InvalidPullError | IsOfflineError
>()

export type LiveStoreContextRunning = {
  stage: 'running'
  store: Store
}

export type OtelOptions = {
  tracer: otel.Tracer
  rootSpanContext: otel.Context
}

export type StoreOptions<TSchema extends LiveStoreSchema = LiveStoreSchema.Any, TContext = {}> = {
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

export type RefreshReason =
  | DebugRefreshReasonBase
  | {
      _tag: 'commit'
      /** The events that were applied */
      events: ReadonlyArray<LiveStoreEvent.AnyDecoded | LiveStoreEvent.PartialAnyDecoded>

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

export type QueryDebugInfo = {
  _tag: string
  label: string
  query: string
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

export type StoreEventsOptions<TSchema extends LiveStoreSchema> = {
  /**
   * Only include events after this logical timestamp (exclusive)
   * @default undefined (no lower bound)
   */
  since?: EventSequenceNumber.EventSequenceNumber
  /**
   * Only include events up to this logical timestamp (inclusive)
   * @default undefined (no upper bound)
   */
  until?: EventSequenceNumber.EventSequenceNumber
  /**
   * Only include events of the given names
   * @default undefined (include all)
   */
  filter?: ReadonlyArray<keyof TSchema['_EventDefMapType']>
  /**
   * Only include events from specific client IDs
   * @default undefined (include all clients)
   */
  clientIds?: ReadonlyArray<string>
  /**
   * Only include events from specific session IDs
   * @default undefined (include all sessions)
   */
  sessionIds?: ReadonlyArray<string>
  /**
   * Number of events to fetch in each batch when streaming from database
   * @default 1000
   */
  eventQueryBatchSize?: number

  // Future filtering ideas (not implemented yet):
  // - syncLevel: Filte by client, leader or backend (requires supporting unconfirmed events)
  // - unconfirmedEvents: Filter by unconfirmed events (requires supporting unconfirmed events)
  // - includeClientOnly: Whether to include client-only events (only relevant when syncLevel supported)
  // - parentEventId: Filter by parent event
  // - argPattern: Pattern matching on event arguments
  // - aggregation: Count events by type, time buckets, etc.
  // - eventMetadata: Filter by custom metadata
  // - rebaseGeneration: Filter by rebase generation
}

export type Unsubscribe = () => void

export type SubscribeOptions<TResult> = {
  onSubscribe?: (query$: LiveQuery<TResult>) => void
  onUnsubsubscribe?: () => void
  label?: string
  skipInitialRun?: boolean
  otelContext?: otel.Context
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

const isLiveQueryDef = (value: unknown): value is LiveQueryDef<any> | SignalDef<any> => {
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

const isLiveQueryInstance = (value: unknown): value is LiveQuery<any> => Predicate.hasProperty(value, TypeId)

export const isQueryable = (value: unknown): value is Queryable<unknown> =>
  isQueryBuilder(value) || isLiveQueryInstance(value) || isLiveQueryDef(value)
