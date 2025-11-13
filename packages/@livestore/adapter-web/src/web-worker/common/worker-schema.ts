import {
  BootStatus,
  Devtools,
  LeaderAheadError,
  liveStoreVersion,
  MigrationsReport,
  SyncBackend,
  SyncState,
  UnknownError,
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
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerPushToLeader extends Schema.TaggedRequest<LeaderWorkerInnerPushToLeader>()(
  'PushToLeader',
  {
    payload: {
      batch: Schema.Array(LiveStoreEvent.AnyEncoded),
    },
    success: Schema.Void,
    failure: Schema.Union(UnknownError, LeaderAheadError),
  },
) {}

export class LeaderWorkerInnerPullStream extends Schema.TaggedRequest<LeaderWorkerInnerPullStream>()('PullStream', {
  payload: {
    cursor: EventSequenceNumber.EventSequenceNumber,
  },
  success: Schema.Struct({
    payload: SyncState.PayloadUpstream,
  }),
  failure: UnknownError,
}) {}

export class LeaderWorkerInnerExport extends Schema.TaggedRequest<LeaderWorkerInnerExport>()('Export', {
  payload: {},
  success: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
  failure: UnknownError,
}) {}

export class LeaderWorkerInnerExportEventlog extends Schema.TaggedRequest<LeaderWorkerInnerExportEventlog>()(
  'ExportEventlog',
  {
    payload: {},
    success: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerGetRecreateSnapshot extends Schema.TaggedRequest<LeaderWorkerInnerGetRecreateSnapshot>()(
  'GetRecreateSnapshot',
  {
    payload: {},
    success: Schema.Struct({
      snapshot: Transferable.Uint8Array as Schema.Schema<Uint8Array<ArrayBuffer>>,
      migrationsReport: MigrationsReport,
    }),
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerGetLeaderHead extends Schema.TaggedRequest<LeaderWorkerInnerGetLeaderHead>()(
  'GetLeaderHead',
  {
    payload: {},
    success: EventSequenceNumber.EventSequenceNumber,
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerGetLeaderSyncState extends Schema.TaggedRequest<LeaderWorkerInnerGetLeaderSyncState>()(
  'GetLeaderSyncState',
  {
    payload: {},
    success: SyncState.SyncState,
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerSyncStateStream extends Schema.TaggedRequest<LeaderWorkerInnerSyncStateStream>()(
  'SyncStateStream',
  {
    payload: {},
    success: SyncState.SyncState,
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerGetNetworkStatus extends Schema.TaggedRequest<LeaderWorkerInnerGetNetworkStatus>()(
  'GetNetworkStatus',
  {
    payload: {},
    success: SyncBackend.NetworkStatus,
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerNetworkStatusStream extends Schema.TaggedRequest<LeaderWorkerInnerNetworkStatusStream>()(
  'NetworkStatusStream',
  {
    payload: {},
    success: SyncBackend.NetworkStatus,
    failure: UnknownError,
  },
) {}

export class LeaderWorkerInnerShutdown extends Schema.TaggedRequest<LeaderWorkerInnerShutdown>()('Shutdown', {
  payload: {},
  success: Schema.Void,
  failure: UnknownError,
}) {}

export class LeaderWorkerInnerExtraDevtoolsMessage extends Schema.TaggedRequest<LeaderWorkerInnerExtraDevtoolsMessage>()(
  'ExtraDevtoolsMessage',
  {
    payload: {
      message: Devtools.Leader.MessageToApp,
    },
    success: Schema.Void,
    failure: UnknownError,
  },
) {}

export const LeaderWorkerInnerRequest = Schema.Union(
  LeaderWorkerInnerInitialMessage,
  LeaderWorkerInnerBootStatusStream,
  LeaderWorkerInnerPushToLeader,
  LeaderWorkerInnerPullStream,
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
