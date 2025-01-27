import { BootStatus, InvalidPushError, PayloadUpstream, SyncState, UnexpectedError } from '@livestore/common'
import { EventId, MutationEvent } from '@livestore/common/schema'
import * as WebMeshWorker from '@livestore/devtools-web-common/worker'
import { Schema, Transferable } from '@livestore/utils/effect'

export const StorageTypeOpfs = Schema.Struct({
  type: Schema.Literal('opfs'),
  /**
   * Default is `livestore-${schema.key}`
   *
   * When providing this option, make sure to include the `schema.key` in the path to avoid
   * conflicts with other LiveStore apps.
   */
  directory: Schema.optional(Schema.String),
})

export type StorageTypeOpfs = typeof StorageTypeOpfs.Type

// export const StorageTypeIndexeddb = Schema.Struct({
//   type: Schema.Literal('indexeddb'),
//   /** @default "livestore" */
//   databaseName: Schema.optionalWith(Schema.String, { default: () => 'livestore' }),
//   /** @default "livestore-" */
//   storeNamePrefix: Schema.optionalWith(Schema.String, { default: () => 'livestore-' }),
// })

export const StorageType = Schema.Union(
  StorageTypeOpfs,
  // StorageTypeIndexeddb
)
export type StorageType = typeof StorageType.Type
export type StorageTypeEncoded = typeof StorageType.Encoded

// export const SyncBackendOptionsWebsocket = Schema.Struct({
//   type: Schema.Literal('websocket'),
//   url: Schema.String,
//   roomId: Schema.String,
// })

// export const SyncBackendOptions = Schema.Union(SyncBackendOptionsWebsocket)
export const SyncBackendOptions = Schema.Record({ key: Schema.String, value: Schema.JsonValue })
export type SyncBackendOptions = Record<string, Schema.JsonValue>

export namespace LeaderWorkerOuter {
  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: { port: Transferable.MessagePort },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class Request extends Schema.Union(InitialMessage) {}
}

export namespace LeaderWorkerInner {
  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: {
      storageOptions: StorageType,
      syncOptions: Schema.optional(SyncBackendOptions),
      devtoolsEnabled: Schema.Boolean,
      storeId: Schema.String,
      originId: Schema.String,
      debugInstanceId: Schema.String,
    },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class BootStatusStream extends Schema.TaggedRequest<BootStatusStream>()('BootStatusStream', {
    payload: {},
    success: BootStatus,
    failure: UnexpectedError,
  }) {}

  export class PushToLeader extends Schema.TaggedRequest<PushToLeader>()('PushToLeader', {
    payload: {
      batch: Schema.Array(MutationEvent.AnyEncoded),
    },
    success: Schema.Void,
    failure: Schema.Union(UnexpectedError, InvalidPushError),
  }) {}

  export class PullStream extends Schema.TaggedRequest<PullStream>()('PullStream', {
    payload: {
      cursor: EventId.EventId,
    },
    success: Schema.Struct({
      // TODO use actual app-defined mutation event schema
      // mutationEvents: Schema.Array(EncodedAny),
      // backendHead: Schema.Number,
      payload: PayloadUpstream,
      remaining: Schema.Number,
    }),
    failure: UnexpectedError,
  }) {}

  export class Export extends Schema.TaggedRequest<Export>()('Export', {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  }) {}

  export class ExportMutationlog extends Schema.TaggedRequest<ExportMutationlog>()('ExportMutationlog', {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  }) {}

  export class GetCurrentMutationEventId extends Schema.TaggedRequest<GetCurrentMutationEventId>()(
    'GetCurrentMutationEventId',
    {
      payload: {},
      success: EventId.EventId,
      failure: UnexpectedError,
    },
  ) {}

  export class GetLeaderSyncState extends Schema.TaggedRequest<GetLeaderSyncState>()('GetLeaderSyncState', {
    payload: {},
    success: SyncState,
    failure: UnexpectedError,
  }) {}

  export class NetworkStatusStream extends Schema.TaggedRequest<NetworkStatusStream>()('NetworkStatusStream', {
    payload: {},
    success: Schema.Struct({
      isConnected: Schema.Boolean,
      timestampMs: Schema.Number,
    }),
    failure: UnexpectedError,
  }) {}

  export class Shutdown extends Schema.TaggedRequest<Shutdown>()('Shutdown', {
    payload: {},
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export const Request = Schema.Union(
    InitialMessage,
    BootStatusStream,
    PushToLeader,
    PullStream,
    Export,
    ExportMutationlog,
    GetCurrentMutationEventId,
    GetLeaderSyncState,
    NetworkStatusStream,
    Shutdown,
    WebMeshWorker.Schema.CreateConnection,
  )
  export type Request = typeof Request.Type
}

export namespace SharedWorker {
  export class InitialMessagePayloadFromCoordinator extends Schema.TaggedStruct('FromCoordinator', {
    initialMessage: LeaderWorkerInner.InitialMessage,
  }) {}

  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: {
      payload: Schema.Union(InitialMessagePayloadFromCoordinator, Schema.TaggedStruct('FromWebBridge', {})),
    },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class UpdateMessagePort extends Schema.TaggedRequest<UpdateMessagePort>()('UpdateMessagePort', {
    payload: {
      port: Transferable.MessagePort,
    },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class Request extends Schema.Union(
    InitialMessage,
    UpdateMessagePort,

    // Proxied requests
    LeaderWorkerInner.BootStatusStream,
    LeaderWorkerInner.PushToLeader,
    LeaderWorkerInner.PullStream,
    LeaderWorkerInner.Export,
    // LeaderWorkerInner.GetRecreateSnapshot,
    LeaderWorkerInner.ExportMutationlog,
    LeaderWorkerInner.GetCurrentMutationEventId,
    LeaderWorkerInner.GetLeaderSyncState,
    LeaderWorkerInner.NetworkStatusStream,
    LeaderWorkerInner.Shutdown,

    WebMeshWorker.Schema.CreateConnection,
  ) {}
}
