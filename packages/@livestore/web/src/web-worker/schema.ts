import { UnexpectedError } from '@livestore/common'
import { Schema, Transferable } from '@livestore/utils/effect'

export const ExecutionBacklogItemExecute = Schema.TaggedStruct('execute', {
  query: Schema.String,
  bindValues: Schema.Any,
})

export const ExecutionBacklogItemMutate = Schema.TaggedStruct('mutate', {
  mutationEventEncoded: Schema.Struct({
    mutation: Schema.String,
    args: Schema.Any,
    id: Schema.String,
  }),
  persisted: Schema.Boolean,
})

export const ExecutionBacklogItemTxn = Schema.TaggedStruct('txn', {
  items: Schema.Union(ExecutionBacklogItemExecute, ExecutionBacklogItemMutate),
})

export const ExecutionBacklogItem = Schema.Union(
  ExecutionBacklogItemExecute,
  ExecutionBacklogItemMutate,
  ExecutionBacklogItemTxn,
)

export type ExecutionBacklogItem = Schema.Schema.Type<typeof ExecutionBacklogItem>

export const StorageTypeOpfs = Schema.Struct({
  type: Schema.Literal('opfs'),
  /** Default is root directory */
  directory: Schema.optional(Schema.String, { default: () => '' }),
  /** Default is 'livestore-' */
  filePrefix: Schema.optional(Schema.String, { default: () => 'livestore-' }),
})

export const StorageTypeOpfsSahpoolExperimental = Schema.Struct({
  type: Schema.Literal('opfs-sahpool-experimental'),
  /** Default is `.livestore-sahpool-experimental` */
  directory: Schema.optional(Schema.String, { default: () => '.livestore-sahpool-experimental' }),
  /** Default is 'livestore-' */
  filePrefix: Schema.optional(Schema.String, { default: () => 'livestore-' }),
})

export type StorageTypeOpfsSahpoolExperimental = typeof StorageTypeOpfsSahpoolExperimental.Type

export const StorageTypeIndexeddb = Schema.Struct({
  type: Schema.Literal('indexeddb'),
  /** @default "livestore" */
  databaseName: Schema.optional(Schema.String, { default: () => 'livestore' }),
  /** @default "livestore-" */
  storeNamePrefix: Schema.optional(Schema.String, { default: () => 'livestore-' }),
})

export const StorageType = Schema.Union(StorageTypeOpfs, StorageTypeIndexeddb, StorageTypeOpfsSahpoolExperimental)
export type StorageType = typeof StorageType.Type
export type StorageTypeEncoded = typeof StorageType.Encoded

export const SyncingTypeWebsocket = Schema.Struct({
  type: Schema.Literal('websocket'),
  url: Schema.String,
  roomId: Schema.String,
})

export const SyncingType = Schema.Union(SyncingTypeWebsocket)
export type SyncingType = typeof SyncingType.Type

export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()(
  'InitialMessage',
  UnexpectedError,
  Schema.Void,
  {
    storageOptions: StorageType,
    hasLock: Schema.Boolean,
    needsRecreate: Schema.Boolean,
    syncOptions: Schema.optional(SyncingType),
    key: Schema.UndefinedOr(Schema.String),
    devtools: Schema.Struct({
      enabled: Schema.Boolean,
      channelId: Schema.String,
    }),
  },
) {}

export class ExecuteBulk extends Schema.TaggedRequest<ExecuteBulk>()('ExecuteBulk', UnexpectedError, Schema.Void, {
  items: Schema.Array(ExecutionBacklogItem),
}) {}

export class Export extends Schema.TaggedRequest<Export>()('Export', UnexpectedError, Transferable.Uint8Array, {}) {}

export class GetRecreateSnapshot extends Schema.TaggedRequest<GetRecreateSnapshot>()(
  'GetRecreateSnapshot',
  UnexpectedError,
  Transferable.Uint8Array,
  {},
) {}

export class ExportMutationlog extends Schema.TaggedRequest<ExportMutationlog>()(
  'ExportMutationlog',
  UnexpectedError,
  Transferable.Uint8Array,
  {},
) {}

export class Setup extends Schema.TaggedRequest<Setup>()('Setup', UnexpectedError, Transferable.Uint8Array, {}) {}

export class NetworkStatusStream extends Schema.TaggedRequest<NetworkStatusStream>()(
  'NetworkStatusStream',
  UnexpectedError,
  Schema.Struct({
    isConnected: Schema.Boolean,
    timestampMs: Schema.Number,
  }),
  {},
) {}

export class ListenForReload extends Schema.TaggedRequest<ListenForReload>()(
  'ListenForReload',
  UnexpectedError,
  Schema.Void,
  {},
) {}

export class Shutdown extends Schema.TaggedRequest<Shutdown>()('Shutdown', UnexpectedError, Schema.Void, {}) {}

export class InitDevtools extends Schema.TaggedRequest<InitDevtools>()('InitDevtools', UnexpectedError, Schema.Void, {
  port: Transferable.MessagePort,
}) {}

export const Request = Schema.Union(
  InitialMessage,
  ExecuteBulk,
  Export,
  GetRecreateSnapshot,
  ExportMutationlog,
  Setup,
  NetworkStatusStream,
  ListenForReload,
  Shutdown,
  InitDevtools,
)
export type Request = Schema.Schema.Type<typeof Request>
