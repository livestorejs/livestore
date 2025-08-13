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
import type { MaterializerHashMismatchError, SqliteError } from '../errors.ts'
import type {
  BootStatus,
  Devtools,
  LeaderAheadError,
  MakeSqliteDb,
  PersistenceInfo,
  SqliteDb,
  SyncBackend,
  UnexpectedError,
} from '../index.ts'
import type { EventSequenceNumber, LiveStoreEvent, LiveStoreSchema } from '../schema/mod.ts'
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
  cursor: EventSequenceNumber.EventSequenceNumber
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
        UnexpectedError,
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
    eventSchema: LiveStoreEvent.ForEventDefRecord<any>
    devtools: DevtoolsContext
    syncBackend: SyncBackend | undefined
    syncProcessor: LeaderSyncProcessor
    materializeEvent: MaterializeEvent
    initialState: {
      leaderHead: EventSequenceNumber.EventSequenceNumber
      migrationsReport: MigrationsReport
    }
    /**
     * e.g. used for `store._dev` APIs
     *
     * This is currently separated from `.devtools` as it also needs to work when devtools are disabled
     */
    extraIncomingMessagesQueue: Queue.Queue<Devtools.Leader.MessageToApp>
  }
>() {}

export type MaterializeEvent = (
  eventEncoded: LiveStoreEvent.EncodedWithMeta,
  options?: {
    /** Needed for rematerializeFromEventlog */
    skipEventlog?: boolean
  },
) => Effect.Effect<
  {
    sessionChangeset: { _tag: 'sessionChangeset'; data: Uint8Array<ArrayBuffer>; debug: any } | { _tag: 'no-op' }
    hash: Option.Option<number>
  },
  SqliteError | MaterializerHashMismatchError
>

export type InitialBlockingSyncContext = {
  blockingDeferred: Deferred.Deferred<void> | undefined
  update: (_: { remaining: number; processed: number }) => Effect.Effect<void>
}

export interface LeaderSyncProcessor {
  /** Used by client sessions to subscribe to upstream sync state changes */
  pull: (args: {
    cursor: EventSequenceNumber.EventSequenceNumber
  }) => Stream.Stream<{ payload: typeof SyncState.PayloadUpstream.Type }, UnexpectedError>
  /** The `pullQueue` API can be used instead of `pull` when more convenient */
  pullQueue: (args: {
    cursor: EventSequenceNumber.EventSequenceNumber
  }) => Effect.Effect<Queue.Queue<{ payload: typeof SyncState.PayloadUpstream.Type }>, UnexpectedError, Scope.Scope>

  /** Used by client sessions to push events to the leader thread */
  push: (
    /** `batch` needs to follow the same rules as `batch` in `SyncBackend.push` */
    batch: ReadonlyArray<LiveStoreEvent.EncodedWithMeta>,
    options?: {
      /**
       * If true, the effect will only finish when the local push has been processed (i.e. succeeded or was rejected).
       * @default false
       */
      waitForProcessing?: boolean
    },
  ) => Effect.Effect<void, LeaderAheadError>

  /** Currently only used by devtools which don't provide their own event numbers */
  pushPartial: (args: {
    event: LiveStoreEvent.PartialAnyEncoded
    clientId: string
    sessionId: string
  }) => Effect.Effect<void, UnexpectedError>

  boot: Effect.Effect<
    { initialLeaderHead: EventSequenceNumber.EventSequenceNumber },
    UnexpectedError,
    LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
  >
  syncState: Subscribable.Subscribable<SyncState.SyncState>
}
