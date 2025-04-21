import {
  BootStatus,
  Devtools,
  LeaderAheadError,
  LeaderPullCursor,
  MigrationsReport,
  SyncState,
  UnexpectedError,
} from '@livestore/common'
import { EventId, LiveStoreEvent } from '@livestore/common/schema'
import { Schema, Transferable } from '@livestore/utils/effect'

export const WorkerArgv = Schema.parseJson(
  Schema.Struct({
    clientId: Schema.String,
    storeId: Schema.String,
    sessionId: Schema.String,
  }),
)

export const StorageTypeInMemory = Schema.Struct({
  type: Schema.Literal('in-memory'),
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

export const StorageType = Schema.Union(StorageTypeInMemory, StorageTypeFs)
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
      storage: StorageType,
      syncPayload: Schema.UndefinedOr(Schema.JsonValue),
      devtools: Schema.Union(
        Schema.Struct({
          enabled: Schema.Literal(true),
          schemaPath: Schema.String,
          port: Schema.Number,
          host: Schema.String,
          schemaAlias: Schema.String,
        }),
        Schema.Struct({ enabled: Schema.Literal(false) }),
      ),
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
      cursor: LeaderPullCursor,
    },
    success: Schema.Struct({
      payload: SyncState.PayloadUpstream,
      mergeCounter: Schema.Number,
    }),
    failure: UnexpectedError,
  }) {}

  export class PushToLeader extends Schema.TaggedRequest<PushToLeader>()('PushToLeader', {
    payload: {
      batch: Schema.Array(LiveStoreEvent.AnyEncoded),
    },
    success: Schema.Void,
    failure: Schema.Union(UnexpectedError, LeaderAheadError),
  }) {}

  export class Export extends Schema.TaggedRequest<Export>()('Export', {
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

  export class ExportEventlog extends Schema.TaggedRequest<ExportEventlog>()('ExportEventlog', {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  }) {}

  export class GetLeaderHead extends Schema.TaggedRequest<GetLeaderHead>()('GetLeaderHead', {
    payload: {},
    success: EventId.EventId,
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
    PullStream,
    PushToLeader,
    Export,
    GetRecreateSnapshot,
    ExportEventlog,
    GetLeaderHead,
    GetLeaderSyncState,
    Shutdown,
    ExtraDevtoolsMessage,
  )
  export type Request = typeof Request.Type
}
