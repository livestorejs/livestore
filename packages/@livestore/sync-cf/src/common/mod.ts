import { Schema } from '@livestore/utils/effect'

export type { CfTypes } from '@livestore/common-cf'
export * from './constants.ts'
export { SyncHttpRpc } from './http-rpc-schema.ts'
export * as SyncMessage from './sync-message-types.ts'
export { splitChunkBySize } from './transport-chunking.ts'

export const SearchParamsSchema = Schema.Struct({
  storeId: Schema.String,
  payload: Schema.compose(Schema.StringFromUriComponent, Schema.parseJson(Schema.JsonValue)).pipe(Schema.UndefinedOr),
  // NOTE `do-rpc` is handled differently
  transport: Schema.Union(Schema.Literal('http'), Schema.Literal('ws')),
})

export type SearchParams = typeof SearchParamsSchema.Type
