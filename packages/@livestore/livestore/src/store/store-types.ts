import type { ClientSession, IntentionalShutdownCause, StoreInterrupted, UnexpectedError } from '@livestore/common'
import type { LiveStoreEvent, LiveStoreSchema } from '@livestore/common/schema'
import type { Effect, Runtime, Scope } from '@livestore/utils/effect'
import { Deferred } from '@livestore/utils/effect'
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

export type Unsubscribe = () => void
