import { BootStatus, EventId, UnexpectedError } from '@livestore/common'
import { InitialSyncOptions } from '@livestore/common/leader-thread'
import { mutationEventSchemaEncodedAny } from '@livestore/common/schema'
import { Schema, Transferable } from '@livestore/utils/effect'

export const WorkerArgv = Schema.parseJson(
  Schema.Struct({
    otel: Schema.Struct({
      workerServiceName: Schema.String.pipe(Schema.optional),
    }).pipe(Schema.optional),
  }),
)

export const ExecutionBacklogItemMutate = Schema.TaggedStruct('mutate', {
  mutationEventEncoded: mutationEventSchemaEncodedAny,
  persisted: Schema.Boolean,
})

export const ExecutionBacklogItemTxn = Schema.TaggedStruct('txn', {
  items: Schema.Union(ExecutionBacklogItemMutate),
})

export const ExecutionBacklogItem = Schema.Union(ExecutionBacklogItemMutate, ExecutionBacklogItemTxn)

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
      // storageOptions: StorageType,
      schemaPath: Schema.String,
      syncOptions: Schema.optional(SyncBackendOptions),
      devtoolsEnabled: Schema.Boolean,
      devtoolsPort: Schema.Number,
      storeId: Schema.String,
      originId: Schema.String,
      makeSyncBackendUrl: Schema.optional(Schema.String),
      baseDirectory: Schema.optional(Schema.String),
      initialSyncOptions: InitialSyncOptions,
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
      cursor: EventId,
    },
    success: Schema.Struct({
      mutationEvents: Schema.Array(mutationEventSchemaEncodedAny),
      backendHead: Schema.Number,
      remaining: Schema.Number,
    }),
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
      success: EventId,
      failure: UnexpectedError,
    },
  ) {}

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

  export const Request = Schema.Union(
    InitialMessage,
    BootStatusStream,
    PullStream,
    ExecuteBulk,
    Export,
    // GetRecreateSnapshot,
    ExportMutationlog,
    GetCurrentMutationEventId,
    NetworkStatusStream,
    Shutdown,
  )
  export type Request = typeof Request.Type
}
