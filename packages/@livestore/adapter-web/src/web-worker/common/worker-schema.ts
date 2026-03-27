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
import * as WebmeshWorker from '@livestore/devtools-web-common/worker'
import { ParseResult, Schema, Transferable, WorkerError } from '@livestore/utils/effect'

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

const VoidSchema = Schema.Void

const TransferableUint8ArrayFromArrayBuffer = Transferable.schema(
  Schema.declare<Uint8Array<ArrayBuffer>>(
    (input): input is Uint8Array<ArrayBuffer> =>
      input instanceof Uint8Array && input.buffer instanceof ArrayBuffer,
  ),
  (_) => [_.buffer],
)

const TransportParseErrorEncoded = Schema.Struct({
  _tag: Schema.Literal('ParseError'),
  message: Schema.String,
})

/**
 * Effect's `ParseError` contains schema AST internals that are not stable worker payloads.
 * We only ship the formatted message and reconstruct a real `ParseError` on decode so callers
 * still receive the original transport error type.
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
    payload: { port: Transferable.MessagePort, storeId: Schema.String, clientId: Schema.String },
    success: Schema.Void,
    failure: UnknownError,
  },
) {}

export class LeaderWorkerOuterRequest extends Schema.Union(LeaderWorkerOuterInitialMessage) {}

// TODO unify this code with schema from node adapter
export class LeaderWorkerInnerInitialMessage extends Schema.TaggedRequest<LeaderWorkerInnerInitialMessage>()(
  'InitialMessage',
  {
    payload: {
      storageOptions: StorageType,
      devtoolsEnabled: Schema.Boolean,
      storeId: Schema.String,
      clientId: Schema.String,
      debugInstanceId: Schema.String,
      syncPayloadEncoded: Schema.UndefinedOr(Schema.JsonValue),
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

export class LeaderWorkerInnerPushToLeader extends Schema.TaggedRequest<LeaderWorkerInnerPushToLeader>()(
  'PushToLeader',
  {
    payload: {
      batch: Schema.Array(Schema.typeSchema(LiveStoreEvent.Client.Encoded)),
    },
    success: VoidSchema,
    failure: Schema.Union(RejectedPushError, LeaderWorkerTransportError),
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

export class LeaderWorkerInnerExport extends Schema.TaggedRequest<LeaderWorkerInnerExport>()('Export', {
  payload: {},
  success: TransferableUint8ArrayFromArrayBuffer,
  failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
}) {}

export class LeaderWorkerInnerExportEventlog extends Schema.TaggedRequest<LeaderWorkerInnerExportEventlog>()(
  'ExportEventlog',
  {
    payload: {},
    success: TransferableUint8ArrayFromArrayBuffer,
    failure: Schema.Union(UnknownError, LeaderWorkerTransportError),
  },
) {}

export class LeaderWorkerInnerGetRecreateSnapshot extends Schema.TaggedRequest<LeaderWorkerInnerGetRecreateSnapshot>()(
  'GetRecreateSnapshot',
  {
    payload: {},
    success: Schema.Struct({
      snapshot: TransferableUint8ArrayFromArrayBuffer,
      migrationsReport: MigrationsReport,
    }),
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
export type LeaderWorkerInnerRequest = typeof LeaderWorkerInnerRequest.Type

export class SharedWorkerUpdateMessagePort extends Schema.TaggedRequest<SharedWorkerUpdateMessagePort>()(
  'UpdateMessagePort',
  {
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
    failure: UnknownError,
  },
) {}

export class SharedWorkerRequest extends Schema.Union(
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

  WebmeshWorker.Schema.CreateConnection,
) {}
