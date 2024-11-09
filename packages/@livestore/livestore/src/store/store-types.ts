import type { ClientSession, EventId, IntentionalShutdownCause, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema, MutationEvent } from '@livestore/common/schema'
import type { FiberSet, MutableHashMap, Runtime, Scope } from '@livestore/utils/effect'
import { Schema } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

import type { DebugRefreshReasonBase } from '../reactive.js'
import type { ReactivityGraph } from '../reactiveQueries/base-class.js'
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
  fiberSet: FiberSet.FiberSet
  runtime: Runtime.Runtime<Scope.Scope>
  batchUpdates: (runUpdates: () => void) => void
  unsyncedMutationEvents: MutableHashMap.MutableHashMap<EventId, MutationEvent.ForSchema<TSchema>>
}

export type RefreshReason =
  | DebugRefreshReasonBase
  | {
      _tag: 'mutate'
      /** The mutations that were applied */
      mutations: ReadonlyArray<MutationEvent.Any>

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
  _tag: 'graphql' | 'sql' | 'computed' | 'unknown'
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
  wasSyncMessage?: boolean
  /**
   * When set to `false` the mutation won't be persisted in the mutation log and sync server (but still synced).
   * This can be useful e.g. for fine-granular update events (e.g. position updates during drag & drop)
   *
   * @default true
   */
  persisted?: boolean
}
