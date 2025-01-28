import type {
  Deferred,
  Effect,
  Fiber,
  HttpClient,
  Option,
  Queue,
  Scope,
  SubscriptionRef,
  WebChannel,
} from '@livestore/utils/effect'
import { Context, Schema } from '@livestore/utils/effect'

import type {
  BootStatus,
  Devtools,
  InvalidPushError,
  MakeSynchronousDatabase,
  PersistenceInfo,
  SyncBackend,
  SynchronousDatabase,
  UnexpectedError,
} from '../index.js'
import type { EventId, LiveStoreSchema, MutationEvent } from '../schema/mod.js'
import type * as SyncState from '../sync/syncstate.js'
import type { ShutdownChannel } from './shutdown-channel.js'

export type ShutdownState = 'running' | 'shutting-down'

export class OuterWorkerCtx extends Context.Tag('OuterWorkerCtx')<
  OuterWorkerCtx,
  {
    innerFiber: Fiber.RuntimeFiber<any, any>
  }
>() {}

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

export type LeaderDatabase = SynchronousDatabase<{ dbPointer: number; persistenceInfo: PersistenceInfo }>
export type PersistenceInfoPair = { db: PersistenceInfo; mutationLog: PersistenceInfo }

export type DevtoolsOptions =
  | {
      enabled: false
    }
  | {
      enabled: true
      makeContext: Effect.Effect<
        {
          devtoolsWebChannel: WebChannel.WebChannel<Devtools.MessageToAppLeader, Devtools.MessageFromAppLeader>
          persistenceInfo: PersistenceInfoPair
        },
        UnexpectedError,
        Scope.Scope
      >
    }

export class LeaderThreadCtx extends Context.Tag('LeaderThreadCtx')<
  LeaderThreadCtx,
  {
    schema: LiveStoreSchema
    storeId: string
    clientId: string
    makeSyncDb: MakeSynchronousDatabase
    db: LeaderDatabase
    dbLog: LeaderDatabase
    bootStatusQueue: Queue.Queue<BootStatus>
    // TODO we should find a more elegant way to handle cases which need this ref for their implementation
    shutdownStateSubRef: SubscriptionRef.SubscriptionRef<ShutdownState>
    shutdownChannel: ShutdownChannel
    mutationEventSchema: MutationEvent.ForMutationDefRecord<any>
    // devtools: DevtoolsContext
    syncBackend: SyncBackend | undefined
    syncProcessor: SyncProcessor
    connectedClientSessionPullQueues: PullQueueSet
    /** e.g. used for `store.__dev` APIs */
    extraIncomingMessagesQueue: Queue.Queue<Devtools.MessageToAppLeader>
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

export interface SyncProcessor {
  push: (
    /** `batch` needs to follow the same rules as `batch` in `SyncBackend.push` */
    batch: ReadonlyArray<MutationEvent.EncodedWithMeta>,
  ) => Effect.Effect<void, UnexpectedError | InvalidPushError, HttpClient.HttpClient | LeaderThreadCtx>

  pushPartial: (mutationEvent: MutationEvent.PartialAnyEncoded) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx>
  boot: (args: {
    dbReady: Deferred.Deferred<void>
  }) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient>
  syncState: Effect.Effect<SyncState.SyncState, UnexpectedError>
}

export interface PullQueueSet {
  makeQueue: (
    since: EventId.EventId,
  ) => Effect.Effect<Queue.Queue<PullQueueItem>, UnexpectedError, Scope.Scope | LeaderThreadCtx>
  offer: (item: PullQueueItem) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx>
}
