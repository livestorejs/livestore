import { BootStatus, Devtools, InvalidPushError, PayloadUpstream, SyncState, UnexpectedError } from '@livestore/common'
import { EventId, MutationEvent } from '@livestore/common/schema'
import { Schema, Transferable } from '@livestore/utils/effect'

export const WorkerArgv = Schema.parseJson(
  Schema.Struct({
    clientId: Schema.String,
    storeId: Schema.String,
    sessionId: Schema.String,
  }),
)

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
//   storeId: Schema.String,
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
      storeId: Schema.String,
      clientId: Schema.String,
      baseDirectory: Schema.optional(Schema.String),
      schemaPath: Schema.String,
      devtools: Schema.Struct({
        port: Schema.Number,
        enabled: Schema.Boolean,
      }),
    },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class BootStatusStream extends Schema.TaggedRequest<BootStatusStream>()('BootStatusStream', {
    payload: {},
    success: BootStatus,
    failure: UnexpectedError,
  }) {}

  export class PullStream extends Schema.TaggedRequest<PullStream>()('PullStream', {
    payload: {
      cursor: EventId.EventId,
    },
    success: Schema.Struct({
      // mutationEvents: Schema.Array(EncodedAny),
      // backendHead: Schema.Number,
      payload: PayloadUpstream,
      remaining: Schema.Number,
    }),
    failure: UnexpectedError,
  }) {}

  export class PushToLeader extends Schema.TaggedRequest<PushToLeader>()('PushToLeader', {
    payload: {
      batch: Schema.Array(MutationEvent.AnyEncoded),
    },
    success: Schema.Void,
    failure: Schema.Union(UnexpectedError, InvalidPushError),
  }) {}

  export class Export extends Schema.TaggedRequest<Export>()('Export', {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  }) {}

  // export class GetRecreateSnapshot extends Schema.TaggedRequest<GetRecreateSnapshot>()('GetRecreateSnapshot', {
  //   payload: {},
  //   success: Transferable.Uint8Array,
  //   failure: UnexpectedError,
  // }) {}

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
    PullStream,
    PushToLeader,
    Export,
    // GetRecreateSnapshot,
    ExportMutationlog,
    GetCurrentMutationEventId,
    GetLeaderSyncState,
    NetworkStatusStream,
    Shutdown,
    ExtraDevtoolsMessage,
  )
  export type Request = typeof Request.Type
}
