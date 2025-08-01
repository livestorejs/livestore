import { BootStatus, Devtools, LeaderAheadError, MigrationsReport, SyncState, UnexpectedError } from '@livestore/common'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
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
  /**
   * Only works with single-threaded leader thread for now.
   * Should be mostly used for testing.
   */
  importSnapshot: Schema.optional(Schema.Uint8Array),
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

export class LeaderWorkerOuterInitialMessage extends Schema.TaggedRequest<LeaderWorkerOuterInitialMessage>()(
  'InitialMessage',
  {
    payload: { port: Transferable.MessagePort },
    success: Schema.Void,
    failure: UnexpectedError,
  },
) {}

export class LeaderWorkerOuterRequest extends Schema.Union(LeaderWorkerOuterInitialMessage) {}

export class LeaderWorkerInnerInitialMessage extends Schema.TaggedRequest<LeaderWorkerInnerInitialMessage>()(
  'InitialMessage',
  {
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
          useExistingDevtoolsServer: Schema.Boolean,
        }),
        Schema.Struct({ enabled: Schema.Literal(false) }),
      ),
    },
    success: Schema.Void,
    failure: UnexpectedError,
  },
) {}

export class LeaderWorkerInnerBootStatusStream extends Schema.TaggedRequest<LeaderWorkerInnerBootStatusStream>()(
  'BootStatusStream',
  {
    payload: {},
    success: BootStatus,
    failure: UnexpectedError,
  },
) {}

export class LeaderWorkerInnerPullStream extends Schema.TaggedRequest<LeaderWorkerInnerPullStream>()('PullStream', {
  payload: {
    cursor: EventSequenceNumber.EventSequenceNumber,
  },
  success: Schema.Struct({
    payload: SyncState.PayloadUpstream,
  }),
  failure: UnexpectedError,
}) {}

export class LeaderWorkerInnerPushToLeader extends Schema.TaggedRequest<LeaderWorkerInnerPushToLeader>()(
  'PushToLeader',
  {
    payload: {
      batch: Schema.Array(LiveStoreEvent.AnyEncoded),
    },
    success: Schema.Void,
    failure: Schema.Union(UnexpectedError, LeaderAheadError),
  },
) {}

export class LeaderWorkerInnerExport extends Schema.TaggedRequest<LeaderWorkerInnerExport>()('Export', {
  payload: {},
  success: Transferable.Uint8Array,
  failure: UnexpectedError,
}) {}

export class LeaderWorkerInnerGetRecreateSnapshot extends Schema.TaggedRequest<LeaderWorkerInnerGetRecreateSnapshot>()(
  'GetRecreateSnapshot',
  {
    payload: {},
    success: Schema.Struct({
      snapshot: Transferable.Uint8Array,
      migrationsReport: MigrationsReport,
    }),
    failure: UnexpectedError,
  },
) {}

export class LeaderWorkerInnerExportEventlog extends Schema.TaggedRequest<LeaderWorkerInnerExportEventlog>()(
  'ExportEventlog',
  {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  },
) {}

export class LeaderWorkerInnerGetLeaderHead extends Schema.TaggedRequest<LeaderWorkerInnerGetLeaderHead>()(
  'GetLeaderHead',
  {
    payload: {},
    success: EventSequenceNumber.EventSequenceNumber,
    failure: UnexpectedError,
  },
) {}

export class LeaderWorkerInnerGetLeaderSyncState extends Schema.TaggedRequest<LeaderWorkerInnerGetLeaderSyncState>()(
  'GetLeaderSyncState',
  {
    payload: {},
    success: SyncState.SyncState,
    failure: UnexpectedError,
  },
) {}

export class LeaderWorkerInnerShutdown extends Schema.TaggedRequest<LeaderWorkerInnerShutdown>()('Shutdown', {
  payload: {},
  success: Schema.Void,
  failure: UnexpectedError,
}) {}

export class LeaderWorkerInnerExtraDevtoolsMessage extends Schema.TaggedRequest<LeaderWorkerInnerExtraDevtoolsMessage>()(
  'ExtraDevtoolsMessage',
  {
    payload: {
      message: Devtools.Leader.MessageToApp,
    },
    success: Schema.Void,
    failure: UnexpectedError,
  },
) {}

export const LeaderWorkerInnerRequest = Schema.Union(
  LeaderWorkerInnerInitialMessage,
  LeaderWorkerInnerBootStatusStream,
  LeaderWorkerInnerPullStream,
  LeaderWorkerInnerPushToLeader,
  LeaderWorkerInnerExport,
  LeaderWorkerInnerGetRecreateSnapshot,
  LeaderWorkerInnerExportEventlog,
  LeaderWorkerInnerGetLeaderHead,
  LeaderWorkerInnerGetLeaderSyncState,
  LeaderWorkerInnerShutdown,
  LeaderWorkerInnerExtraDevtoolsMessage,
)
export type LeaderWorkerInnerRequest = typeof LeaderWorkerInnerRequest.Type
