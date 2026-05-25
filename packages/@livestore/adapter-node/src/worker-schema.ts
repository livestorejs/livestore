import {
  BootStatus,
  Devtools,
  RejectedPushError,
  MigrationsReport,
  SyncBackend,
  SyncState,
  UnknownError,
} from '@livestore/common'
import { StreamEventsOptionsFields } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { Rpc, RpcGroup, Schema, Transferable } from '@livestore/utils/effect'

export const WorkerArgv = Schema.fromJsonString(Schema.Struct({
    clientId: Schema.String,
    storeId: Schema.String,
    sessionId: Schema.String,
    extraArgs: Schema.UndefinedOr(Schema.JsonValue),
  }))

export const StorageTypeInMemory = Schema.Struct({
  type: Schema.Literal('in-memory'),
  /**
   * Only works with single-threaded leader thread for now.
   * Should be mostly used for testing.
   */
  importSnapshot: Schema.optional(Schema.Uint8Array as any as Schema.Schema<Uint8Array<ArrayBuffer>>),
})

export type StorageTypeInMemory = typeof StorageTypeInMemory.Type

export const StorageTypeFs = Schema.Struct({
  type: Schema.Literal('fs'),
  /**
   * Where to store the database files
   *
   * @default Current working directory
   */
  baseDirectory: Schema.optional(Schema.String),
})

export type StorageTypeFs = typeof StorageTypeFs.Type

export const StorageType = Schema.Union([StorageTypeInMemory, StorageTypeFs])
export type StorageType = typeof StorageType.Type
export type StorageTypeEncoded = typeof StorageType.Encoded

// export const SyncBackendOptionsWebsocket = Schema.Struct({
//   type: Schema.Literal('websocket'),
//   url: Schema.String,
//   storeId: Schema.String,
// })

// export const SyncBackendOptions = Schema.Union([SyncBackendOptionsWebsocket])
export const SyncBackendOptions = Schema.Record(Schema.String, Schema.JsonValue)
export type SyncBackendOptions = Record<string, Schema.JsonValue>

export class LeaderWorkerOuterInitialMessage extends Schema.Class<LeaderWorkerOuterInitialMessage>('InitialMessage')({
  port: Transferable.MessagePort,
}) {}

export const LeaderWorkerOuterRequest = Schema.Union([LeaderWorkerOuterInitialMessage])
export type LeaderWorkerOuterRequest = typeof LeaderWorkerOuterRequest.Type

export class LeaderWorkerInnerInitialMessage extends Schema.Class<LeaderWorkerInnerInitialMessage>('InitialMessage')({
  storeId: Schema.String,
  clientId: Schema.String,
  storage: StorageType,
  syncPayloadEncoded: Schema.UndefinedOr(Schema.JsonValue),
  devtools: Schema.Union([Schema.Struct({
      enabled: Schema.Literal(true),
      schemaPath: Schema.String,
      port: Schema.Number,
      host: Schema.String,
      schemaAlias: Schema.String,
      useExistingDevtoolsServer: Schema.Boolean,
    }), Schema.Struct({ enabled: Schema.Literal(false) })]),
}) {}

export const LeaderWorkerInnerBootStatusStream = Rpc.make('BootStatusStream', {
  success: BootStatus,
  stream: true,
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

export const LeaderWorkerInnerPushToLeader = Rpc.make('PushToLeader', {
  payload: {
    batch: Schema.Array(Schema.toType(LiveStoreEvent.Client.Encoded)),
  },
  success: Schema.Void as Schema.Schema<void>,
  error: RejectedPushError,
})

export const LeaderWorkerInnerExport = Rpc.make('Export', {
  success: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
})

export const LeaderWorkerInnerGetRecreateSnapshot = Rpc.make('GetRecreateSnapshot', {
  success: Schema.Struct({
    snapshot: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
    migrationsReport: MigrationsReport,
  }),
})

export const LeaderWorkerInnerExportEventlog = Rpc.make('ExportEventlog', {
  success: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
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

export const LeaderWorkerInnerRpcs = RpcGroup.make(LeaderWorkerInnerBootStatusStream, LeaderWorkerInnerPullStream, LeaderWorkerInnerStreamEvents, LeaderWorkerInnerPushToLeader, LeaderWorkerInnerExport, LeaderWorkerInnerGetRecreateSnapshot, LeaderWorkerInnerExportEventlog, LeaderWorkerInnerGetLeaderHead, LeaderWorkerInnerGetLeaderSyncState, LeaderWorkerInnerSyncStateStream, LeaderWorkerInnerGetNetworkStatus, LeaderWorkerInnerNetworkStatusStream, LeaderWorkerInnerShutdown, LeaderWorkerInnerExtraDevtoolsMessage)
export type LeaderWorkerInnerRequest = Rpc.Payload<RpcGroup.Rpcs<typeof LeaderWorkerInnerRpcs>>
