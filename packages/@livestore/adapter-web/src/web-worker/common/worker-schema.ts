import {
  BootStatus,
  Devtools,
  RejectedPushError,
  liveStoreVersion,
  MigrationsReport,
  SyncBackend,
  SyncState,
  UnknownError,
} from '@livestore/common'
import { StreamEventsOptionsFields } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Rpc, RpcGroup, Schema, Transferable } from '@livestore/utils/effect'
import * as WebmeshWorker from '@livestore/webmesh/worker'

export const StorageTypeOpfs = Schema.Struct({
  type: Schema.Literal('opfs'),
  /**
   * Default is `livestore-${storeId}`
   *
   * When providing this option, make sure to include the `storeId` in the path to avoid
   * conflicts with other LiveStore apps.
   */
  directory: Schema.optional(Schema.String),
})

export type StorageTypeOpfs = typeof StorageTypeOpfs.Type

// export const StorageTypeIndexeddb = Schema.Struct({
//   type: Schema.Literal('indexeddb'),
//   /** @default "livestore" */
//   databaseName: Schema.String.pipe(Schema.withDecodingDefaultType(Effect.succeed('livestore'))),
//   /** @default "livestore-" */
//   storeNamePrefix: Schema.String.pipe(Schema.withDecodingDefaultType(Effect.succeed('livestore-'))),
// })

export const StorageType = Schema.Union([
  StorageTypeOpfs,
  // StorageTypeIndexeddb
])
export type StorageType = typeof StorageType.Type
export type StorageTypeEncoded = typeof StorageType.Encoded

// export const SyncBackendOptions = Schema.Union([SyncBackendOptionsWebsocket])
export const SyncBackendOptions = Schema.Record(Schema.String, Schema.JsonValue)
export type SyncBackendOptions = Record<string, Schema.JsonValue>

export class LeaderWorkerOuterInitialMessage extends Schema.Class<LeaderWorkerOuterInitialMessage>('InitialMessage')({
  port: Transferable.MessagePort,
  storeId: Schema.String,
  clientId: Schema.String,
}) {}

export const LeaderWorkerOuterRequest = Schema.Union([LeaderWorkerOuterInitialMessage])
export type LeaderWorkerOuterRequest = typeof LeaderWorkerOuterRequest.Type

export const LeaderWorkerOuterReady = Rpc.make('Ready', {
  success: Schema.Void,
})

export const LeaderWorkerOuterRpcs = RpcGroup.make(LeaderWorkerOuterReady)

// TODO unify this code with schema from node adapter
export class LeaderWorkerInnerInitialMessage extends Schema.Class<LeaderWorkerInnerInitialMessage>('InitialMessage')({
  storageOptions: StorageType,
  devtoolsEnabled: Schema.Boolean,
  storeId: Schema.String,
  clientId: Schema.String,
  debugInstanceId: Schema.String,
  syncPayloadEncoded: Schema.UndefinedOr(Schema.JsonValue),
}) {}

export const LeaderWorkerInnerBootStatusStream = Rpc.make('BootStatusStream', {
  success: BootStatus,
  stream: true,
})

export const LeaderWorkerInnerPushToLeader = Rpc.make('PushToLeader', {
  payload: {
    batch: Schema.Array(Schema.toType(LiveStoreEvent.Client.Encoded)),
  },
  success: Schema.Void as Schema.Schema<void>,
  error: RejectedPushError,
})

export const LeaderWorkerInnerPullStream = Rpc.make('PullStream', {
  payload: {
    cursor: Schema.toType(EventSequenceNumber.Client.Composite),
  },
  success: Schema.Struct({
    payload: SyncState.PayloadUpstream,
  }),
  stream: true,
})

export const LeaderWorkerInnerStreamEvents = Rpc.make('StreamEvents', {
  payload: StreamEventsOptionsFields,
  success: LiveStoreEvent.Client.Encoded,
  stream: true,
})

export const LeaderWorkerInnerExport = Rpc.make('Export', {
  success: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
})

export const LeaderWorkerInnerExportEventlog = Rpc.make('ExportEventlog', {
  success: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
})

