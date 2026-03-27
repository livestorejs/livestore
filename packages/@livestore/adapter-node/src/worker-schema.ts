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
import { ParseResult, Schema, Transferable, WorkerError } from '@livestore/utils/effect'

export const WorkerArgv = Schema.parseJson(
  Schema.Struct({
    clientId: Schema.String,
    storeId: Schema.String,
    sessionId: Schema.String,
    extraArgs: Schema.UndefinedOr(Schema.JsonValue),
  }),
)

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

const TransportParseErrorEncoded = Schema.Struct({
  _tag: Schema.Literal('ParseError'),
  message: Schema.String,
})

/**
 * Effect's `ParseError` carries internal schema state that we don't want to serialize directly.
 * We preserve the original error type over the worker transport by round-tripping its formatted message.
 */
export class TransportParseError extends Schema.transformOrFail(
  TransportParseErrorEncoded,
  Schema.instanceOf(ParseResult.ParseError),
  {
    strict: true,
    decode: ({ message }) =>
      ParseResult.succeed(
        new ParseResult.ParseError({
          issue: new ParseResult.Type(Schema.Unknown.ast, undefined, message),
        }),
      ),
    encode: (error) =>
      ParseResult.succeed(
        TransportParseErrorEncoded.make({
          _tag: 'ParseError',
          message: error.message,
        }),
      ),
  },
) {}

export const LeaderWorkerTransportError = Schema.Union(WorkerError.WorkerError, TransportParseError)
export type LeaderWorkerTransportError = typeof LeaderWorkerTransportError.Type

export class LeaderWorkerOuterInitialMessage extends Schema.TaggedRequest<LeaderWorkerOuterInitialMessage>()(
  'InitialMessage',
  {
    payload: { port: Transferable.MessagePort },
    success: Schema.Void,
    failure: UnknownError,
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
      syncPayloadEncoded: Schema.UndefinedOr(Schema.JsonValue),
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
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerBootStatusStream extends Schema.TaggedRequest<LeaderWorkerInnerBootStatusStream>()(
  'BootStatusStream',
  {
    payload: {},
    success: BootStatus,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerPullStream extends Schema.TaggedRequest<LeaderWorkerInnerPullStream>()('PullStream', {
  payload: {
    cursor: Schema.typeSchema(EventSequenceNumber.Client.Composite),
  },
  success: Schema.Struct({
    payload: SyncState.PayloadUpstream,
  }),
  failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
}) {}

export class LeaderWorkerInnerStreamEvents extends Schema.TaggedRequest<LeaderWorkerInnerStreamEvents>()(
  'StreamEvents',
  {
    payload: StreamEventsOptionsFields,
    success: LiveStoreEvent.Client.Encoded,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerPushToLeader extends Schema.TaggedRequest<LeaderWorkerInnerPushToLeader>()(
  'PushToLeader',
  {
    payload: {
      batch: Schema.Array(Schema.typeSchema(LiveStoreEvent.Client.Encoded)),
    },
    success: Schema.Void as Schema.Schema<void>,
    failure: Schema.Union(RejectedPushError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerExport extends Schema.TaggedRequest<LeaderWorkerInnerExport>()('Export', {
  payload: {},
  success: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
  failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
}) {}

export class LeaderWorkerInnerGetRecreateSnapshot extends Schema.TaggedRequest<LeaderWorkerInnerGetRecreateSnapshot>()(
  'GetRecreateSnapshot',
  {
    payload: {},
    success: Schema.Struct({
      snapshot: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
      migrationsReport: MigrationsReport,
    }),
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerExportEventlog extends Schema.TaggedRequest<LeaderWorkerInnerExportEventlog>()(
  'ExportEventlog',
  {
    payload: {},
    success: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerGetLeaderHead extends Schema.TaggedRequest<LeaderWorkerInnerGetLeaderHead>()(
  'GetLeaderHead',
  {
    payload: {},
    success: Schema.typeSchema(EventSequenceNumber.Client.Composite),
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerGetLeaderSyncState extends Schema.TaggedRequest<LeaderWorkerInnerGetLeaderSyncState>()(
  'GetLeaderSyncState',
  {
    payload: {},
    success: SyncState.SyncState,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerSyncStateStream extends Schema.TaggedRequest<LeaderWorkerInnerSyncStateStream>()(
  'SyncStateStream',
  {
    payload: {},
    success: SyncState.SyncState,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerGetNetworkStatus extends Schema.TaggedRequest<LeaderWorkerInnerGetNetworkStatus>()(
  'GetNetworkStatus',
  {
    payload: {},
    success: SyncBackend.NetworkStatus,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerNetworkStatusStream extends Schema.TaggedRequest<LeaderWorkerInnerNetworkStatusStream>()(
  'NetworkStatusStream',
  {
    payload: {},
    success: SyncBackend.NetworkStatus,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerShutdown extends Schema.TaggedRequest<LeaderWorkerInnerShutdown>()('Shutdown', {
  payload: {},
  success: Schema.Void,
  failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
}) {}

export class LeaderWorkerInnerExtraDevtoolsMessage extends Schema.TaggedRequest<LeaderWorkerInnerExtraDevtoolsMessage>()(
  'ExtraDevtoolsMessage',
  {
    payload: {
      message: Devtools.Leader.MessageToApp,
    },
    success: Schema.Void,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export const LeaderWorkerInnerRequest = Schema.Union(
  LeaderWorkerInnerInitialMessage,
  LeaderWorkerInnerBootStatusStream,
  LeaderWorkerInnerPullStream,
  LeaderWorkerInnerStreamEvents,
  LeaderWorkerInnerPushToLeader,
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
)
export type LeaderWorkerInnerRequest = typeof LeaderWorkerInnerRequest.Type
