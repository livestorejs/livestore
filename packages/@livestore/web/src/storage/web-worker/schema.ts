import { Schema, Transferable } from '@livestore/utils/effect'

export class UnexpectedError extends Schema.TaggedError<UnexpectedError>()('UnexpectedError', {
  error: Schema.any,
}) {}

export const ExecutionBacklogItemExecute = Schema.struct({
  _tag: Schema.literal('execute'),
  query: Schema.string,
  bindValues: Schema.any,
})

export const ExecutionBacklogItemMutate = Schema.struct({
  _tag: Schema.literal('mutate'),
  mutationEventEncoded: Schema.struct({
    mutation: Schema.string,
    args: Schema.any,
    id: Schema.string,
  }),
})

export const ExecutionBacklogItemTxn = Schema.struct({
  _tag: Schema.literal('txn'),
  items: Schema.union(ExecutionBacklogItemExecute, ExecutionBacklogItemMutate),
})

export const ExecutionBacklogItem = Schema.union(
  ExecutionBacklogItemExecute,
  ExecutionBacklogItemMutate,
  ExecutionBacklogItemTxn,
)

export type ExecutionBacklogItem = Schema.Schema.Type<typeof ExecutionBacklogItem>

export const StorageTypeOpfs = Schema.struct({
  type: Schema.literal('opfs'),
  /** Default is root directory */
  directory: Schema.optional(Schema.string),
  /** Default is 'livestore-' */
  filePrefix: Schema.optional(Schema.string),
})

export const StorageTypeIndexeddb = Schema.struct({
  type: Schema.literal('indexeddb'),
  /** @default "livestore" */
  databaseName: Schema.optional(Schema.string),
  /** @default "livestore" */
  storeNamePrefix: Schema.optional(Schema.string),
})

export const StorageType = Schema.union(StorageTypeOpfs, StorageTypeIndexeddb)
export type StorageType = Schema.Schema.Type<typeof StorageType>

export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()(
  'InitialMessage',
  UnexpectedError,
  Schema.void,
  { storage: StorageType },
) {}

export class ExecuteBulk extends Schema.TaggedRequest<ExecuteBulk>()('ExecuteBulk', UnexpectedError, Schema.void, {
  items: Schema.array(ExecutionBacklogItem),
}) {}

export class Export extends Schema.TaggedRequest<Export>()('Export', UnexpectedError, Transferable.Uint8Array, {}) {}

export class ExportMutationlog extends Schema.TaggedRequest<ExportMutationlog>()(
  'ExportMutationlog',
  UnexpectedError,
  Transferable.Uint8Array,
  {},
) {}

export class Setup extends Schema.TaggedRequest<Setup>()('Setup', UnexpectedError, Transferable.Uint8Array, {}) {}

export class Shutdown extends Schema.TaggedRequest<Shutdown>()('Shutdown', UnexpectedError, Schema.void, {}) {}

export const Request = Schema.union(InitialMessage, ExecuteBulk, Export, ExportMutationlog, Setup, Shutdown)
export type Request = Schema.Schema.Type<typeof Request>
