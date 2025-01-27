import type { ClientSession, IntentionalShutdownCause, UnexpectedError } from '@livestore/common'
import type { EventId, LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import type { Deferred, MutableHashMap, Runtime, Scope } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import type { ReactivityGraph } from '../live-queries/base-class.js'
import type { DebugRefreshReasonBase } from '../reactive.js'
import type { SynchronousDatabaseWrapper } from '../SynchronousDatabaseWrapper.js'
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
      cause: IntentionalShutdownCause | StoreAbort
    }

export class StoreAbort extends Schema.TaggedError<StoreAbort>()('LiveStore.StoreAbort', {}) {}
export class StoreInterrupted extends Schema.TaggedError<StoreInterrupted>()('LiveStore.StoreInterrupted', {}) {}

export type ShutdownDeferred = Deferred.Deferred<
  void,
  UnexpectedError | IntentionalShutdownCause | StoreInterrupted | StoreAbort
>

export type LiveStoreContextRunning = {
  stage: 'running'
  store: Store
}

export type BaseGraphQLContext = {
  queriedTables: Set<string>
  /** Needed by Pothos Otel plugin for resolver tracing to work */
  otelContext?: otel.Context
}

export type GraphQLOptions<TContext> = {
  schema: GraphQLSchema
  makeContext: (db: SynchronousDatabaseWrapper, tracer: otel.Tracer, sessionId: string) => TContext
}

export type OtelOptions = {
  tracer: otel.Tracer
  rootSpanContext: otel.Context
}

export type StoreOptions<
  TGraphQLContext extends BaseGraphQLContext,
  TSchema extends LiveStoreSchema = LiveStoreSchema,
> = {
  clientSession: ClientSession
  schema: TSchema
  storeId: string
  // TODO remove graphql-related stuff from store and move to GraphQL query directly
  graphQLOptions?: GraphQLOptions<TGraphQLContext>
  otelOptions: OtelOptions
  reactivityGraph: ReactivityGraph
  disableDevtools?: boolean
  lifetimeScope: Scope.Scope
  runtime: Runtime.Runtime<Scope.Scope>
  batchUpdates: (runUpdates: () => void) => void
  // TODO validate whether we still need this
  unsyncedMutationEvents: MutableHashMap.MutableHashMap<EventId.EventId, MutationEvent.ForSchema<TSchema>>
}

export type RefreshReason =
  | DebugRefreshReasonBase
  | {
      _tag: 'mutate'
      /** The mutations that were applied */
      mutations: ReadonlyArray<MutationEvent.Any | MutationEvent.PartialAny>

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
  | { _tag: 'manual'; label?: string }

export type QueryDebugInfo = {
  _tag: 'graphql' | 'db' | 'computed' | 'unknown'
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
