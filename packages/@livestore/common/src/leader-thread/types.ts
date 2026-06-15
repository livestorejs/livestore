import {
  type Deferred,
  type Effect,
  type HttpClient,
  type Latch,
  type Option,
  type Queue,
  type Scope,
  type Stream,
  type Subscribable,
  type SubscriptionRef,
  Context,
  Schema,
} from '@livestore/utils/effect'
import type { MeshNode } from '@livestore/webmesh'

import type { MigrationsReport } from '../defs.ts'
import type { MaterializeError } from '../errors.ts'
import type {
  BootStatus,
  Devtools,
  MakeSqliteDb,
  PersistenceInfo,
  SqliteDb,
  SyncBackend,
  UnknownError,
} from '../index.ts'
import { EventSequenceNumber, type LiveStoreEvent, type LiveStoreSchema } from '../schema/mod.ts'
import type * as SyncState from '../sync/syncstate.ts'
import type * as LeaderSyncProcessor from './LeaderSyncProcessor.ts'
import type { ShutdownChannel } from './shutdown-channel.ts'

export type ShutdownState = 'running' | 'shutting-down'

export const InitialSyncOptionsSkip = Schema.TaggedStruct('Skip', {})
export type InitialSyncOptionsSkip = typeof InitialSyncOptionsSkip.Type

export const InitialSyncOptionsBlocking = Schema.TaggedStruct('Blocking', {
  timeout: Schema.Union([Schema.DurationFromMillis, Schema.Number]),
})

export type InitialSyncOptionsBlocking = typeof InitialSyncOptionsBlocking.Type

export const InitialSyncOptions = Schema.Union([InitialSyncOptionsSkip, InitialSyncOptionsBlocking])
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
      // syncBackendPullLatch: Latch.Latch
      // syncBackendPushLatch: Latch.Latch
      syncBackendLatch: Latch.Latch
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
    syncProcessor: LeaderSyncProcessor.Service
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
  batchSize: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: STREAM_EVENTS_BATCH_SIZE_MAX }))),
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
