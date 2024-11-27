import type {
  BootStatus,
  Devtools,
  EventId,
  EventIdPair,
  MakeSynchronousDatabase,
  SyncBackend,
  UnexpectedError,
} from '@livestore/common'
import type { LiveStoreSchema, MutationEventSchema } from '@livestore/common/schema'
import type { WebDatabaseInput, WebDatabaseMetadata } from '@livestore/sqlite-wasm/browser'
import type {
  Deferred,
  Effect,
  Fiber,
  FiberSet,
  HttpClient,
  Option,
  Queue,
  Ref,
  Schema,
  Scope,
  SubscriptionRef,
  WebChannel,
} from '@livestore/utils/effect'
import { Context } from '@livestore/utils/effect'

import type { BCMessage } from '../../common/index.js'
import type { PersistedSqlite, PersistenceInfoPair } from '../common/persisted-sqlite.js'

export type DevtoolsContextEnabled = {
  enabled: true
  connect: (options: {
    coordinatorMessagePort: MessagePort
    storeMessagePortDeferred: Deferred.Deferred<MessagePort, UnexpectedError>
    disconnect: Effect.Effect<void>
    storeId: string
    appHostId: string
    isLeader: boolean
    persistenceInfo: PersistenceInfoPair
  }) => Effect.Effect<void, UnexpectedError, LeaderWorkerCtx | Scope.Scope | HttpClient.HttpClient>
  connections: FiberSet.FiberSet
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

export type InitialSyncInfo = Option.Option<{
  cursor: EventId
  metadata: Option.Option<Schema.JsonValue>
}>

export type InitialSetup =
  | { _tag: 'Recreate'; snapshotRef: Ref.Ref<Uint8Array | undefined>; syncInfo: InitialSyncInfo }
  | { _tag: 'Reuse'; syncInfo: InitialSyncInfo }

export class LeaderWorkerCtx extends Context.Tag('LeaderWorkerCtx')<
  LeaderWorkerCtx,
  {
    schema: LiveStoreSchema
    storeId: string
    originId: string
    makeSyncDb: MakeSynchronousDatabase<{ dbPointer: number; fileName: string }>
    mutationSemaphore: Effect.Semaphore
    db: PersistedSqlite
    dbLog: PersistedSqlite
    bootStatusQueue: Queue.Queue<BootStatus>
    initialSetupDeferred: Deferred.Deferred<InitialSetup, UnexpectedError>
    // TODO we should find a more elegant way to handle cases which need this ref for their implementation
    shutdownStateSubRef: SubscriptionRef.SubscriptionRef<ShutdownState>
    mutationEventSchema: MutationEventSchema<any>
    mutationDefSchemaHashMap: Map<string, number>
    currentMutationEventIdRef: { current: EventId }
    nextMutationEventIdPair: (opts: { localOnly: boolean }) => Effect.Effect<EventIdPair>
    broadcastChannel: WebChannel.WebChannel<BCMessage.Message, BCMessage.Message>
    devtools: DevtoolsContext
    syncBackend: SyncBackend | undefined
  }
>() {}
