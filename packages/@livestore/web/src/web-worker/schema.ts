import { BootStatus, UnexpectedError } from '@livestore/common'
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

export type ExecutionBacklogItem = typeof ExecutionBacklogItem.Type

export const StorageTypeOpfs = Schema.Struct({
  type: Schema.Literal('opfs'),
  /** Default is root directory */
  directory: Schema.optionalWith(Schema.String, { default: () => '' }),
  /** Default is 'livestore-' */
  filePrefix: Schema.optionalWith(Schema.String, { default: () => 'livestore-' }),
})

export const StorageTypeOpfsSahpoolExperimental = Schema.Struct({
  type: Schema.Literal('opfs-sahpool-experimental'),
  /** Default is `.livestore-sahpool-experimental` */
  directory: Schema.optionalWith(Schema.String, { default: () => '.livestore-sahpool-experimental' }),
  /** Default is 'livestore-' */
  filePrefix: Schema.optionalWith(Schema.String, { default: () => 'livestore-' }),
})

export type StorageTypeOpfsSahpoolExperimental = typeof StorageTypeOpfsSahpoolExperimental.Type

export const StorageTypeIndexeddb = Schema.Struct({
  type: Schema.Literal('indexeddb'),
  /** @default "livestore" */
  databaseName: Schema.optionalWith(Schema.String, { default: () => 'livestore' }),
  /** @default "livestore-" */
  storeNamePrefix: Schema.optionalWith(Schema.String, { default: () => 'livestore-' }),
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

export namespace DedicatedWorkerOuter {
  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: { port: Transferable.MessagePort },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class Request extends Schema.Union(InitialMessage) {}
}

export namespace DedicatedWorkerInner {
  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: {
      storageOptions: StorageType,
      needsRecreate: Schema.Boolean,
      syncOptions: Schema.optional(SyncingType),
      key: Schema.UndefinedOr(Schema.String),
      devtools: Schema.Struct({
        enabled: Schema.Boolean,
        channelId: Schema.String,
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

  export class ExecuteBulk extends Schema.TaggedRequest<ExecuteBulk>()('ExecuteBulk', {
    payload: {
      items: Schema.Array(ExecutionBacklogItem),
    },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class Export extends Schema.TaggedRequest<Export>()('Export', {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  }) {}

  export class GetRecreateSnapshot extends Schema.TaggedRequest<GetRecreateSnapshot>()('GetRecreateSnapshot', {
    payload: {},
    success: Transferable.Uint8Array,
    failure: UnexpectedError,
  }) {}

  export class ExportMutationlog extends Schema.TaggedRequest<ExportMutationlog>()('ExportMutationlog', {
    payload: {},
    success: Transferable.Uint8Array,
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

  /** NOTE we're modeling this case as a stream since streams are interruptible */
  export class ListenForReloadStream extends Schema.TaggedRequest<ListenForReloadStream>()('ListenForReloadStream', {
    payload: {},
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class Shutdown extends Schema.TaggedRequest<Shutdown>()('Shutdown', {
    payload: {},
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class ConnectDevtools extends Schema.TaggedRequest<ConnectDevtools>()('ConnectDevtools', {
    payload: {
      port: Transferable.MessagePort,
      // TODO double-check if connecitonId is actually needed
      connectionId: Schema.String,
      isLeaderTab: Schema.Boolean,
    },
    success: Schema.Struct({
      storeMessagePort: Transferable.MessagePort,
    }),
    failure: UnexpectedError,
  }) {}

  export const Request = Schema.Union(
    InitialMessage,
    BootStatusStream,
    ExecuteBulk,
    Export,
    GetRecreateSnapshot,
    ExportMutationlog,
    NetworkStatusStream,
    ListenForReloadStream,
    Shutdown,
    ConnectDevtools,
  )
  export type Request = typeof Request.Type
}

export namespace SharedWorker {
  export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
    payload: {
      payload: Schema.Union(
        Schema.TaggedStruct('FromCoordinator', { initialMessage: DedicatedWorkerInner.InitialMessage }),
        Schema.TaggedStruct('FromWebBridge', {}),
      ),
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

  export class WaitForDevtoolsPort extends Schema.TaggedRequest<WaitForDevtoolsPort>()('WaitForDevtoolsPort', {
    payload: {
      channelId: Schema.String,
    },
    success: Schema.Struct({
      port: Transferable.MessagePort,
    }),
    failure: UnexpectedError,
  }) {}

  export class OfferDevtoolsPort extends Schema.TaggedRequest<OfferDevtoolsPort>()('OfferDevtoolsPort', {
    payload: {
      port: Transferable.MessagePort,
      channelId: Schema.String,
    },
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  export class Request extends Schema.Union(
    InitialMessage,
    UpdateMessagePort,
    WaitForDevtoolsPort,
    OfferDevtoolsPort,

    // Proxied requests
    DedicatedWorkerInner.BootStatusStream,
    DedicatedWorkerInner.ExecuteBulk,
    DedicatedWorkerInner.Export,
    DedicatedWorkerInner.GetRecreateSnapshot,
    DedicatedWorkerInner.ExportMutationlog,
    DedicatedWorkerInner.NetworkStatusStream,
    DedicatedWorkerInner.ListenForReloadStream,
    DedicatedWorkerInner.Shutdown,
    DedicatedWorkerInner.ConnectDevtools,
  ) {}
}
