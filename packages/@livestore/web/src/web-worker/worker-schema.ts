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
      syncOptions: Schema.optional(SyncBackendOptions),
      devtoolsEnabled: Schema.Boolean,
      storeId: Schema.String,
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

  export class Shutdown extends Schema.TaggedRequest<Shutdown>()('Shutdown', {
    payload: {},
    success: Schema.Void,
    failure: UnexpectedError,
  }) {}

  /**
   * NOTE we're modeling this case as a stream since streams which only ever emits one value but stays open
   * for the lifetime of the connection
   */
  export class ConnectDevtoolsStream extends Schema.TaggedRequest<ConnectDevtoolsStream>()('ConnectDevtoolsStream', {
    payload: {
      port: Transferable.MessagePort,
      appHostId: Schema.String,
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
    Shutdown,
    ConnectDevtoolsStream,
  )
  export type Request = typeof Request.Type
}

export namespace SharedWorker {
  export class InitialMessagePayloadFromCoordinator extends Schema.TaggedStruct('FromCoordinator', {
    initialMessage: DedicatedWorkerInner.InitialMessage,
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

  export class DevtoolsWebBridgeWaitForPort extends Schema.TaggedRequest<DevtoolsWebBridgeWaitForPort>()(
    'DevtoolsWebBridgeWaitForPort',
    {
      payload: {
        webBridgeId: Schema.String,
      },
      success: Schema.Struct({
        port: Transferable.MessagePort,
      }),
      failure: UnexpectedError,
    },
  ) {}

  export class DevtoolsWebBridgeOfferPort extends Schema.TaggedRequest<DevtoolsWebBridgeOfferPort>()(
    'DevtoolsWebBridgeOfferPort',
    {
      payload: {
        port: Transferable.MessagePort,
        webBridgeId: Schema.String,
      },
      success: Schema.Void,
      failure: UnexpectedError,
    },
  ) {}

  export class Request extends Schema.Union(
    InitialMessage,
    UpdateMessagePort,
    DevtoolsWebBridgeWaitForPort,
    DevtoolsWebBridgeOfferPort,

    // Proxied requests
    DedicatedWorkerInner.BootStatusStream,
    DedicatedWorkerInner.ExecuteBulk,
    DedicatedWorkerInner.Export,
    DedicatedWorkerInner.GetRecreateSnapshot,
    DedicatedWorkerInner.ExportMutationlog,
    DedicatedWorkerInner.NetworkStatusStream,
    DedicatedWorkerInner.Shutdown,
    DedicatedWorkerInner.ConnectDevtoolsStream,
  ) {}
}
