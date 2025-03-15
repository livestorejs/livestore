import type { ClientSession, IntentionalShutdownCause, StoreInterrupted, UnexpectedError } from '@livestore/common'
import type { EventId, LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import type { Deferred, MutableHashMap, Runtime, Scope } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { DebugRefreshReasonBase } from '../reactive.js'
import type { StackInfo } from '../utils/stack-info.js'
import type { Store } from './store.js'

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
  disableDevtools?: boolean
  lifetimeScope: Scope.Scope
  runtime: Runtime.Runtime<Scope.Scope>
  confirmUnsavedChanges: boolean
  batchUpdates: (runUpdates: () => void) => void
  // TODO validate whether we still need this
  unsyncedMutationEvents: MutableHashMap.MutableHashMap<EventId.EventId, MutationEvent.ForSchema<TSchema>>
  params: {
    leaderPushBatchSize: number
  }
}

export type RefreshReason =
  | DebugRefreshReasonBase
  | {
      _tag: 'mutate'
      /** The mutations that were applied */
      mutations: ReadonlyArray<MutationEvent.AnyDecoded | MutationEvent.PartialAnyDecoded>

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
  mutationsSpanContext: otel.Context
  queriesSpanContext: otel.Context
}

export type StoreMutateOptions = {
  label?: string
  skipRefresh?: boolean
  spanLinks?: otel.Link[]
  otelContext?: otel.Context
}

export type Unsubscribe = () => void
