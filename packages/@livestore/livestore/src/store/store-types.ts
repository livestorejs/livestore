import {
  type ClientSession,
  type ClientSessionSyncProcessorSimulationParams,
  type IntentionalShutdownCause,
  type InvalidPullError,
  type IsOfflineError,
  type MaterializeError,
  type QueryBuilder,
  isQueryBuilder,
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
   * By default only new events are returned.
   * Use this to get all events from a specific point in time.
   */
  cursor?: EventSequenceNumber.EventSequenceNumber
  /**
   * Only include events of the given names
   * @default undefined (include all)
   */
  filter?: ReadonlyArray<keyof TSchema['_EventDefMapType']>
  /**
   * Whether to include client-only events or only return synced events
   * @default true
   */
  includeClientOnly?: boolean
  /**
   * Exclude own events that have not been pushed to the sync backend yet
   * @default false
   */
  excludeUnpushed?: boolean
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

const isLiveQueryDef = (value: unknown): value is LiveQueryDef<any> | SignalDef<any> => {
  if (typeof value !== 'object' || value === null) {
    // Definitions are always objects; primitives cannot describe queries.
    return false
  }

  if (!('_tag' in value)) {
    // Live query definitions are discriminated unions keyed by `_tag`.
    return false
  }

  const tag = (value as LiveQueryDef<any> | SignalDef<any>)._tag
  if (tag !== 'def' && tag !== 'signal-def') {
    // We only accept the two definition tags that the store knows how to execute.
    return false
  }

  const candidate = value as LiveQueryDef<any>
  if (typeof candidate.make !== 'function') {
    // All definitions expose a `make` factory for creating live query instances.
    return false
  }

  if (typeof candidate.hash !== 'string' || typeof candidate.label !== 'string') {
    // Metadata must be present so we can dedupe subscriptions and surface diagnostics.
    return false
  }

  return true
}

const isLiveQueryInstance = (value: unknown): value is LiveQuery<any> => Predicate.hasProperty(value, TypeId)

export const isQueryable = (value: unknown): value is Queryable<unknown> =>
  isQueryBuilder(value) || isLiveQueryInstance(value) || isLiveQueryDef(value)
