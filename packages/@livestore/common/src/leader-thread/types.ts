import type {
  Deferred,
  Effect,
  HttpClient,
  Option,
  Queue,
  Scope,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'
import { Context, Schema } from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'

import type { MigrationsReport } from '../defs.ts'
import type { MaterializeError } from '../errors.ts'
import type {
  BootStatus,
  Devtools,
  LeaderAheadError,
  MakeSqliteDb,
  PersistenceInfo,
  SqliteDb,
  SyncBackend,
  UnknownError,
} from '../index.ts'
import { EventSequenceNumber, type LiveStoreEvent, type LiveStoreSchema } from '../schema/mod.ts'
import type * as SyncState from '../sync/syncstate.ts'
import type { ShutdownChannel } from './shutdown-channel.ts'

export type ShutdownState = 'running' | 'shutting-down'

export const InitialSyncOptionsSkip = Schema.TaggedStruct('Skip', {})
export type InitialSyncOptionsSkip = typeof InitialSyncOptionsSkip.Type

export const InitialSyncOptionsBlocking = Schema.TaggedStruct('Blocking', {
  timeout: Schema.Union(Schema.DurationFromMillis, Schema.Number),
})

export type InitialSyncOptionsBlocking = typeof InitialSyncOptionsBlocking.Type

export const InitialSyncOptions = Schema.Union(InitialSyncOptionsSkip, InitialSyncOptionsBlocking)
export type InitialSyncOptions = typeof InitialSyncOptions.Type

export type InitialSyncInfo = Option.Option<{
  eventSequenceNumber: EventSequenceNumber.Global.Type
  metadata: Option.Option<Schema.JsonValue>
}>

// export type InitialSetup =
//   | { _tag: 'Recreate'; snapshotRef: Ref.Ref<Uint8Array | undefined>; syncInfo: InitialSyncInfo }
//   | { _tag: 'Reuse'; syncInfo: InitialSyncInfo }

export type LeaderSqliteDb = SqliteDb<{ dbPointer: number; persistenceInfo: PersistenceInfo }>
export type PersistenceInfoPair = { state: PersistenceInfo; eventlog: PersistenceInfo }

export type DevtoolsOptions =
  | {
      enabled: false
    }
  | {
      enabled: true
      boot: Effect.Effect<
        {
          node: MeshNode
          persistenceInfo: PersistenceInfoPair
          mode: 'proxy' | 'direct'
        },
        UnknownError,
        Scope.Scope | HttpClient.HttpClient | LeaderThreadCtx
      >
    }

export type DevtoolsContext =
  | {
      enabled: true
      // syncBackendPullLatch: Effect.Latch
      // syncBackendPushLatch: Effect.Latch
      syncBackendLatch: Effect.Latch
      syncBackendLatchState: SubscriptionRef.SubscriptionRef<{ latchClosed: boolean }>
    }
  | {
      enabled: false
    }

export class LeaderThreadCtx extends Context.Tag('LeaderThreadCtx')<
  LeaderThreadCtx,
  {
    schema: LiveStoreSchema
    storeId: string
    clientId: string
    makeSqliteDb: MakeSqliteDb
    dbState: LeaderSqliteDb
    dbEventlog: LeaderSqliteDb
    bootStatusQueue: Queue.Queue<BootStatus>
    // TODO we should find a more elegant way to handle cases which need this ref for their implementation
    shutdownStateSubRef: SubscriptionRef.SubscriptionRef<ShutdownState>
    shutdownChannel: ShutdownChannel
    eventSchema: LiveStoreEvent.ForEventDef.ForRecord<any>
    devtools: DevtoolsContext
    syncBackend: SyncBackend.SyncBackend | undefined
    syncProcessor: LeaderSyncProcessor
    materializeEvent: MaterializeEvent
    initialState: {
      leaderHead: EventSequenceNumber.Client.Composite
      migrationsReport: MigrationsReport
    }
    /**
     * e.g. used for `store._dev` APIs
     *
     * This is currently separated from `.devtools` as it also needs to work when devtools are disabled
     */
    extraIncomingMessagesQueue: Queue.Queue<Devtools.Leader.MessageToApp>
    networkStatus: Subscribable.Subscribable<SyncBackend.NetworkStatus>
  }
>() {}

export type MaterializeEvent = (
  eventEncoded: LiveStoreEvent.Client.EncodedWithMeta,
  options?: {
    /** Needed for rematerializeFromEventlog */
    skipEventlog?: boolean
  },
) => Effect.Effect<
  {
    sessionChangeset: { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug: any } | { _tag: 'no-op' }
    hash: Option.Option<number>
  },
  MaterializeError
>

export type InitialBlockingSyncContext = {
  blockingDeferred: Deferred.Deferred<void> | undefined
  update: (_: { pageInfo: SyncBackend.PullResPageInfo; processed: number }) => Effect.Effect<void>
}

export const STREAM_EVENTS_BATCH_SIZE_DEFAULT = 100
export const STREAM_EVENTS_BATCH_SIZE_MAX = 1_000

export const StreamEventsOptionsFields = {
  since: Schema.optional(EventSequenceNumber.Client.Composite),
  until: Schema.optional(EventSequenceNumber.Client.Composite),
  filter: Schema.optional(Schema.Array(Schema.String)),
  clientIds: Schema.optional(Schema.Array(Schema.String)),
  sessionIds: Schema.optional(Schema.Array(Schema.String)),
  batchSize: Schema.optional(Schema.Int.pipe(Schema.between(1, STREAM_EVENTS_BATCH_SIZE_MAX))),
  includeClientOnly: Schema.optional(Schema.Boolean),
} as const

export const StreamEventsOptionsSchema = Schema.Struct(StreamEventsOptionsFields)

export interface StreamEventsOptions {
  /**
   * Only include events after this logical timestamp (exclusive).
   * Defaults to `EventSequenceNumber.Client.ROOT` when omitted.
   */
  since?: EventSequenceNumber.Client.Composite
  /**
   * Only include events up to this logical timestamp (inclusive).
   */
  until?: EventSequenceNumber.Client.Composite
  /**
   * Only include events of the given names.
   */
  filter?: ReadonlyArray<string>
  /**
   * Only include events from specific client identifiers.
   */
  clientIds?: ReadonlyArray<string>
  /**
   * Only include events from specific session identifiers.
   */
  sessionIds?: ReadonlyArray<string>
  /**
   * Number of events to fetch in each batch when streaming from the eventlog.
   * Defaults to 100.
   */
  batchSize?: number
  /**
   * Include client-only events (i.e. events with a positive client sequence number).
   */
  includeClientOnly?: boolean
}

export interface LeaderSyncProcessor {
  /** Used by client sessions to subscribe to upstream sync state changes */
  pull: (args: {
    cursor: EventSequenceNumber.Client.Composite
  }) => Stream.Stream<{ payload: typeof SyncState.PayloadUpstream.Type }, UnknownError>
  /** The `pullQueue` API can be used instead of `pull` when more convenient */
  pullQueue: (args: {
    cursor: EventSequenceNumber.Client.Composite
  }) => Effect.Effect<Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type }>, UnknownError, Scope.Scope>

  /** Used by client sessions to push events to the leader thread */
  push: (
    /** `batch` needs to follow the same rules as `batch` in `SyncBackend.push` */
    batch: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
    options?: {
      /**
       * If true, the effect will only finish when the local push has been processed (i.e. succeeded or was rejected).
       * `true` doesn't mean the events have been pushed to the sync backend.
       * @default false
       */
      waitForProcessing?: boolean
    },
  ) => Effect.Effect<void, LeaderAheadError>

  /** Currently only used by devtools which don't provide their own event numbers */
  pushPartial: (args: {
    event: LiveStoreEvent.Input.Encoded
    clientId: string
    sessionId: string
  }) => Effect.Effect<void, UnknownError>

  boot: Effect.Effect<
    { initialLeaderHead: EventSequenceNumber.Client.Composite },
    UnknownError,
    LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
  >
  syncState: Subscribable.Subscribable<SyncState.SyncState>
}