export const LeaderWorkerInnerGetRecreateSnapshot = Rpc.make('GetRecreateSnapshot', {
  success: Schema.Struct({
    snapshot: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
    migrationsReport: MigrationsReport,
  }),
})

export const LeaderWorkerInnerGetLeaderHead = Rpc.make('GetLeaderHead', {
  success: Schema.toType(EventSequenceNumber.Client.Composite),
})

export const LeaderWorkerInnerGetLeaderSyncState = Rpc.make('GetLeaderSyncState', {
  success: SyncState.SyncState,
})

export const LeaderWorkerInnerSyncStateStream = Rpc.make('SyncStateStream', {
  success: SyncState.SyncState,
  stream: true,
})

export const LeaderWorkerInnerGetNetworkStatus = Rpc.make('GetNetworkStatus', {
  success: SyncBackend.NetworkStatus,
})

export const LeaderWorkerInnerNetworkStatusStream = Rpc.make('NetworkStatusStream', {
  success: SyncBackend.NetworkStatus,
  stream: true,
})

export const LeaderWorkerInnerShutdown = Rpc.make('Shutdown', {
  success: Schema.Void,
})

export const LeaderWorkerInnerExtraDevtoolsMessage = Rpc.make('ExtraDevtoolsMessage', {
  payload: {
    message: Devtools.Leader.MessageToApp,
  },
  success: Schema.Void,
})

export const LeaderWorkerInnerRpcs = RpcGroup.make(
  LeaderWorkerInnerBootStatusStream,
  LeaderWorkerInnerPushToLeader,
  LeaderWorkerInnerPullStream,
  LeaderWorkerInnerStreamEvents,
  LeaderWorkerInnerExport,
  LeaderWorkerInnerExportEventlog,
  LeaderWorkerInnerGetRecreateSnapshot,
  LeaderWorkerInnerGetLeaderHead,
  LeaderWorkerInnerGetLeaderSyncState,
  LeaderWorkerInnerSyncStateStream,
  LeaderWorkerInnerGetNetworkStatus,
  LeaderWorkerInnerNetworkStatusStream,
  LeaderWorkerInnerShutdown,
  LeaderWorkerInnerExtraDevtoolsMessage,
  WebmeshWorker.Schema.CreateConnection,
)
export type LeaderWorkerInnerRequest = Rpc.Payload<RpcGroup.Rpcs<typeof LeaderWorkerInnerRpcs>>

export const SharedWorkerUpdateMessagePort = Rpc.make('UpdateMessagePort', {
  payload: {
    port: Transferable.MessagePort,
    // Version gate to prevent mixed LiveStore builds talking to the same SharedWorker
    liveStoreVersion: Schema.Literal(liveStoreVersion),
    /**
     * Initial configuration for the leader worker. This replaces the previous
     * two-phase SharedWorker handshake and is sent under the tab lock by the
     * elected leader. Subsequent calls can omit changes and will simply rebind
     * the port (join) without reinitializing the store.
     */
    initial: LeaderWorkerInnerInitialMessage,
  },
  success: Schema.Void,
  error: UnknownError,
})

export const SharedWorkerRpcs = RpcGroup.make(
  SharedWorkerUpdateMessagePort,
  LeaderWorkerInnerBootStatusStream,
  LeaderWorkerInnerPushToLeader,
  LeaderWorkerInnerPullStream,
  LeaderWorkerInnerStreamEvents,
  LeaderWorkerInnerExport,
  LeaderWorkerInnerGetRecreateSnapshot,
  LeaderWorkerInnerExportEventlog,
  LeaderWorkerInnerGetLeaderHead,
  LeaderWorkerInnerGetLeaderSyncState,
  LeaderWorkerInnerSyncStateStream,
  LeaderWorkerInnerGetNetworkStatus,
  LeaderWorkerInnerNetworkStatusStream,
  LeaderWorkerInnerShutdown,
  LeaderWorkerInnerExtraDevtoolsMessage,
  WebmeshWorker.Schema.CreateConnection,
)
export type SharedWorkerRequest = Rpc.Payload<RpcGroup.Rpcs<typeof SharedWorkerRpcs>>
