import {
  BootStatus,
  Devtools,
  liveStoreVersion,
  MigrationsReport,
  RejectedPushError,
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
export const SyncBackendOptions = Schema.Record(Schema.String, Schema.Json)
export type SyncBackendOptions = Record<string, Schema.Json>

export class LeaderWorkerOuterInitialMessage extends Rpc.make('InitialMessage', {
  payload: { port: Transferable.MessagePort, storeId: Schema.String, clientId: Schema.String },
  success: Schema.Void,
  error: Schema.Never,
}) {}

export class LeaderWorkerOuterRequest extends RpcGroup.make(LeaderWorkerOuterInitialMessage) {}

// TODO unify this code with schema from node adapter
export class LeaderWorkerInnerInitialMessage extends Rpc.make('InitialMessage', {
  payload: {
    storageOptions: StorageType,
    devtoolsEnabled: Schema.Boolean,
    storeId: Schema.String,
    clientId: Schema.String,
    debugInstanceId: Schema.String,
    syncPayloadEncoded: Schema.UndefinedOr(Schema.Json),
  },
  success: Schema.Void,
  error: UnknownError,
}) {}

export class LeaderWorkerInnerBootStatusStream extends Rpc.make('BootStatusStream', {
  payload: {},
  success: BootStatus,
  error: Schema.Never,
  stream: true,
}) {}

export class LeaderWorkerInnerPushToLeader extends Rpc.make('PushToLeader', {
  payload: {
    batch: Schema.Array(Schema.toType(LiveStoreEvent.Client.Encoded)),
  },
  success: Schema.Void,
  error: RejectedPushError,
}) {}

export class LeaderWorkerInnerPullStream extends Rpc.make('PullStream', {
  payload: {
    cursor: Schema.toType(EventSequenceNumber.Client.Composite),
  },
  success: Schema.Struct({
    payload: SyncState.PayloadUpstream,
  }),
  error: Schema.Never,
  stream: true,
}) {}

export class LeaderWorkerInnerStreamEvents extends Rpc.make('StreamEvents', {
  payload: StreamEventsOptionsFields,
  success: LiveStoreEvent.Client.Encoded,
  error: Schema.Never,
  stream: true,
}) {}

export class LeaderWorkerInnerExport extends Rpc.make('Export', {
  payload: {},
  success: Transferable.Uint8Array as Schema.Codec<Uint8Array<ArrayBuffer>>,
  error: Schema.Never,
}) {}

export class LeaderWorkerInnerExportEventlog extends Rpc.make('ExportEventlog', {
  payload: {},
  success: Transferable.Uint8Array as Schema.Codec<Uint8Array<ArrayBuffer>>,
  error: Schema.Never,
}) {}

export class LeaderWorkerInnerGetRecreateSnapshot extends Rpc.make('GetRecreateSnapshot', {
  payload: {},
  success: Schema.Struct({
    snapshot: Transferable.Uint8Array as Schema.Codec<Uint8Array<ArrayBuffer>>,
    migrationsReport: MigrationsReport,
  }),
  error: Schema.Never,
}) {}

export class LeaderWorkerInnerGetLeaderHead extends Rpc.make('GetLeaderHead', {
  payload: {},
  success: Schema.toType(EventSequenceNumber.Client.Composite),
  error: Schema.Never,
}) {}

export class LeaderWorkerInnerGetLeaderSyncState extends Rpc.make('GetLeaderSyncState', {
  payload: {},
  success: SyncState.SyncState,
  error: Schema.Never,
}) {}

export class LeaderWorkerInnerSyncStateStream extends Rpc.make('SyncStateStream', {
  payload: {},
  success: SyncState.SyncState,
  error: Schema.Never,
  stream: true,
}) {}

export class LeaderWorkerInnerGetNetworkStatus extends Rpc.make('GetNetworkStatus', {
  payload: {},
  success: SyncBackend.NetworkStatus,
  error: Schema.Never,
}) {}

export class LeaderWorkerInnerNetworkStatusStream extends Rpc.make('NetworkStatusStream', {
  payload: {},
  success: SyncBackend.NetworkStatus,
  error: Schema.Never,
  stream: true,
}) {}

export class LeaderWorkerInnerShutdown extends Rpc.make('Shutdown', {
  payload: {},
  success: Schema.Void,
  error: Schema.Never,
}) {}

export class LeaderWorkerInnerExtraDevtoolsMessage extends Rpc.make('ExtraDevtoolsMessage', {
  payload: {
    message: Devtools.Leader.MessageToApp,
  },
  success: Schema.Void,
  error: Schema.Never,
}) {}

export class WebmeshWorkerCreateConnection extends Rpc.make('WebmeshWorker.CreateConnection', {
  payload: WebmeshWorker.Schema.CreateConnection,
  success: Schema.Struct({}),
  error: Schema.Never,
  stream: true,
}) {}

export class LeaderWorkerInnerRequest extends RpcGroup.make(
  LeaderWorkerInnerInitialMessage,
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
  WebmeshWorkerCreateConnection,
) {}

export class SharedWorkerUpdateMessagePort extends Rpc.make('UpdateMessagePort', {
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
    initial: LeaderWorkerInnerInitialMessage.payloadSchema,
  },
  success: Schema.Void,
  error: UnknownError,
}) {}

export class SharedWorkerRequest extends RpcGroup.make(
  SharedWorkerUpdateMessagePort,

  // Proxied requests
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

  WebmeshWorkerCreateConnection,
) {}
