import {
  BootStatus,
  Devtools,
  LeaderAheadError,
  liveStoreVersion,
  MigrationsReport,
  SyncState,
  UnexpectedError,
} from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import * as WebmeshWorker from '@livestore/devtools-web-common/worker'
import { Schema, Transferable } from '@livestore/utils/effect'

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

// export const SyncBackendOptions = Schema.Union(SyncBackendOptionsWebsocket)
export const SyncBackendOptions = Schema.Record({ key: Schema.String, value: Schema.JsonValue })
export type SyncBackendOptions = Record<string, Schema.JsonValue>

export namespace LeaderWorkerOuter {
  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: { port: Transferable.MessagePort, storeId: Schema.String, clientId: Schema.String },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class Request extends Schema.Union(InitialMessage) {}
}

// TODO unify this code with schema from node adapter
export namespace LeaderWorkerInner {
  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: {
      storageOptions: StorageType,
      devtoolsEnabled: Schema.Boolean,
      storeId: Schema.String,
      clientId: Schema.String,
      debugInstanceId: Schema.String,
      syncPayload: Schema.UndefinedOr(Schema.JsonValue),
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
      batch: Schema.Array(LiveStoreEvent.AnyEncoded),
    },
    success: Schema.Void,
    failure: Schema.Union(UnexpectedError, LeaderAheadError),
  }) {}

  export class PullStream extends Schema.TaggedRequest<PullStream>()('PullStream', {
    payload: {
      cursor: EventSequenceNumber.EventSequenceNumber,
    },
    success: Schema.Struct({
      payload: SyncState.PayloadUpstream,
    }),
    failure: UnexpectedError,
  }) {}

  export class Export extends Schema.TaggedRequest<Export>()('Export', {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  }) {}

  export class ExportEventlog extends Schema.TaggedRequest<ExportEventlog>()('ExportEventlog', {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  }) {}

  export class GetRecreateSnapshot extends Schema.TaggedRequest<GetRecreateSnapshot>()('GetRecreateSnapshot', {
    payload: {},
    success: Schema.Struct({
      snapshot: Transferable.Uint8Array,
      migrationsReport: MigrationsReport,
    }),
    failure: UnexpectedError,
  }) {}

  export class GetLeaderHead extends Schema.TaggedRequest<GetLeaderHead>()('GetLeaderHead', {
    payload: {},
    success: EventSequenceNumber.EventSequenceNumber,
    failure: UnexpectedError,
  }) {}

  export class GetLeaderSyncState extends Schema.TaggedRequest<GetLeaderSyncState>()('GetLeaderSyncState', {
    payload: {},
    success: SyncState.SyncState,
    failure: UnexpectedError,
  }) {}

  export class Shutdown extends Schema.TaggedRequest<Shutdown>()('Shutdown', {
    payload: {},
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class ExtraDevtoolsMessage extends Schema.TaggedRequest<ExtraDevtoolsMessage>()('ExtraDevtoolsMessage', {
    payload: {
      message: Devtools.Leader.MessageToApp,
    },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export const Request = Schema.Union(
    InitialMessage,
    BootStatusStream,
    PushToLeader,
    PullStream,
    Export,
    ExportEventlog,
    GetRecreateSnapshot,
    GetLeaderHead,
    GetLeaderSyncState,
    Shutdown,
    ExtraDevtoolsMessage,
    WebmeshWorker.Schema.CreateConnection,
  )
  export type Request = typeof Request.Type
}

export namespace SharedWorker {
  export class InitialMessagePayloadFromClientSession extends Schema.TaggedStruct('FromClientSession', {
    initialMessage: LeaderWorkerInner.InitialMessage,
  }) {}

  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: {
      payload: Schema.Union(InitialMessagePayloadFromClientSession, Schema.TaggedStruct('FromWebBridge', {})),
      // To guard against scenarios where a client session is already running a newer version of LiveStore
      // We should probably find a better way to handle those cases once they become more common.
      liveStoreVersion: Schema.Literal(liveStoreVersion),
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
    LeaderWorkerInner.GetRecreateSnapshot,
    LeaderWorkerInner.ExportEventlog,
    LeaderWorkerInner.GetLeaderHead,
    LeaderWorkerInner.GetLeaderSyncState,
    LeaderWorkerInner.Shutdown,
    LeaderWorkerInner.ExtraDevtoolsMessage,

    WebmeshWorker.Schema.CreateConnection,
  ) {}
}
