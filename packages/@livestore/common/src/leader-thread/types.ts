import type {
  Effect,
  Fiber,
  FiberSet,
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
  EventId,
  EventIdPair,
  MakeSynchronousDatabase,
  PersistenceInfo,
  SyncBackend,
  SynchronousDatabase,
  UnexpectedError,
} from '../index.js'
import type { LiveStoreSchema, MutationEvent, MutationEventSchema } from '../schema/index.js'
import type { ShutdownChannel } from './shutdown-channel.js'

export type DevtoolsContextEnabled = {
  enabled: true
  /** NOTE it's possible that multiple devtools instances are connected to the same coordinator */
  connect: (options: {
    /**
     * Port for messages between the devtools to the coordinator.
     * Used for the initial connection establishment.
     */
    coordinatorMessagePortOrChannel: // | MessagePort
    WebChannel.WebChannel<Devtools.MessageToAppHostCoordinator, Devtools.MessageFromAppHostCoordinator>
    /** Deferred of port for messages between the devtools and the store */
    // storeMessagePortDeferred: Deferred.Deferred<MessagePort, UnexpectedError>
    /** Allows the devtools connection to interrupt itself */
    disconnect: Effect.Effect<void>
    storeId: string
    appHostId: string
    isLeader: boolean
    persistenceInfo: PersistenceInfoPair
    shutdownChannel: ShutdownChannel
  }) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient>
  connections: FiberSet.FiberSet
  // TODO consider to refactor to use existing syncing mechanism instead of devtools-specific broadcast channel
  broadcast: (
    message: typeof Devtools.NetworkStatusRes.Type | typeof Devtools.MutationBroadcast.Type,
  ) => Effect.Effect<void>
}
export type DevtoolsContext = DevtoolsContextEnabled | { enabled: false }

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
  cursor: EventId
  metadata: Option.Option<Schema.JsonValue>
}>

// export type InitialSetup =
//   | { _tag: 'Recreate'; snapshotRef: Ref.Ref<Uint8Array | undefined>; syncInfo: InitialSyncInfo }
//   | { _tag: 'Reuse'; syncInfo: InitialSyncInfo }

export type LeaderDatabase = SynchronousDatabase<{ dbPointer: number; persistenceInfo: PersistenceInfo }>
export type PersistenceInfoPair = { db: PersistenceInfo; mutationLog: PersistenceInfo }

export class LeaderThreadCtx extends Context.Tag('LeaderThreadCtx')<
  LeaderThreadCtx,
  {
    schema: LiveStoreSchema
    storeId: string
    originId: string
    makeSyncDb: MakeSynchronousDatabase
    mutationSemaphore: Effect.Semaphore
    db: LeaderDatabase
    dbLog: LeaderDatabase
    bootStatusQueue: Queue.Queue<BootStatus>
    // TODO we should find a more elegant way to handle cases which need this ref for their implementation
    shutdownStateSubRef: SubscriptionRef.SubscriptionRef<ShutdownState>
    mutationEventSchema: MutationEventSchema<any>
    mutationDefSchemaHashMap: Map<string, number>
    currentMutationEventIdRef: { current: EventId }
    nextMutationEventIdPair: (opts: { localOnly: boolean }) => EventIdPair
    // broadcastChannel: WebChannel.WebChannel<BCMessage.Message, BCMessage.Message>
    devtools: DevtoolsContext
    syncBackend: SyncBackend | undefined
    // syncPushQueue: Queue.Queue<MutationEvent.AnyEncoded>
    // syncPushQueueSemaphore: Effect.Semaphore
    syncPushQueue: SyncPushQueue
    initialSyncOptions: InitialSyncOptions
    connectedClientSessionPullQueues: Set<Queue.Queue<MutationEvent.AnyEncoded>>
  }
>() {}

export type SyncPushQueue = {
  queue: Queue.Queue<MutationEvent.AnyEncoded>
  semaphore: Effect.Semaphore
  isOpen: Effect.Latch
}
