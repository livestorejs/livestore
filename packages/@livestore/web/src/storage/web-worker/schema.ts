import { Schema, Transferable } from '@livestore/utils/effect'

export class UnexpectedError extends Schema.TaggedError<UnexpectedError>()('UnexpectedError', {
  error: Schema.Any,
}) {}

export const ExecutionBacklogItemExecute = Schema.Struct({
  _tag: Schema.Literal('execute'),
  query: Schema.String,
  bindValues: Schema.Any,
})

export const ExecutionBacklogItemMutate = Schema.Struct({
  _tag: Schema.Literal('mutate'),
  mutationEventEncoded: Schema.Struct({
    mutation: Schema.String,
    args: Schema.Any,
    id: Schema.String,
  }),
})

export const ExecutionBacklogItemTxn = Schema.Struct({
  _tag: Schema.Literal('txn'),
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
  directory: Schema.optional(Schema.String),
  /** Default is 'livestore-' */
  filePrefix: Schema.optional(Schema.String),
})

export const StorageTypeIndexeddb = Schema.Struct({
  type: Schema.Literal('indexeddb'),
  /** @default "livestore" */
  databaseName: Schema.optional(Schema.String),
  /** @default "livestore" */
  storeNamePrefix: Schema.optional(Schema.String),
})

export const StorageType = Schema.Union(StorageTypeOpfs, StorageTypeIndexeddb)
export type StorageType = Schema.Schema.Type<typeof StorageType>

export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()(
  'InitialMessage',
  UnexpectedError,
  Schema.Void,
  { storage: StorageType },
) {}

export class ExecuteBulk extends Schema.TaggedRequest<ExecuteBulk>()('ExecuteBulk', UnexpectedError, Schema.Void, {
  items: Schema.Array(ExecutionBacklogItem),
}) {}

export class Export extends Schema.TaggedRequest<Export>()('Export', UnexpectedError, Transferable.Uint8Array, {}) {}

export class ExportMutationlog extends Schema.TaggedRequest<ExportMutationlog>()(
  'ExportMutationlog',
  UnexpectedError,
  Transferable.Uint8Array,
  {},
) {}

export class Setup extends Schema.TaggedRequest<Setup>()('Setup', UnexpectedError, Transferable.Uint8Array, {}) {}

export class Shutdown extends Schema.TaggedRequest<Shutdown>()('Shutdown', UnexpectedError, Schema.Void, {}) {}

export const Request = Schema.Union(InitialMessage, ExecuteBulk, Export, ExportMutationlog, Setup, Shutdown)
export type Request = Schema.Schema.Type<typeof Request>
