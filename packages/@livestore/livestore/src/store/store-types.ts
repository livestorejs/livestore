import type {
  ClientSession,
  ClientSessionSyncProcessorSimulationParams,
  IntentionalShutdownCause,
  StoreInterrupted,
  UnexpectedError,
} from '@livestore/common'
import type { EventSequenceNumber, LiveStoreEvent, LiveStoreSchema } from '@livestore/common/schema'
import type { Effect, Runtime, Scope } from '@livestore/utils/effect'
import { Deferred } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

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
      cause: IntentionalShutdownCause | StoreInterrupted
    }

export type ShutdownDeferred = Deferred.Deferred<void, UnexpectedError | IntentionalShutdownCause | StoreInterrupted>
export const makeShutdownDeferred: Effect.Effect<ShutdownDeferred> = Deferred.make<
  void,
  UnexpectedError | IntentionalShutdownCause | StoreInterrupted
>()

export type LiveStoreContextRunning = {
  stage: 'running'
  store: Store
}

export type OtelOptions = {
  tracer: otel.Tracer
  rootSpanContext: otel.Context
}

export type StoreOptions<TSchema extends LiveStoreSchema = LiveStoreSchema, TContext = {}> = {
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
   * Starting position in the event stream.
   * @default EventSequenceNumber.ROOT (all events from the beginning)
   */
  cursor?: EventSequenceNumber.EventSequenceNumber
  /**
   * Only include events of the given names
   * @default undefined (include all)
   */
  filter?: ReadonlyArray<keyof TSchema['_EventDefMapType']>
  /**
   * Minimum sync level required for events to be included.
   * - 'client': Include all events (including pending in client session)
   * - 'leader': Only include events confirmed by the leader thread
   * - 'backend': Only include events confirmed by the sync backend
   * @default 'client'
   */
  minSyncLevel?: 'client' | 'leader' | 'backend'
  /**
   * Whether to include client-only events
   * @default true
   * @deprecated Use minSyncLevel instead for more granular control
   */
  includeClientOnly?: boolean
  /**
   * Exclude own events that have not been pushed to the sync backend yet
   * @default false
   * @deprecated Use minSyncLevel: 'backend' instead
   */
  excludeUnpushed?: boolean
  /**
   * Only include events created after this timestamp
   * @default undefined (no lower bound)
   */
  since?: Date
  /**
   * Only include events created before this timestamp
   * @default undefined (no upper bound)
   */
  until?: Date
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
  
  // Future filtering ideas (not implemented yet):
  // - parentEventId: Filter by parent event
  // - argPattern: Pattern matching on event arguments
  // - aggregation: Count events by type, time buckets, etc.
  // - eventMetadata: Filter by custom metadata
  // - rebaseGeneration: Filter by rebase generation
}

export type Unsubscribe = () => void
