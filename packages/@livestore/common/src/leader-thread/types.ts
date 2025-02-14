import type {
  Deferred,
  Effect,
  HttpClient,
  Option,
  Queue,
  Scope,
  Subscribable,
  SubscriptionRef,
  WebChannel,
} from '@livestore/utils/effect'
import { Context, Schema } from '@livestore/utils/effect'

import type {
  BootStatus,
  Devtools,
  InvalidPushError,
  MakeSqliteDb,
  MigrationsReport,
  PersistenceInfo,
  SqliteDb,
  SyncBackend,
  UnexpectedError,
} from '../index.js'
import type { EventId, LiveStoreSchema, MutationEvent } from '../schema/mod.js'
import type * as SyncState from '../sync/syncstate.js'
import type { ShutdownChannel } from './shutdown-channel.js'

export type ShutdownState = 'running' | 'shutting-down'

export const InitialSyncOptionsSkip = Schema.TaggedStruct('Skip', {})
export type InitialSyncOptionsSkip = typeof InitialSyncOptionsSkip.Type

export const InitialSyncOptionsBlocking = Schema.TaggedStruct('Blocking', {
  timeout: Schema.DurationFromMillis,
})

export type InitialSyncOptionsBlocking = typeof InitialSyncOptionsBlocking.Type

export const InitialSyncOptions = Schema.Union(InitialSyncOptionsSkip, InitialSyncOptionsBlocking)
export type InitialSyncOptions = typeof InitialSyncOptions.Type

export type InitialSyncInfo = Option.Option<{
  cursor: EventId.EventId
  metadata: Option.Option<Schema.JsonValue>
}>

// export type InitialSetup =
//   | { _tag: 'Recreate'; snapshotRef: Ref.Ref<Uint8Array | undefined>; syncInfo: InitialSyncInfo }
//   | { _tag: 'Reuse'; syncInfo: InitialSyncInfo }

export type LeaderSqliteDb = SqliteDb<{ dbPointer: number; persistenceInfo: PersistenceInfo }>
export type PersistenceInfoPair = { readModel: PersistenceInfo; mutationLog: PersistenceInfo }

export type DevtoolsOptions =
  | {
      enabled: false
    }
  | {
      enabled: true
      makeBootContext: Effect.Effect<
        {
          devtoolsWebChannel: WebChannel.WebChannel<Devtools.Leader.MessageToApp, Devtools.Leader.MessageFromApp>
          persistenceInfo: PersistenceInfoPair
        },
        UnexpectedError,
        Scope.Scope
      >
    }

export type DevtoolsContext =
  | {
      enabled: true
      syncBackendPullLatch: Effect.Latch
      syncBackendPushLatch: Effect.Latch
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
    dbReadModel: LeaderSqliteDb
    dbMutationLog: LeaderSqliteDb
    bootStatusQueue: Queue.Queue<BootStatus>
    // TODO we should find a more elegant way to handle cases which need this ref for their implementation
    shutdownStateSubRef: SubscriptionRef.SubscriptionRef<ShutdownState>
    shutdownChannel: ShutdownChannel
    mutationEventSchema: MutationEvent.ForMutationDefRecord<any>
    devtools: DevtoolsContext
    syncBackend: SyncBackend | undefined
    syncProcessor: LeaderSyncProcessor
    connectedClientSessionPullQueues: PullQueueSet
    initialState: {
      leaderHead: EventId.EventId
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

export type InitialBlockingSyncContext = {
  blockingDeferred: Deferred.Deferred<void> | undefined
  update: (_: { remaining: number; processed: number }) => Effect.Effect<void>
}

export type PullQueueItem = {
  payload: SyncState.PayloadUpstream
  remaining: number
}

export interface LeaderSyncProcessor {
  push: (
    /** `batch` needs to follow the same rules as `batch` in `SyncBackend.push` */
    batch: ReadonlyArray<MutationEvent.EncodedWithMeta>,
    options?: {
      /**
       * If true, the effect will only finish when the local push has been processed (i.e. succeeded or was rejected).
       * @default false
       */
      waitForProcessing?: boolean
    },
  ) => Effect.Effect<void, InvalidPushError>

  pushPartial: (mutationEvent: MutationEvent.PartialAnyEncoded) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx>
  boot: (args: {
    dbReady: Deferred.Deferred<void>
  }) => Effect.Effect<
    { initialLeaderHead: EventId.EventId },
    UnexpectedError,
    LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient
  >
  syncState: Subscribable.Subscribable<SyncState.SyncState>
}

export interface PullQueueSet {
  makeQueue: (
    since: EventId.EventId,
  ) => Effect.Effect<Queue.Queue<PullQueueItem>, UnexpectedError, Scope.Scope | LeaderThreadCtx>
  offer: (item: PullQueueItem) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx>
}
